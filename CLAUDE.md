# chuggy — working notes

A job orchestrator: tickets form a DAG, a single journaled actor drives each through authoring → work → evaluation → landing, and the fabric runs the work and decides nothing.

**This repo is unusual in one way that matters before you read anything else: the formal model leads the implementation.** A Quint model of the machine already exists and is proved; it emits golden traces, and this implementation grows up against them. When the model and the code disagree, the code is wrong.

## Where the knowledge is

**`model/` is the specification.** There is no `docs` tree; the written standards that used to sit beside the model were removed rather than maintained alongside it. So the tree states what is true of itself in exactly two places, and both are checkable:

- **`model/`** — the machine, its measure, its refinement and its suites. What it proves, it proves; nothing restates a proved property in prose.
- **each gate's own header** — every script in `.chug/tasks/` opens by stating the rule it enforces and why. The rule and its enforcement cannot drift apart, because they are the same file. `.chug/tasks/review-change.md` is the same arrangement for the rules no script can decide: a reviewer is what enforces them, so they are written in the reviewer's own brief.

This file is the third: an entry point and a set of conventions, holding what neither of those two can hold.

**The general standards came back as skills the tree declares rather than holds.** `.claude/settings.json` enables the `blessed-practices` plugins — `layering` and `domain-modelling` among them, the two that left with `docs`. They are invoked through the Skill tool rather than read, so a reviewer cites one by name and an author is given the same file. The trade is worth stating: their content is versioned in `kasofsk/blessed-practices` and can move without a commit here, which a gate header cannot. That is the cost of not maintaining a second copy, and it is why the two places above still carry everything that must be true of *this* tree — a skill states what good code looks like anywhere, never what is true here.

## Checks

```sh
just check          # everything
```

The pre-commit hook runs the fast subset and is installed with `git config core.hooksPath .githooks` — **a fresh clone needs that once**, because git config is not tracked and nothing in a checkout can set it for you.

The skills need no such step, and the difference is the reason `.claude/settings.json` is tracked at all: a clone and a `git worktree` both come up with them already enabled, where an untracked settings file would leave a worktree silently without them. A machine that has never seen the `blessed-practices` marketplace fetches it on first use.

Gate scripts live in `.chug/tasks/`, each with a sibling `*.test.sh`. The
slowest by far is `check-model.sh`, which is why it runs last and never in the
hook. Every gate exits 0 clean, 1 on a finding, **2 when it could not run** — and 2 is not a pass. The sequencing lives in `.chug/tasks/ci.sh`; the justfile is a thin wrapper, and the hook calls the scripts directly because `just` may not be installed.

That path is not a placeholder. When this repo is eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh` becomes the command evaluator every job runs, unchanged.

## Conventions that bite if you miss them

- **There is no CI but the local gates.** No Actions, no PR checks, no server. `just check` and the hook are the whole of it, which means a gate that is slow or noisy is a gate that gets bypassed — and then it enforces nothing.
- **`--no-verify` bypasses every gate at once**, including the ones you were not trying to skip. Legitimate when the alternative is leaving work uncommitted; run `just check` before you push either way.
- **No comment states a quantity a reader has to trust.** This used to be "a figure carries its measurement date", which failed in the ordinary way: the dates went unwritten, the figures went stale in silence, and a dated figure is still one nobody can check without leaving the sentence. `.chug/tasks/check-figures.sh` enforces the ban and its header carries the rule — what makes a figure legitimate, what the gate cannot see, and why a proved specification is prose like any other. Read it there rather than here; a rule with two homes has two versions of itself inside a year. The one surface it leaves alone is `docs/design/*.md`, because a doc arguing a decision has to be able to cite the measurement that motivated it, dated and with the command that reproduces it.
- **A rule needs a failure it can prevent here.** Before adding one, name the thing that goes wrong in *this* tree if it is absent. A rule adopted because it sounds right is a rule nobody can apply a refutation trigger to.
- **Nothing reviews its own work.** `.chug/tasks/review-change.md` is the reviewer's brief, and it is written to be run in a **fresh session** that did not author the change — an agent handed its own diff re-reads its intentions instead of the code, and agrees with itself. Until there is a platform to run it as an evaluation task, run it by hand before anything lands. It is also where the standing rules and commitments are written, so **an author is bound by it too** — read it before writing, not only before reviewing.
- **Don't run destructive commands** — deploys, restarts, data resets — without asking first.
