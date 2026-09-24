"""Rank the organisms recorded in a darwinian_evolver ``results.jsonl`` log.

Usage:
    python summarize_results.py OUTPUT_DIR_OR_RESULTS_JSONL [--iteration N]
        [--top N] [--field NAME] [--json]

Each log line is a JSON object with ``iteration`` and ``population.organisms``;
every organism entry has an ``organism`` mapping and an ``evaluation_result``
mapping with a ``score``. Only JSON is read, never pickled snapshots.
By default the last iteration is shown and the displayed text field is the first
string field of the organism other than its identifiers.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ID_FIELDS = {"id", "parent_id"}


def load_iterations(path: Path) -> dict[int, list[dict]]:
    """Map iteration number to its organism entries, in file order."""
    if path.is_dir():
        path = path / "results.jsonl"
    iterations: dict[int, list[dict]] = {}
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{path}:{line_no}: not valid JSON ({exc.msg})"
                ) from exc
            organisms = (record.get("population") or {}).get("organisms") or []
            iterations[int(record.get("iteration", len(iterations)))] = organisms
    return iterations


def _score(entry: dict) -> float:
    score = (entry.get("evaluation_result") or {}).get("score")
    return float(score) if isinstance(score, (int, float)) else float("-inf")


def _text_field(organism: dict, field: str | None) -> tuple[str | None, str | None]:
    if field is not None:
        value = organism.get(field)
        return field, value if isinstance(value, str) else None
    for key, value in organism.items():
        if isinstance(value, str) and key not in _ID_FIELDS and not key.startswith("_"):
            return key, value
    return None, None


def summarize(
    iterations: dict[int, list[dict]],
    iteration: int | None,
    top: int | None,
    field: str | None,
) -> dict:
    if not iterations:
        raise ValueError("log contains no iterations")
    chosen = max(iterations) if iteration is None else iteration
    if chosen not in iterations:
        raise ValueError(f"iteration {chosen} not in log (have {sorted(iterations)})")
    ranked = sorted(iterations[chosen], key=_score, reverse=True)
    if top is not None:
        ranked = ranked[:top]
    rows = []
    for entry in ranked:
        organism = entry.get("organism") or {}
        name, text = _text_field(organism, field)
        rows.append({
            "score": _score(entry),
            "id": organism.get("id"),
            "field": name,
            "text": text,
        })
    return {"iteration": chosen, "organism_count": len(iterations[chosen]), "top": rows}


def _print_human(summary: dict) -> None:
    print(f"iteration {summary['iteration']}: {summary['organism_count']} organisms")
    for rank, row in enumerate(summary["top"]):
        print(f"\n#{rank} score={row['score']:.3f} id={row['id']}")
        if row["text"] is None:
            print("  (no string field)")
            continue
        print(f"  {row['field']}:")
        for line in row["text"].splitlines()[:30]:
            print(f"    {line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "path", type=Path, help="Run output directory or its results.jsonl."
    )
    parser.add_argument("--iteration", type=int, default=None)
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--field", default=None, help="Organism field to display.")
    parser.add_argument("--json", action="store_true", help="Emit the summary as JSON.")
    args = parser.parse_args(argv)
    try:
        summary = summarize(
            load_iterations(args.path), args.iteration, args.top, args.field
        )
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(summary))
    else:
        _print_human(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
