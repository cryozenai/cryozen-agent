"""Housekeeping chores that read a profile's home, config or credentials run under the OWNING
profile's runtime scope on a multiplexed gateway.

The housekeeping thread has no turn on the stack, so nothing bound a profile for it: under
``gateway.multiplex_profiles`` a credential-reading chore resolved secrets through the
fail-closed reader and logged ``no profile secret scope on a multiplexed call`` on every
tick, while the launch profile's home/credentials leaked into every served profile. The MCP
config reconciler already iterated the served profiles under ``_profile_runtime_scope``; the
curator tick now rides the same iteration.
"""

import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

import gateway.run as gateway_run


class _Ticks:
    """Stop event that lets the housekeeping loop run exactly ``n`` ticks with no sleeping."""

    def __init__(self, n: int):
        self.n, self.left = 0, n

    def is_set(self):
        return self.n >= self.left

    def wait(self, timeout=None):
        self.n += 1
        return True


def _profile(home: Path, api_key: str) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text("model:\n  provider: openrouter\n", encoding="utf-8")
    (home / ".env").write_text(f"OPENROUTER_API_KEY={api_key}\n", encoding="utf-8")


@pytest.fixture
def two_homes(tmp_path, monkeypatch):
    """Launch home A (= multiplex ``default``) and served named profile B under ``A/profiles/b``."""
    fake_home = tmp_path / "home"
    a = fake_home / ".cryozen-agent"
    b = a / "profiles" / "b"
    _profile(a, "key-a")
    _profile(b, "key-b")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: fake_home))
    monkeypatch.setenv("CRYOZEN_HOME", str(a))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    # The hermetic conftest pins ``cryozen_state.DEFAULT_DB_PATH`` at one sandbox store whenever
    # cryozen_state is already imported, and that pin WINS over ``get_cryozen_home()`` inside
    # ``_default_db_path()`` — exactly the per-profile resolution these tests exist to prove.
    # Restore the import-time sentinel so an argless ``acquire()`` resolves through the scope.
    import cryozen_state
    monkeypatch.setattr(cryozen_state, "DEFAULT_DB_PATH", cryozen_state._IMPORT_DEFAULT_DB_PATH)
    # Disabling the hermetic pin is only safe while the sentinel still resolves INSIDE the sandbox:
    # a resolution that escaped to the real home would have these tests writing the live store.
    resolved = Path(cryozen_state._default_db_path())
    assert resolved.is_relative_to(tmp_path), f"unpinned store escaped the sandbox: {resolved}"
    return a, b


def _record_credential_chores(monkeypatch):
    """Replace the credential-reading curator chore with a recorder of (home, profile secret) it sees."""
    import agent.curator as curator
    from agent.secret_scope import get_secret
    from cryozen_constants import get_cryozen_home

    seen: dict = {"curator": []}

    def _rec(key):
        return lambda *a, **k: seen[key].append((get_cryozen_home().name, get_secret("OPENROUTER_API_KEY")))

    monkeypatch.setattr(curator, "maybe_run_curator", _rec("curator"))
    return seen


def _run_60_ticks(runner):
    gateway_run._start_gateway_housekeeping(_Ticks(60), interval=0, runner=runner)


def test_multiplexed_credential_ticks_run_once_per_profile_in_its_own_scope(two_homes, monkeypatch, caplog):
    """Under multiplex every credential-reading chore visits each served profile inside ITS scope:
    A's tick reads A's secret, B's reads B's (B never sees A's), and no fail-closed credential
    read fires the ``no profile secret scope`` warning. The ambient home is untouched afterwards."""
    from agent.secret_scope import set_multiplex_active
    from cryozen_constants import get_cryozen_home

    a, b = two_homes
    seen = _record_credential_chores(monkeypatch)
    set_multiplex_active(True)
    try:
        with caplog.at_level(logging.WARNING):
            _run_60_ticks(SimpleNamespace(config=SimpleNamespace(multiplex_profiles=True)))
    finally:
        set_multiplex_active(False)

    expected = [(a.name, "key-a"), (b.name, "key-b")]
    assert seen == {"curator": expected}
    assert not [r for r in caplog.records if "no profile secret scope" in r.getMessage()]
    assert get_cryozen_home() == a


def test_multiplexed_auto_archive_tick_sweeps_every_served_profile_store(two_homes, monkeypatch):
    """The auto-archive sweep reaches each served profile's OWN state.db.

    ``acquire()`` resolves through ``get_cryozen_home()``, so an unscoped tick archived the
    launch profile's store only — and `cryozen serve`/the dashboard defer to the gateway for
    every profile it owns, so a served secondary would have had no archiver at all.
    """
    from agent.secret_scope import set_multiplex_active
    from cryozen_state import SessionDB

    a, b = two_homes
    swept: list = []
    monkeypatch.setattr(
        SessionDB, "maybe_auto_archive", lambda self, **kw: swept.append(Path(self.db_path)))
    monkeypatch.setattr(
        "cryozen_cli.config.load_config",
        lambda *args, **kwargs: {"sessions": {"auto_archive": True, "min_interval_hours": 0}})

    set_multiplex_active(True)
    try:
        _run_60_ticks(SimpleNamespace(config=SimpleNamespace(multiplex_profiles=True)))
    finally:
        set_multiplex_active(False)

    assert swept == [a / "state.db", b / "state.db"]


def test_multiplexed_maintenance_tick_prunes_every_served_profile_store(two_homes, monkeypatch):
    """Prune/VACUUM reaches each served profile's OWN state.db, under its OWN ``sessions:`` config.

    Prune and VACUUM ran once in the gateway constructor against a handle pinned to the launch
    home, so a multiplexed secondary's store was never pruned or vacuumed by anybody — it grew
    without bound while the launch profile's ``retention_days`` decided whether it happened at all.
    Real stores, real config files: nothing here is patched.
    """
    from agent.secret_scope import set_multiplex_active
    from cryozen_state import SessionDB

    homes = two_homes
    for home in homes:
        (home / "config.yaml").write_text(
            "model:\n  provider: openrouter\n"
            "sessions:\n"
            "  auto_prune: true\n"
            "  retention_days: 0\n"
            "  min_interval_hours: 0\n"
            "  vacuum_after_prune: false\n",
            encoding="utf-8")
        db = SessionDB(db_path=home / "state.db")
        db.create_session("old", "cli")
        db.end_session("old", "done")
        db.close()

    set_multiplex_active(True)
    try:
        _run_60_ticks(SimpleNamespace(config=SimpleNamespace(multiplex_profiles=True)))
    finally:
        set_multiplex_active(False)

    for home in homes:
        db = SessionDB(db_path=home / "state.db")
        try:
            assert db.get_session("old") is None, f"{home.name}'s store was never pruned"
        finally:
            db.close()


def test_prune_unlinks_transcripts_under_the_configured_sessions_dir(two_homes, tmp_path):
    """``gateway.sessions_dir`` governs the LAUNCH profile's transcripts; others use their own home.

    Hardcoding ``<home>/sessions`` made the prune unlink under a directory nothing writes to, so an
    override left every pruned session's ``.json``/``.jsonl``/``request_dump_*`` orphaned forever.
    """
    from agent.secret_scope import set_multiplex_active
    from cryozen_state import SessionDB

    a, b = two_homes
    override = tmp_path / "custom-transcripts"
    override.mkdir()
    for home, transcripts in ((a, override), (b, b / "sessions")):
        (home / "config.yaml").write_text(
            "model:\n  provider: openrouter\n"
            "sessions:\n"
            "  auto_prune: true\n"
            "  retention_days: 0\n"
            "  min_interval_hours: 0\n"
            "  vacuum_after_prune: false\n",
            encoding="utf-8")
        db = SessionDB(db_path=home / "state.db")
        db.create_session("old", "cli")
        db.end_session("old", "done")
        db.close()
        transcripts.mkdir(parents=True, exist_ok=True)
        (transcripts / "old.jsonl").write_text("{}\n", encoding="utf-8")

    set_multiplex_active(True)
    try:
        _run_60_ticks(SimpleNamespace(config=SimpleNamespace(
            multiplex_profiles=True, sessions_dir=override)))
    finally:
        set_multiplex_active(False)

    assert not (override / "old.jsonl").exists(), "launch profile's configured transcript survived"
    assert not (b / "sessions" / "old.jsonl").exists(), "profile b's transcript survived"


def test_single_profile_credential_ticks_run_once_against_the_process_home(two_homes, monkeypatch):
    """Control: a single-profile gateway (multiplex off) still runs each chore exactly once against
    the process home — the named profile directory on disk is not visited."""
    a, _b = two_homes
    seen = _record_credential_chores(monkeypatch)

    _run_60_ticks(SimpleNamespace(config=SimpleNamespace(multiplex_profiles=False)))

    assert {k: [h for h, _ in v] for k, v in seen.items()} == {
        "curator": [a.name]}
