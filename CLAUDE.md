# chuggy — working notes

A job orchestrator: tickets form a DAG, a single journaled actor drives each through authoring → work → evaluation → landing, and the fabric runs the work and decides nothing.

**This repo is unusual in one way that matters before you read anything else: the formal model leads the implementation.** A Quint model of the machine already exists and is proved; it emits golden traces, and this implementation grows up against them. When the model and the code disagree, the code is wrong. That inverts the normal arrangement, and it is standing rule 4.

## Read these; don't re-derive them

- **[docs/reference/style.md](./docs/reference/style.md)** — the blessed practices, in three tiers. Read it before writing anything. Tier 1 is machine-checked, Tier 2 is rejected by rule name, and every Tier 1 rule carries a **live** or **pending** tag saying whether a script enforces it yet. A pending rule still binds you.
- **[docs/reference/docs.md](./docs/reference/docs.md)** — the doc policy. Which of the two kinds of doc you are editing determines whether you rewrite it in place or append to it, and they are opposite. Also the claim markers, which you need from your first doc.
- **[docs/concepts.md](./docs/concepts.md)** — which doc owns each term's definition. A routing table: follow the row rather than restating the term.
- **[docs/README.md](./docs/README.md)** — the catalogue. Adding a doc means adding its row in the same commit.

This file is an **index and a set of conventions**. It deliberately does not restate any rule from the pages above — a second copy of a rule is what drifts, and keeping the rules in exactly one place is why they can be trusted.

- **[docs/reference/architecture.md](./docs/reference/architecture.md)** — how chuggy is built, and what the model proves. Read it before touching the core.
- **[docs/design/001-what-chuggy-is-not.md](./docs/design/001-what-chuggy-is-not.md)** — the absences and rejected alternatives. Read it before proposing something that sounds obviously missing; it is probably in there with the argument that removed it.

## Checks

```sh
just check          # everything
```

The pre-commit hook runs the fast subset and is installed with `git config core.hooksPath .githooks` — **a fresh clone needs that once**.

Gate scripts live in `.chug/tasks/`, each with a sibling `*.test.sh`. The
slowest by far is `check-model.sh` (~50s against ~5s for everything else),
which is why it runs last and never in the hook. Every gate exits 0 clean, 1 on a finding, **2 when it could not run** — and 2 is not a pass. The sequencing lives in `.chug/tasks/ci.sh`; the justfile is a thin wrapper, and the hook calls the scripts directly because `just` may not be installed.

That path is not a placeholder. When this repo is eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh` becomes the command evaluator every job runs, unchanged.

## Conventions that bite if you miss them

- **There is no CI but the local gates.** No Actions, no PR checks, no server. `just check` and the hook are the whole of it, which means a gate that is slow or noisy is a gate that gets bypassed — and then it enforces nothing.
- **`--no-verify` bypasses every gate at once**, including the ones you were not trying to skip. Legitimate when the alternative is leaving work uncommitted; run `just check` before you push either way.
- **A figure written into a doc carries its measurement date.** Timings, counts and thresholds go stale silently, and a count written into a comment goes stale even when the comment beside it asks for re-measurement. Prefer a figure a script derives at run time to one a reader has to trust.
- **A rule needs a failure it can prevent here.** Before adding one, name the thing that goes wrong in *this* tree if it is absent. A rule adopted because it sounds right is a rule nobody can apply a refutation trigger to.
- **Don't run destructive commands** — deploys, restarts, data resets — without asking first.
