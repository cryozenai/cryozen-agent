"""
Tests for the darwinian-evolver optional skill.

The evolution loop itself needs network and a paid LLM, so these tests cover
the SKILL.md frontmatter and the behaviour of the shipped scripts: the wrapper
builds the upstream command line and runs it as a child process, and the
summarizer ranks organisms from a results.jsonl log.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

SKILL_DIR = (
    Path(__file__).resolve().parents[2]
    / "optional-skills"
    / "research"
    / "darwinian-evolver"
)


@pytest.fixture(scope="module")
def frontmatter() -> dict:
    src = (SKILL_DIR / "SKILL.md").read_text()
    m = re.search(r"^---\n(.*?)\n---", src, re.DOTALL)
    assert m, "SKILL.md missing YAML frontmatter"
    return yaml.safe_load(m.group(1))


def test_skill_dir_exists() -> None:
    assert SKILL_DIR.is_dir(), f"missing skill dir: {SKILL_DIR}"


def test_description_under_60_chars(frontmatter) -> None:
    desc = frontmatter["description"]
    assert len(desc) <= 60, f"description is {len(desc)} chars (hardline ≤60): {desc!r}"


def test_platforms_excludes_windows(frontmatter) -> None:
    # Upstream uses func_timeout (POSIX signals) and uv subprocess pipelines; the
    # skill is gated [linux, macos]. If we ever port to Windows, update this test
    # to assert ["linux", "macos", "windows"].
    assert "windows" not in frontmatter["platforms"]
    assert set(frontmatter["platforms"]) >= {"linux", "macos"}


def _run(
    script: str, *args: str, env: dict | None = None
) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SKILL_DIR / "scripts" / script), *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_run_evolver_dry_run_builds_upstream_command(tmp_path) -> None:
    out = tmp_path / "out"
    result = _run(
        "run_evolver.py",
        "parrot",
        "--output-dir",
        str(out),
        "--iterations",
        "4",
        "--concurrency",
        "3",
        "--verify-mutations",
        "--evolver-dir",
        str(tmp_path / "de"),
        "--dry-run",
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["cwd"] == str(tmp_path / "de")
    cmd = payload["command"]
    assert cmd[:4] == ["uv", "run", "darwinian_evolver", "parrot"]
    flags = dict(zip(cmd[4::2], cmd[5::2]))
    assert flags["--output_dir"] == str(out.resolve())
    assert flags["--num_iterations"] == "4"
    assert flags["--mutator_concurrency"] == flags["--evaluator_concurrency"] == "3"
    assert cmd[-1] == "--verify_mutations"


def test_run_evolver_runs_uv_in_checkout_and_propagates_exit_code(tmp_path) -> None:
    checkout = tmp_path / "de"
    checkout.mkdir()
    (checkout / "pyproject.toml").write_text("[project]\nname = 'x'\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_uv.write_text(
        '#!/bin/sh\npwd > "$FAKE_UV_LOG"\necho "$@" >> "$FAKE_UV_LOG"\nexit 7\n'
    )
    fake_uv.chmod(0o755)
    log = tmp_path / "uv.log"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_UV_LOG": str(log),
    }

    result = _run(
        "run_evolver.py",
        "parrot",
        "--output-dir",
        str(tmp_path / "out"),
        "--evolver-dir",
        str(checkout),
        env=env,
    )

    assert result.returncode == 7
    cwd, argv = log.read_text().splitlines()
    assert Path(cwd).resolve() == checkout.resolve()
    assert argv.startswith("run darwinian_evolver parrot --output_dir")
    assert (tmp_path / "out").is_dir()


def test_run_evolver_reports_missing_checkout(tmp_path) -> None:
    result = _run(
        "run_evolver.py",
        "parrot",
        "--output-dir",
        str(tmp_path / "out"),
        "--evolver-dir",
        str(tmp_path / "missing"),
    )
    assert result.returncode == 2
    assert "checkout not found" in result.stderr


def _entry(oid: str, score: float, prompt: str) -> dict:
    return {
        "organism": {"id": oid, "parent_id": None, "prompt_template": prompt},
        "evaluation_result": {"score": score},
    }


def test_summarize_ranks_last_iteration_by_score(tmp_path) -> None:
    records = [
        {
            "iteration": 0,
            "population": {"organisms": [_entry("a", 0.0, "Say {{ phrase }}")]},
        },
        {
            "iteration": 1,
            "population": {
                "organisms": [
                    _entry("a", 0.0, "Say {{ phrase }}"),
                    _entry("b", 0.9, "Repeat exactly: {{ phrase }}"),
                    _entry("c", 0.4, "Echo {{ phrase }}"),
                ]
            },
        },
    ]
    (tmp_path / "results.jsonl").write_text(
        "\n".join(json.dumps(r) for r in records) + "\n"
    )

    result = _run("summarize_results.py", str(tmp_path), "--top", "2", "--json")

    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["iteration"] == 1
    assert summary["organism_count"] == 3
    assert [row["id"] for row in summary["top"]] == ["b", "c"]
    assert summary["top"][0]["field"] == "prompt_template"
    assert summary["top"][0]["text"] == "Repeat exactly: {{ phrase }}"


def test_summarize_rejects_malformed_log(tmp_path) -> None:
    (tmp_path / "results.jsonl").write_text("{not json\n")
    result = _run("summarize_results.py", str(tmp_path))
    assert result.returncode == 1
    assert "not valid JSON" in result.stderr
