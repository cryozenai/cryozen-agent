"""Run the separately installed darwinian_evolver CLI as a child process.

Usage:
    python run_evolver.py PROBLEM --output-dir DIR [--iterations N] [--parents N]
        [--concurrency N] [--batch-size N] [--verify-mutations]
        [--evolver-dir DIR] [--dry-run]

The upstream tool is never imported: this script only builds the command line,
runs it with ``uv run`` inside the upstream checkout, and returns its exit code.
``--dry-run`` prints the command as JSON instead of running it.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def default_evolver_dir() -> Path:
    home = Path(os.environ.get("CRYOZEN_HOME") or Path.home() / ".cryozen-agent")
    return home / "cache" / "darwinian-evolver" / "darwinian_evolver"


def build_command(args: argparse.Namespace) -> list[str]:
    cmd = [
        "uv",
        "run",
        "darwinian_evolver",
        args.problem,
        "--output_dir",
        str(Path(args.output_dir).expanduser().resolve()),
        "--num_iterations",
        str(args.iterations),
        "--num_parents_per_iteration",
        str(args.parents),
        "--mutator_concurrency",
        str(args.concurrency),
        "--evaluator_concurrency",
        str(args.concurrency),
        "--batch_size",
        str(args.batch_size),
    ]
    if args.verify_mutations:
        cmd.append("--verify_mutations")
    return cmd


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError(f"must be >= 1, got {number}")
    return number


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "problem", help="Problem name registered in the upstream checkout, e.g. parrot."
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory for results.jsonl and snapshots/.",
    )
    parser.add_argument("--iterations", type=_positive_int, default=3)
    parser.add_argument(
        "--parents",
        type=_positive_int,
        default=2,
        help="Parents selected per iteration.",
    )
    parser.add_argument(
        "--concurrency",
        type=_positive_int,
        default=2,
        help="Mutator and evaluator concurrency.",
    )
    parser.add_argument("--batch-size", type=_positive_int, default=1)
    parser.add_argument("--verify-mutations", action="store_true")
    parser.add_argument(
        "--evolver-dir",
        type=Path,
        default=None,
        help="Upstream checkout (default: the skill cache).",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the command as JSON and exit."
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    evolver_dir = (args.evolver_dir or default_evolver_dir()).expanduser()
    cmd = build_command(args)

    if args.dry_run:
        print(json.dumps({"cwd": str(evolver_dir), "command": cmd}))
        return 0

    if not (evolver_dir / "pyproject.toml").is_file():
        print(
            f"darwinian_evolver checkout not found at {evolver_dir}; run the skill's install step first.",
            file=sys.stderr,
        )
        return 2
    if shutil.which("uv") is None:
        print("uv is not on PATH; install uv first.", file=sys.stderr)
        return 2

    Path(args.output_dir).expanduser().mkdir(parents=True, exist_ok=True)
    return subprocess.run(cmd, cwd=evolver_dir, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
