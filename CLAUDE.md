# chuggy — working notes

A job orchestrator: tickets form a DAG, a single journaled actor drives each through authoring → work → evaluation → landing, and Nomad runs the work and decides nothing.

**This repo is unusual in one way that matters before you read anything else: the formal model leads the implementation.** A Quint model of the machine already exists and is proved; it emits golden traces, and this implementation grows up against them. When the model and the code disagree, the code is wrong. That inverts the normal arrangement, and it is charter standing rule 4.

## Read these; don't re-derive them

- **[docs/reference/style.md](./docs/reference/style.md)** — the blessed practices, in three tiers. Read it before writing anything. Tier 1 is machine-checked, Tier 2 is rejected by rule name, and every Tier 1 rule carries a **live** or **pending** tag saying whether a script enforces it yet. A pending rule still binds you.
- **[docs/reference/docs.md](./docs/reference/docs.md)** — the doc policy. Which of the two kinds of doc you are editing determines whether you rewrite it in place or append to it, and they are opposite. Also the claim markers, which you need from your first doc.
- **[docs/concepts.md](./docs/concepts.md)** — which doc owns each term's definition. A routing table: follow the row rather than restating the term.
- **[docs/README.md](./docs/README.md)** — the catalogue. Adding a doc means adding its row in the same commit.

This file is an **index and a set of conventions**. It deliberately does not restate any rule from the pages above — a second copy of a rule is what drifts, and keeping the rules in exactly one place is why they can be trusted.

## Provenance

The charter, the intake answers and the Quint model live in `davemo88/swarm-spec` <!-- intent --> until the monorepo migration lands. The charter's §5 standing rules and §2 decided rows govern this implementation, and `docs/reference/architecture.md` <!-- intent --> will reconcile them with the reimplementation-facing material carried over from the predecessor.

Much of the apparatus here — the gates, the doc policy, the tier structure — is ported from **chuggernaut**, the predecessor this replaces. It is ported deliberately and selectively: `style.md` records what was carried forward but is not yet in force, and what was deliberately not carried over at all. If you find yourself about to add a rule because chuggernaut had it, check that its motivating failure can actually occur here.

## Checks

```sh
just check          # everything
```

The pre-commit hook runs the fast subset and is installed with `git config core.hooksPath .githooks` — **a fresh clone needs that once**.

Gate scripts live in `.chug/tasks/`, each with a sibling `*.test.sh`. Every gate exits 0 clean, 1 on a finding, **2 when it could not run** — and 2 is not a pass. The sequencing lives in `.chug/tasks/ci.sh`; the justfile is a thin wrapper, and the hook calls the scripts directly because `just` may not be installed.

That path is not a placeholder. When this repo is eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh` becomes the command evaluator every job runs, unchanged.

## Conventions that bite if you miss them

- **There is no CI but the local gates.** No Actions, no PR checks, no server. `just check` and the hook are the whole of it, which means a gate that is slow or noisy is a gate that gets bypassed — and then it enforces nothing.
- **`--no-verify` bypasses every gate at once**, including the ones you were not trying to skip. Legitimate when the alternative is leaving work uncommitted; run `just check` before you push either way.
- **A figure written into a doc carries its measurement date.** Timings, counts and thresholds go stale silently. The predecessor's CI header still claims a suite count it outgrew, inside a comment instructing re-measurement on every addition.
- **Don't run destructive commands** — deploys, restarts, data resets — without asking first.
