# chuggy — working notes

A job orchestrator: tickets form a DAG, a single journaled actor drives each through authoring → work → evaluation → completion, and the fabric runs the work and decides nothing.

**This repo is unusual in one way that matters before you read anything else: the formal model leads the implementation.** A Quint model of the machine already exists and is proved; it emits golden traces, and this implementation grows up against them. When the model and the code disagree, the code is wrong.

## Where the knowledge is

**`model/` is the specification.** The written standards that used to sit beside it were removed rather than maintained alongside it, and they have not come back. So the tree states what is true of itself in three places, and all three are checkable:

- **`model/`** — the machine, its measure, its refinement and its suites. What it proves, it proves; nothing restates a proved property in prose.
- **each gate's own header** — every script in `.chug/tasks/` opens by stating the rule it enforces. The rule and its enforcement cannot drift apart, because they are the same file, and the argument for either is in the commit that made it. `.chug/tasks/review-change.md` is the same arrangement for the rules no script can decide: a reviewer is what enforces them, so they are written in the reviewer's own brief.
- **`docs/design/`** — one document per decision, in the tense the other two cannot carry. A gate header states a rule it already enforces and the model states what it already proves; a design doc argues a decision before the tree carries it, and a plan sequences work that does not exist yet. That tense is the whole reason for the claim markers below.

This file is the entry point: it routes to those three and holds the conventions none of them can.

**The general standards are skills rather than pages in this tree.** `.claude/settings.json` enables the `blessed-practices` plugins and is the roster. They are invoked through the Skill tool, so a reviewer cites one by name and an author is given the same file. Their content is versioned outside this tree and can move without a commit here, which is why the places above still carry everything that must be true of *this* tree — a skill states what good code looks like anywhere, never what is true here.

## Checks

```sh
just check          # everything
```

A fresh clone needs three things once, and none of them can set itself:

```sh
npm ci              # the pinned quint, and the TypeScript toolchain the gates run
just hooks          # git config core.hooksPath .githooks
docker              # running, or CHUG_PG_URL naming a PostgreSQL the gate may use
```

The pre-commit hook runs the fast subset. It needs that `git config` because git config is not tracked and nothing in a checkout can set it for you; `npm ci` is what turns `check-boundaries` and `check-source` from could-not-run into a verdict, and a could-not-run is not a pass. A server is the same kind of precondition: `check-postgres` drives the durable authority against a real PostgreSQL and can reach no verdict without one, so it says so and exits 2. It is not in the hook, and it prints its own remedy.

Gate scripts live in `.chug/tasks/`, each with a sibling `*.test.sh`. The
slowest by far is `check-model.sh`, which is why it runs last and never in the
hook. A gate exits 0 clean, 1 on a finding, **2 when it could not run** — and 2 is not a pass. Not every gate uses all three: `check-roster` has no finding state, because everything it can detect is the environment. The sequencing lives in `.chug/tasks/ci.sh`; the justfile is a thin wrapper, and the hook calls the scripts directly because `just` may not be installed.

The source tree is layered, with the boundary between layers enforced rather than described: `src/domain/` is pure and reaches nothing outside itself, and each further layer arrives with the slice that fills it and with its own rule in `.dependency-cruiser.cjs`. Those rules are the whole boundary, and `check-boundaries.sh` is what holds the tree to them, over the module graph rather than per file, because the shape that breaks the rule is a helper nobody would call a decider sitting between a decider and the filesystem.

That path is not a placeholder. When this repo is eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh` becomes the command evaluator every job runs, unchanged.

## Conventions that bite if you miss them

- **There is no CI but the local gates.** No Actions, no PR checks, no server. `just check` and the hook are the whole of it, which means a gate that is slow or noisy is a gate that gets bypassed — and then it enforces nothing.
- **`--no-verify` bypasses every gate at once**, including the ones you were not trying to skip. Legitimate when the alternative is leaving work uncommitted; run `just check` before you push either way.
- **Docs are concise, correct, consistent and extremely minimal, and a comment is a doc.** Same bar, in the file the code is in.
- **A design doc holds only what the tree does not yet carry.** Its head — title, `Status:`, the tables — is rewritten freely, and its body argues what nothing enforces yet. Once the tree carries a decision the statement lives in the enforcer and the doc's copy goes: a landed row keeps its pointer, and a correction is an edit rather than a section appended below. `.chug/tasks/check-knowledge.sh` enforces the decidable half of that and its header carries the rule and the limits.
- **A doc that says a path, gate, command or constant exists is making a factual claim about the tree, and that claim is checked or it is marked.** A line naming something this tree does not have carries a marker — `<!-- intent -->` designed but not built, `<!-- runtime -->` correctly absent from git, `<!-- absent -->` named *because* it does not exist. Ordered by tense, and `absent` is honest only when a reader who deleted the marker would still read the line as saying the path is gone. A marker is not a way to leave a stale claim standing, and not a way to hide one: `.chug/tasks/check-paths.sh` still resolves a marked line, still prints it and counts it separately, and its header carries the scope and the exemption.
- **No comment states a quantity a reader has to trust.** `.chug/tasks/check-figures.sh` enforces the ban and its header carries the rule — what makes a figure legitimate, what the gate cannot see, and why a proved specification is prose like any other. Read it there rather than here; a rule with two homes has two versions of itself inside a year.
- **A rule needs a failure it can prevent here.** Before adding one, name the thing that goes wrong in *this* tree if it is absent. A rule adopted because it sounds right is a rule nobody can apply a refutation trigger to.
- **Nothing reviews its own work.** `.chug/tasks/review-change.md` is the reviewer's brief, and it is written to be run in a **fresh session** that did not author the change — an agent handed its own diff re-reads its intentions instead of the code, and agrees with itself. Until there is a platform to run it as an evaluation task, run it by hand before anything lands. It is also where the standing rules and commitments are written, so **an author is bound by it too** — read it before writing, not only before reviewing.
- **Don't run destructive commands** — deploys, restarts, data resets — without asking first.
