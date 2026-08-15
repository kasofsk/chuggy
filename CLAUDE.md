# chuggy — working notes

A job orchestrator: tickets form a DAG, a single journaled actor drives each through authoring → work → evaluation → landing, and the fabric runs the work and decides nothing.

**This repo is unusual in one way that matters before you read anything else: the formal model leads the implementation.** A Quint model of the machine already exists and is proved; it emits golden traces, and this implementation grows up against them. When the model and the code disagree, the code is wrong.

## Where the knowledge is

**`model/` is the specification.** There is no `docs/` tree; the written standards that used to sit beside the model were removed rather than maintained alongside it. <!-- absent --> So the tree states what is true of itself in exactly two places, and both are checkable:

- **`model/`** — the machine, its measure, its refinement and its suites. What it proves, it proves; nothing restates a proved property in prose.
- **each gate's own header** — every script in `.chug/tasks/` opens by stating the rule it enforces and why. The rule and its enforcement cannot drift apart, because they are the same file.

This file is the third: an entry point and a set of conventions, holding what neither of those two can hold.

## Checks

```sh
just check          # everything
```

The pre-commit hook runs the fast subset and is installed with `git config core.hooksPath .githooks` — **a fresh clone needs that once**.

Gate scripts live in `.chug/tasks/`, each with a sibling `*.test.sh`. The
slowest by far is `check-model.sh` (~50s against ~17s for everything else,
measured 2026-08-15 — the figure moves whenever a stage is added, so re-measure
rather than rounding, and `.chug/tasks/ci.sh` carries the same pair beside the
ordering it justifies),
which is why it runs last and never in the hook. Every gate exits 0 clean, 1 on a finding, **2 when it could not run** — and 2 is not a pass. The sequencing lives in `.chug/tasks/ci.sh`; the justfile is a thin wrapper, and the hook calls the scripts directly because `just` may not be installed.

That path is not a placeholder. When this repo is eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh` becomes the command evaluator every job runs, unchanged.

## Conventions that bite if you miss them

- **There is no CI but the local gates.** No Actions, no PR checks, no server. `just check` and the hook are the whole of it, which means a gate that is slow or noisy is a gate that gets bypassed — and then it enforces nothing.
- **`--no-verify` bypasses every gate at once**, including the ones you were not trying to skip. Legitimate when the alternative is leaving work uncommitted; run `just check` before you push either way.
- **A figure written into a doc carries its measurement date.** Timings, counts and thresholds go stale silently, and a count written into a comment goes stale even when the comment beside it asks for re-measurement. Prefer a figure a script derives at run time to one a reader has to trust.
- **A rule needs a failure it can prevent here.** Before adding one, name the thing that goes wrong in *this* tree if it is absent. A rule adopted because it sounds right is a rule nobody can apply a refutation trigger to.
- **Nothing reviews its own work.** `.chug/tasks/review-change.md` is the reviewer's brief, and it is written to be run in a **fresh session** that did not author the change — an agent handed its own diff re-reads its intentions instead of the code, and agrees with itself. Until there is a platform to run it as an evaluation task, run it by hand before anything lands.
- **Don't run destructive commands** — deploys, restarts, data resets — without asking first.
