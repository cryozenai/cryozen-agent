"""Tests for cryozen_cli.model_catalog — remote manifest fetch + cache + fallback."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    """Isolate CRYOZEN_HOME + reset any module-level catalog cache per test."""
    home = tmp_path / ".cryozen-agent"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("CRYOZEN_HOME", str(home))

    # Force a fresh catalog module state for each test.
    import importlib
    from cryozen_cli import model_catalog
    importlib.reload(model_catalog)
    yield home
    model_catalog.reset_cache()


def _valid_manifest() -> dict:
    return {
        "version": 1,
        "updated_at": "2026-04-25T22:00:00Z",
        "metadata": {"source": "test"},
        "providers": {
            "openrouter": {
                "metadata": {"display_name": "OpenRouter"},
                "models": [
                    {"id": "anthropic/claude-opus-4.7", "description": "recommended"},
                    {"id": "openai/gpt-5.4", "description": ""},
                    {"id": "openrouter/elephant-alpha", "description": "free"},
                ],
            },
        },
    }


class TestValidation:
    def test_accepts_well_formed_manifest(self, isolated_home):
        from cryozen_cli.model_catalog import _validate_manifest
        assert _validate_manifest(_valid_manifest()) is True

    def test_rejects_non_dict(self, isolated_home):
        from cryozen_cli.model_catalog import _validate_manifest
        assert _validate_manifest("string") is False
        assert _validate_manifest([]) is False
        assert _validate_manifest(None) is False


    def test_rejects_non_string_model_id(self, isolated_home):
        from cryozen_cli.model_catalog import _validate_manifest
        m = _valid_manifest()
        m["providers"]["openrouter"]["models"][0] = {"id": 42}
        assert _validate_manifest(m) is False


class TestFetchSuccess:
    def test_fetch_and_cache_writes_disk(self, isolated_home):
        from cryozen_cli import model_catalog
        manifest = _valid_manifest()
        with patch.object(
            model_catalog, "_fetch_manifest", return_value=manifest
        ) as fetch:
            result = model_catalog.get_catalog(force_refresh=True)

        assert result == manifest
        assert fetch.called

        cache_file = model_catalog._cache_path()
        assert cache_file.exists()
        with open(cache_file) as fh:
            assert json.load(fh) == manifest


class TestFetchFailure:
    def test_network_failure_returns_empty_when_no_cache(self, isolated_home):
        from cryozen_cli import model_catalog
        with patch.object(model_catalog, "_fetch_manifest", return_value=None):
            result = model_catalog.get_catalog(force_refresh=True)
        assert result == {}

    def test_network_failure_falls_back_to_disk_cache(self, isolated_home):
        from cryozen_cli import model_catalog
        # Prime disk cache with a fresh copy.
        manifest = _valid_manifest()
        with patch.object(model_catalog, "_fetch_manifest", return_value=manifest):
            model_catalog.get_catalog(force_refresh=True)

        # Now wipe in-process cache and simulate network failure on refetch.
        model_catalog.reset_cache()
        with patch.object(model_catalog, "_fetch_manifest", return_value=None):
            result = model_catalog.get_catalog(force_refresh=True)

        assert result == manifest

    def test_fetch_failure_falls_back_to_stale_cache(self, isolated_home):
        from cryozen_cli import model_catalog
        manifest = _valid_manifest()
        # Write stale cache directly (mtime in the past).
        cache = model_catalog._cache_path()
        cache.parent.mkdir(parents=True, exist_ok=True)
        with open(cache, "w") as fh:
            json.dump(manifest, fh)
        old = time.time() - 30 * 24 * 3600  # 30 days ago
        import os as _os
        _os.utime(cache, (old, old))

        with patch.object(model_catalog, "_fetch_manifest", return_value=None):
            result = model_catalog.get_catalog()

        # Stale cache is better than nothing.
        assert result == manifest


class TestFallbackChain:
    """``_fetch_manifest_with_fallback`` walks ``DEFAULT_CATALOG_FALLBACK_URLS``
    when the primary URL fails. Regression: the Docusaurus site behind Vercel
    occasionally returns HTTP 403 + x-vercel-mitigated: challenge for urllib;
    without a fallback URL the user's disk cache freezes and new model
    releases (opus 4.8, etc.) never reach the picker.
    """

    PRIMARY = "https://cryozenai.github.io/cryozen-agent/docs/api/model-catalog.json"
    FALLBACK = (
        "https://raw.githubusercontent.com/cryozenai/cryozen-agent"
        "/main/website/static/api/model-catalog.json"
    )

    def test_uses_primary_when_it_succeeds(self, isolated_home):
        from cryozen_cli import model_catalog
        calls: list[str] = []

        def fake_fetch(url, timeout):
            calls.append(url)
            return _valid_manifest()

        with patch.object(model_catalog, "_fetch_manifest", side_effect=fake_fetch):
            result = model_catalog._fetch_manifest_with_fallback(self.PRIMARY, 5.0)

        assert result is not None
        assert calls == [self.PRIMARY], "fallback URLs must not be touched on primary success"

    def test_falls_through_to_raw_github_on_primary_failure(self, isolated_home):
        from cryozen_cli import model_catalog
        calls: list[str] = []

        def fake_fetch(url, timeout):
            calls.append(url)
            if url == self.PRIMARY:
                return None  # simulate Vercel 403
            return _valid_manifest()

        with patch.object(model_catalog, "_fetch_manifest", side_effect=fake_fetch):
            result = model_catalog._fetch_manifest_with_fallback(self.PRIMARY, 5.0)

        assert result is not None
        assert calls == [self.PRIMARY, self.FALLBACK]


    def test_get_catalog_uses_fallback_chain(self, isolated_home):
        """End-to-end: ``get_catalog`` routes through the fallback helper so
        a primary URL failure transparently produces a working catalog."""
        from cryozen_cli import model_catalog
        manifest = _valid_manifest()
        calls: list[str] = []

        def fake_fetch(url, timeout):
            calls.append(url)
            if url == self.PRIMARY:
                return None
            return manifest

        with patch.object(model_catalog, "_fetch_manifest", side_effect=fake_fetch):
            result = model_catalog.get_catalog(force_refresh=True)

        assert result == manifest
        assert self.FALLBACK in calls


class TestCuratedAccessors:
    def test_openrouter_returns_tuples(self, isolated_home):
        from cryozen_cli import model_catalog
        with patch.object(
            model_catalog, "_fetch_manifest", return_value=_valid_manifest()
        ):
            result = model_catalog.get_curated_openrouter_models()
        assert result == [
            ("anthropic/claude-opus-4.7", "recommended"),
            ("openai/gpt-5.4", ""),
            ("openrouter/elephant-alpha", "free"),
        ]


class TestDefaultModelFromCache:
    """get_default_model_from_cache reads the '"default": true' label without
    ever hitting the network."""

    def _manifest_with_default(self) -> dict:
        m = _valid_manifest()
        m["providers"]["openrouter"]["models"][1]["default"] = True  # gpt-5.4
        return m

    def test_reads_label_from_disk_cache(self, isolated_home):
        from cryozen_cli import model_catalog
        cache = isolated_home / "cache"
        cache.mkdir()
        (cache / "model_catalog.json").write_text(
            json.dumps(self._manifest_with_default())
        )
        with patch.object(model_catalog, "_fetch_manifest") as fetch:
            assert (
                model_catalog.get_default_model_from_cache("openrouter")
                == "openai/gpt-5.4"
            )
            fetch.assert_not_called()

    def test_no_label_returns_none(self, isolated_home):
        from cryozen_cli import model_catalog
        cache = isolated_home / "cache"
        cache.mkdir()
        (cache / "model_catalog.json").write_text(json.dumps(_valid_manifest()))
        with patch.object(model_catalog, "_fetch_manifest") as fetch:
            assert model_catalog.get_default_model_from_cache("openrouter") is None
            fetch.assert_not_called()


    def test_shipped_manifest_labels_glm52_default(self, isolated_home):
        """Contract with the in-repo manifest: the provider block labels the
        default entry the code constant points at."""
        import cryozen_cli.model_catalog as model_catalog
        from cryozen_cli.models import PREFERRED_SILENT_DEFAULT_MODEL

        repo_root = Path(model_catalog.__file__).resolve().parent.parent
        manifest = json.loads(
            (repo_root / "website" / "static" / "api" / "model-catalog.json").read_text()
        )
        for provider in ("openrouter",):
            block = manifest["providers"][provider]
            labeled = [m["id"] for m in block["models"] if m.get("default")]
            assert labeled == [PREFERRED_SILENT_DEFAULT_MODEL], (
                f"{provider}: exactly one entry must be labeled default and it "
                f"must match PREFERRED_SILENT_DEFAULT_MODEL"
            )


class TestProviderOverride:
    def test_override_url_takes_precedence(self, isolated_home):
        from cryozen_cli import model_catalog

        override_payload = {
            "version": 1,
            "providers": {
                "openrouter": {
                    "models": [
                        {"id": "override/model", "description": "custom"},
                    ]
                }
            },
        }

        def fake_fetch(url, timeout):
            if "override" in url:
                return override_payload
            return _valid_manifest()

        with patch.object(
            model_catalog,
            "_load_catalog_config",
            return_value={
                "enabled": True,
                "url": "http://master",
                "ttl_hours": 24.0,
                "providers": {"openrouter": {"url": "http://override"}},
            },
        ):
            with patch.object(model_catalog, "_fetch_manifest", side_effect=fake_fetch):
                result = model_catalog.get_curated_openrouter_models()

        assert result == [("override/model", "custom")]


class TestRefreshCadence:
    def test_default_ttl_is_twenty_minutes_and_legacy_hours_honoured(self):
        from cryozen_cli import model_catalog

        with patch("cryozen_cli.config.load_config", return_value={"model_catalog": {"ttl_minutes": 20}}):
            assert model_catalog.refresh_interval_seconds() == 20 * 60
        # A user-set legacy ttl_hours still wins while ttl_minutes sits at its default.
        with patch("cryozen_cli.config.load_config", return_value={"model_catalog": {"ttl_minutes": 20, "ttl_hours": 3}}):
            assert model_catalog.refresh_interval_seconds() == 3 * 3600

    def test_refresh_catalogs_forces_every_source(self):
        from cryozen_cli import model_catalog

        with patch.object(model_catalog, "_load_catalog_config", return_value={
            "enabled": True, "url": "http://master", "ttl_hours": 1.0, "providers": {},
        }), patch.object(model_catalog, "get_catalog", return_value=_valid_manifest()) as gc, \
             patch("cryozen_cli.models.fetch_openrouter_models") as orm:
            assert model_catalog.refresh_catalogs() is True
        gc.assert_called_once_with(force_refresh=True)
        orm.assert_called_once_with(force_refresh=True)


class TestIntegrationWithModelsModule:
    """Exercise the fallback paths via the real callers in cryozen_cli.models."""



    def test_picker_max_models_cap_semantics(self, monkeypatch):
        """The cap argument has three distinct meanings on the real slicing
        path: ``None`` = unlimited (the cap-removal fix, #48297), ``0`` = no
        models (preserved for slug-only callers), an int N = first N. Guards
        the ``is not None`` distinction the cap-removal follow-up introduced —
        a ``if max_models`` (falsy) check would conflate ``0`` with unlimited.
        """
        from cryozen_cli.model_switch import list_authenticated_providers
        from cryozen_cli.model_switch_providers import list_picker_providers

        curated = [("vendor/a", ""), ("vendor/b", ""), ("vendor/c", "")]
        expected = [mid for mid, _ in curated]
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        with patch("cryozen_cli.models.OPENROUTER_MODELS", curated), patch(
            "cryozen_cli.models.fetch_openrouter_models", return_value=curated
        ):
            full = list_picker_providers(current_provider="openrouter", max_models=None)
            one = list_picker_providers(current_provider="openrouter", max_models=1)
            # 0 is exercised on list_authenticated_providers (the slug-only
            # path); the picker variant drops empty-model rows entirely, so
            # the empty-list contract lives on the auth-providers call.
            zero = list_authenticated_providers(current_provider="openrouter", max_models=0)

        def _row(rows):
            return next((r for r in rows if r["slug"] == "openrouter"), None)

        full_row = _row(full)
        assert full_row is not None and full_row["models"] == expected

        one_row = _row(one)
        assert one_row is not None and one_row["models"] == expected[:1]

        zero_row = _row(zero)
        # 0 means an empty model list — NOT unlimited. total_models still real.
        assert zero_row is not None
        assert zero_row["models"] == []
        assert zero_row["total_models"] == len(expected)


# -----------------------------------------------------------------------------
# Drift guard — prevent the in-repo curated lists from going out of sync with
# the docs-hosted manifest at website/static/api/model-catalog.json.
# A curated list edited without regenerating the manifest ships a stale picker to new installs.
# -----------------------------------------------------------------------------


class TestManifestMatchesInRepoLists:
    """Fail if the on-disk manifest is out of date relative to in-repo lists."""

    @staticmethod
    def _strip_volatile(catalog: dict) -> dict:
        """Drop fields that always change (timestamps) for diff comparison."""
        out = dict(catalog)
        out.pop("updated_at", None)
        return out

    def test_in_repo_lists_match_manifest(self):
        """``scripts/build_model_catalog.py`` output must match the committed file.

        If this fails, run ``python scripts/build_model_catalog.py`` and
        commit the regenerated ``website/static/api/model-catalog.json``.
        """
        # Resolve the repo root from this test file's location.
        repo_root = Path(__file__).resolve().parents[2]
        manifest_path = repo_root / "website" / "static" / "api" / "model-catalog.json"

        if not manifest_path.exists():
            pytest.skip(f"manifest missing at {manifest_path}")

        # Build expected catalog using the same script CI would.
        import importlib.util
        script_path = repo_root / "scripts" / "build_model_catalog.py"
        spec = importlib.util.spec_from_file_location("_build_model_catalog", script_path)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        expected = mod.build_catalog()

        with open(manifest_path, encoding="utf-8") as fh:
            actual = json.load(fh)

        assert self._strip_volatile(actual) == self._strip_volatile(expected), (
            "website/static/api/model-catalog.json is out of sync with "
            "OPENROUTER_MODELS. "
            "Run: python scripts/build_model_catalog.py && "
            "git add website/static/api/model-catalog.json"
        )
