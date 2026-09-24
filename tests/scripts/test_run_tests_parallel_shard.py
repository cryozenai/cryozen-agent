"""Round-robin sharding in scripts/run_tests_parallel.py.

CI splits the suite across parallel jobs that each compute their own shard
from the same sorted discovery. The contract that makes that safe: the
shards partition the input exactly (no file skipped, none run twice) and
each keeps the discovery order.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
_RUNNER_PATH = REPO_ROOT / "scripts" / "run_tests_parallel.py"


def _load_runner():
    spec = importlib.util.spec_from_file_location("run_tests_parallel", _RUNNER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("count", [0, 1, 7, 8, 9, 23])
@pytest.mark.parametrize("total", [1, 3, 8])
def test_shards_partition_input_in_order(count: int, total: int) -> None:
    mod = _load_runner()
    files = [Path(f"tests/test_{i:03d}.py") for i in range(count)]

    shards = [mod.select_shard(files, i, total) for i in range(total)]

    seen = [f for shard in shards for f in shard]
    assert len(seen) == len(set(seen)), "shards overlap"
    assert set(seen) == set(files), "shards do not cover the input"
    for shard in shards:
        positions = [files.index(f) for f in shard]
        assert positions == sorted(positions), "shard is not an in-order subsequence"
    if total == 1:
        assert shards[0] == files


@pytest.mark.parametrize(("index", "total"), [(8, 8), (-1, 8), (0, 0)])
def test_invalid_shard_is_a_usage_error(tmp_path: Path, index: int, total: int) -> None:
    (tmp_path / "test_probe.py").write_text("def test_ok():\n    assert True\n")
    proc = subprocess.run(
        [
            sys.executable,
            str(_RUNNER_PATH),
            "--paths",
            str(tmp_path),
            f"--shard-index={index}",
            f"--shard-total={total}",
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=60,
    )
    assert proc.returncode == 2
    assert "shard index must satisfy" in proc.stderr
