---
title: "Darwinian Evolver — Evolve prompts/regex/SQL/code with Imbue's evolution loop"
sidebar_label: "Darwinian Evolver"
description: "Evolve prompts/regex/SQL/code with Imbue's evolution loop"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Darwinian Evolver

Evolve prompts/regex/SQL/code with Imbue's evolution loop.

## Skill metadata

| | |
|---|---|
| Source | Optional — install with `cryozen skills install official/research/darwinian-evolver` |
| Path | `optional-skills/research/darwinian-evolver` |
| Version | `0.1.0` |
| Author | Cryozen |
| License | MIT |
| Platforms | linux, macos |
| Tags | `evolution`, `optimization`, `prompt-engineering`, `research` |
| Related skills | [`arxiv`](../../bundled/research/research-arxiv.md), [`jupyter-notebook`](../../optional/data-science/data-science-jupyter-notebook.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Cryozen loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Darwinian Evolver

Run Imbue's [darwinian_evolver](https://github.com/imbue-ai/darwinian_evolver), an
LLM-driven evolutionary search loop, to optimize a prompt, regex, SQL query or
small code snippet against a fitness function.
The skill installs the upstream tool, drives its command line and summarizes the
JSON log it writes.
It does not write evolution problems or evaluators for you.

**License boundary:** the upstream tool is AGPL-3.0 and is installed separately.
The skill ships no upstream code and never imports it: `scripts/run_evolver.py`
only runs the upstream CLI as a child process, and `scripts/summarize_results.py`
only reads the `results.jsonl` file that the CLI writes.

## When to Use

- The user asks to "optimize this prompt", "evolve a regex for X", "auto-improve
  this code/SQL" or "search for a better instruction".
- There is a scorer (exact match, regex pass rate, unit test, LLM judge, runtime
  metric) AND a starting candidate. Without a scorer, stop and define one first.
- The cost is acceptable: a typical run makes 50-500 LLM calls.

Do **not** use this when:
- The optimization target is differentiable (use gradient methods instead).
- Only 2-3 variants are needed; write them by hand.
- The fitness signal is purely subjective with no measurable criterion.

## Prerequisites

- Python 3.11 or newer, `git` and `uv`.
- `ANTHROPIC_API_KEY`: the upstream CLI's built-in problems call Anthropic models.

## Install (One-Time)

Run via the `terminal` tool:

```bash
mkdir -p ~/.cryozen-agent/cache/darwinian-evolver && cd ~/.cryozen-agent/cache/darwinian-evolver
[ -d darwinian_evolver ] || git clone --depth 1 https://github.com/imbue-ai/darwinian_evolver.git
cd darwinian_evolver && uv sync
```

The package is not on PyPI; `pip install darwinian-evolver` installs something else.

## How to Run

`scripts/run_evolver.py` builds the upstream command line, runs it inside the
checkout with `uv run`, and returns the upstream exit code.
Preview the exact command first with `--dry-run`:

```bash
SKILL_DIR=~/.cryozen-agent/skills/research/darwinian-evolver
python3 "$SKILL_DIR/scripts/run_evolver.py" parrot \
  --output-dir ~/.cryozen-agent/cache/scratch/parrot_demo --iterations 2 --dry-run
python3 "$SKILL_DIR/scripts/run_evolver.py" parrot \
  --output-dir ~/.cryozen-agent/cache/scratch/parrot_demo --iterations 2
```

`parrot` is the upstream smoke-test problem; the upstream `--help` lists the others.
The run writes `results.jsonl` (one JSON record per iteration) and `snapshots/`
into the output directory.
Use `--evolver-dir` if the checkout lives somewhere other than the skill cache.

Summarize the run from its JSON log:

```bash
python3 "$SKILL_DIR/scripts/summarize_results.py" ~/.cryozen-agent/cache/scratch/parrot_demo --top 5
python3 "$SKILL_DIR/scripts/summarize_results.py" ~/.cryozen-agent/cache/scratch/parrot_demo --json
```

It ranks the last iteration's organisms by score and prints each one's main text
field (override with `--field`, pick an iteration with `--iteration`).
The upstream checkout also includes `lineage_visualizer.html`, which can load the
same `results.jsonl` in a browser.

## Custom Problems

A custom problem is Python code that subclasses the upstream `Organism`,
`Evaluator` and `Mutator` classes, so it is AGPL-covered work that belongs in the
user's own checkout, not in this skill or in Cryozen.
Point the user to the "Creating Your Own Problem" section of the upstream README,
help them decide the three inputs (initial organism, a scorer returning a 0-1 score
plus failure cases, and a mutation prompt), and let them register the problem in
their checkout.
Once the upstream CLI lists it, run it by name with `run_evolver.py` exactly like
`parrot`.

## Quick Reference

| run_evolver flag | upstream flag | guidance |
|---|---|---|
| `--iterations` (3) | `--num_iterations` | raise to 10-20 once the evaluator is trusted |
| `--parents` (2) | `--num_parents_per_iteration` | 2 for cheap exploration |
| `--concurrency` (2) | `--mutator_concurrency`, `--evaluator_concurrency` | higher values hit rate limits |
| `--batch-size` (1) | `--batch_size` | 2-5 only if the problem's mutator supports batches |
| `--verify-mutations` | `--verify_mutations` | cuts cost when mutations are often useless |

## Pitfalls

1. **Initial organism must be viable.** The upstream loop refuses to start from a
   non-viable seed, even one with a score of 0.
2. **Provider content filters kill mutations.** Phrases such as "ignore previous
   instructions" can be rejected by some providers; expect some failed mutations.
3. **Concurrency defaults upstream are aggressive (10/10).** The wrapper defaults
   to 2/2 for that reason.
4. **Snapshots are pickles.** Only the upstream tool should load them (for example
   with `--resume_from_snapshot`); inspect results through `results.jsonl` instead.
5. **Do not import the upstream package into Cryozen code or this skill.**

## Verification

After install, this exits 0 and prints the upstream help:

```bash
cd ~/.cryozen-agent/cache/darwinian-evolver/darwinian_evolver && uv run darwinian_evolver --help >/dev/null \
  && echo "darwinian-evolver: OK"
```

After a run, `summarize_results.py OUTPUT_DIR` prints at least one organism with a score.

## References

- [Imbue research post](https://imbue.com/research/2026-02-27-darwinian-evolver/)
- [imbue-ai/darwinian_evolver](https://github.com/imbue-ai/darwinian_evolver) (AGPL-3.0, installed separately)
- [Darwin Goedel Machines](https://arxiv.org/abs/2505.22954)
- [PromptBreeder](https://arxiv.org/abs/2309.16797)
