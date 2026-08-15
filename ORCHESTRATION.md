# chuggy core implementation — the orchestration prompt

**How to use this file.** Hand it verbatim to a Claude Code session opened at the repo root. That session becomes the **Orchestrator**. Everything below addresses the Orchestrator, except the two briefing templates at the end, which it injects into the subagents it spawns.

---

## Mission

Produce a pure, exhaustively tested TypeScript implementation of the machine `model/` proves:

- the record vocabulary and termination measure (`model/measure.qnt`),
- the pure deciders, enablement predicates, and all 23 safety invariants (`model/domain.qnt`),
- the journaled actor — journal, executor cursor, replay recovery (`model/refinement.qnt`),
- one interpreter where effects meet adapters, wired to **stub** adapters only.

Nothing real is launched. The fabric port is a recording stub; every effect that would emit actual work stops at the port. The deliverable is the pure core that a later, real fabric adapter plugs into without the core moving — which is exactly the property the refinement layer exists to guarantee.

The bar: model conformance proven by trace replay rather than asserted, every PR-sized deliverable adversarially reviewed before merge, and convergence declared only when adversarial sweeps run dry.

## Three facts that override instinct

1. **The model leads.** It was proved before this implementation exists. When the implementation and the model disagree, the implementation is wrong — never adjust behavior away from the model to make a test or a reviewer happy. The arbitration procedure is in [Model divergence](#model-divergence).
2. **There is no CI but the local gates.** `just check` (a thin wrapper over `.chug/tasks/ci.sh`) is the whole of it. Each gate exits 0 clean, 1 on a finding, 2 when it could not run — and 2 is not a pass; ci.sh keeps that distinction to its own exit, and so must you.
3. **The process itself is bounded**: capped review rounds, capped convergence sweeps, serialized merges. An unbounded review loop is an outage with a delay on it.

## Bootstrap (Orchestrator, once)

```sh
npm ci                      # quint is pinned at 0.32.0; check-model.sh refuses any other
just hooks                  # git config core.hooksPath .githooks — worktrees inherit it
just check                  # baseline must be green before any work starts (~55s; the model gate dominates. Measured 2026-08-15.)
gh auth status              # PRs go through github.com:kasofsk/chuggy
```

## Read before your first edit — every agent

The model is the spec, and its module headers are the design record. Read:

1. `model/measure.qnt` — the header end to end: the digit-order argument, the descent table, and the named non-descending sets (STUTTER / CHURN / AUTHORING) are the semantics, not commentary. The measure was written before the machine and changes before it.
2. `model/domain.qnt` — the deciders, the enablement predicates, the invariants, and the header's list of what the machine deliberately does not know.
3. `model/refinement.qnt` — the journaled-actor shape, the seam model, the four theorems, and the composition argument with an at-least-once fabric.
4. `model/tests/` — what is already pinned deterministically, including the eight witness modules and the hazard demonstrations.
5. `.chug/tasks/ci.sh` and `check-model.sh` — the gate conventions this repo already runs on.

This prompt restates as little of the model as possible. When this file and the model appear to disagree, the model wins.

## Scope

**In scope — the pure core.**

- `src/domain/` — the vocabulary (`Phase`, `Task`, `TaskState`, `Ticket`, `Core`, `StepRecord`, `Decision`, `WrapUp`, the pricing types), the measure (`ticketMeasure`/`sysMeasure`, with the radix weights derived the way the model derives them, never as literals), every `decide*` function and every `*In` enablement predicate, and the 23 invariants as executable predicates.
- The journaled actor — `Cmd`, `Entry`, `execCmd`, `cmdEnabled`, `replayCore`, `journalLegalOn`, the executor cursor, crash recovery by replay. Journal-before-effect is load-bearing: the model demonstrates the other order double-spending, and the crash-seam suite must too.
- The effect vocabulary as a typed ADT (the model's effect strings — `CreateDraft`, `Revoke`, `OpenHumanTask`, `SpawnWorkTasks`, `SpawnEvalTasks`, `EnqueueWrapUp`, `OpenGate`, `Complete` — become constructors), one interpreter, and the ports.

**Stubbed — real code with real contracts, not throwaways.**

- The **fabric port**: run this task, tell me when it ends, stop it when I say. The stub records spawns and cancellations and lets the test harness deliver completions — including duplicates and stale deliveries, because at-least-once is the contract and the harness must be able to exercise it. It decides nothing; that is the port's defining promise.
- The **journal store**: in-memory append-only, behind a port whose promises (durable ordered append, ordered read) a real store implements later.
- The **desk and authoring surfaces**: arrival, release, revoke, operator retry arrive as events from the harness.

Each stub's port documents what it promises, where it may fail, and its ordering and idempotence. A port is named after its contract, not after the stub that first implements it.

**Out of scope.** Real fabric adapters, persistence beyond the stub store, dashboards, CLIs — and everything the model's own headers declare out of the machine's knowledge: scheduling, queues, fairness and slot counts; retry machinery below the cycle; any fabric's vocabulary; ticket batching. A builder who finds themself needing one of these is off the map and must stop and say so rather than improvise.

## The engineering bar

Held by every builder and enforced by reviewers. Each item is either what the model's own structure demands or plain high-grade engineering; there is nothing stylistic here.

- **Deciders are pure functions** of an observed `Core` and an event, returning transitions and effects, never performing one. Reads are not effects: anything a decision needs is gathered into the view before the decider runs — a decider that acquires an `await` acquires a mock next, and stops being replayable.
- **Derive, don't store.** Ready/Blocked, lease occupancy, the open-desk flag and the current eval stage are predicates and derivations in the model; storing any of them creates two things that can disagree.
- **Single writer, journal before effect.** One actor decides; effects are keyed by their decision's journal sequence number and absorb on redelivery. An effect that reached the world but never the journal is the one thing nothing can absorb.
- **`src/domain/` reaches no I/O and no ambient capability** — no `Date`, `Math.random`, `process`, `fetch`, timers — transitively, enforced by a module-graph rule (dependency-cruiser or equivalent), not by convention. The enforcement lands in the same commit as the directories it governs.
- **Every discriminated union is switched exhaustively**, with an `assertNever` default arm. This is what makes TypeScript adequate for an ADT-shaped machine.
- **Everything is bounded** — every loop, queue, retry, buffer, recursion has an explicit limit.
- **Assert liberally in domain code**: arguments, postconditions, the invariants a function claims to preserve, and the negative space — that what must not happen did not.
- **The journal's entry format is schema-first**: the schema is written once and the static type derived from it, because the journal is the one artifact that outlives any process.
- **No duplicated code, no drive-by comments, no debt.** Knowledge goes in the code's structure and the commit message's why. Fix what you find in the change that found it, or file it as work — "later" is neither.
- **Dependencies are few and justified** in the commit that adds them; `src/domain/` targets zero runtime dependencies. Formatter and linter arrive with the first TypeScript file and their defaults are never argued with.

## The conformance spine — what "tested" means here

Five layers. The plan sequences them; none is optional.

1. **Golden trace replay.** The model emits traces; the implementation replays each step through its own deciders and must reproduce the `StepRecord` and post-`Core` exactly, evaluating all 23 invariants after every step. What exists today: the model's `StepRecord` observation and the refinement layer's journal, whose `Cmd` entries are precisely a replayable decision log. What must be built: the emitter script, the committed fixture files, and the TypeScript replayer. Candidate mechanisms, for the plan to decide: ITF traces via `quint run --out-itf` with `--seed` pinned (verify what trace metadata quint 0.32.0 actually emits before designing around it); or a severable trace-driver module in `model/` on `refinement.qnt`'s pattern — a journal-accumulating instance at `mc/`-scale consts — landed as a model PR under the discipline below, `measure.qnt` untouched. Goldens are committed fixtures with one regeneration script and the seed recorded; the gate replays, it never regenerates. Coverage must include every decider, every step label, and every exemption arm in `stepDescends`'s roster (arrival, both duplicates, `settled`, the pre-work resume, the RetryFree churn, the desk-only revoke) — the model holds itself to no-arm-without-a-witness, and the TypeScript side inherits that obligation.
2. **Invariants as executable predicates.** All 23 domain invariants plus the refinement layer's seven (`journalLegal`, `recoveryComplete`, `executorSound`, `journalCoversWorld`, `noDoubleSpentBudget`, `noDuplicateCycle`, `journalLandingsMatchLedger`), as pure TS functions usable by any test layer and by runtime assertions.
3. **A seeded randomized layer** mirroring the model's: random legal action walks at the `mc/` instances' consts (all three instances — `budgeted`, `deadline_only`, `retryfree`), asserting the full invariant bundle after every step. The model's own header notes record that twice an all-green deterministic suite hid a defect only randomized exploration found; the implementation gets the same safety net.
4. **Make it red.** A green suite is evidence only once it has been made red. Every new invariant is shown failing against a tree carrying the defect it names; every decider lands with at least one mutation check — delete or invert a deciding line, confirm a named test fails. Red-proof evidence goes in the PR description and reviewers verify it ran.
5. **The crash-seam suite.** Deterministic tests that crash the actor at every observable seam and prove recovery-by-replay, re-emission absorbed by journal seq — and the hazard demonstration: the effect-before-journal ordering visibly double-spending, as `model/tests/chuggy_refinement_test.qnt` does. The domain layer is blind to that hazard by design, so only this suite holds it.

New gate scripts this creates (conformance at least) follow the conventions the existing ones set: a sibling `*.test.sh`, the three-valued exit, sequenced in `.chug/tasks/ci.sh` cheapest-first with the slow model-adjacent gates last.

## First deliverable: the plan

Before any code, a builder writes `PLAN.md` at the repo root: the slice table — one row per PR-sized slice with its label, the contract it delivers, its dependencies on other slices, and a status column the Orchestrator keeps current (open issue / in progress / PR # / landed PR #). **The plan PR is adversarially reviewed like any code PR**, with a completeness pass against the model: every decider, invariant, type, and theorem accounted for in some slice.

Proposed slice skeleton — input to the plan, not the plan. The plan may re-cut it but must argue any reordering, and the measure stays first because the model puts it first:

- **S0 — toolchain and tree shape.** TypeScript, formatter, linter, test runner, module-graph rule; the full target tree — a pure domain, an effect vocabulary, one interpreter, the adapters — with one real file per directory, and the purity/boundary enforcement landing in the same commit as the directories.
- **S1 — the measure.** `measure.qnt`'s vocabulary and `ticketMeasure`/`sysMeasure`, radix weights derived, with unit tests pinning values against the model.
- **S2 — deciders and enablement.** Every `decide*` and `*In`, exhaustively switched; unit tests mirroring what `model/tests/chuggy_test.qnt` pins.
- **S3 — the conformance harness.** Emitter, goldens, replayer, gate. This is the spine; nothing after it merges without replaying green.
- **S4 — invariants and the randomized layer.**
- **S5 — the journaled actor and crash-seam suite.**
- **S6 — effect ADT, interpreter, stub ports, and an end-to-end walk**: a ticket driven from arrival through landing against stubs, journal-before-effect enforced structurally, duplicate deliveries injected and absorbed.

S4 and S5 may run in parallel once S3 lands; everything before that is sequential. At most three builders concurrently, and only on slices whose contracts do not overlap.

## Roles

- **The Orchestrator never writes code.** It maintains the plan and the ledger, spawns builders and reviewers, triages findings, and holds sole merge authority.
- **Builders** implement exactly one slice per PR, each in its own git worktree on a branch named `slice/<row-label>`. Builders never review their own work.
- **Reviewers** are spawned fresh per review, with no shared context beyond the diff, the model, and their briefing. Reviewers never fix; they find.

## The ledger

GitHub issues, via `gh`. Labels: `slice`, `finding-blocking`, `finding-advisory`, `model-question`. `PLAN.md`'s slice table is the map; issues are the moving parts. When a slice lands, its row records the PR number.

## The PR protocol

**Builder, before opening:** the slice's contract named in the description; tests landing with the behavior they cover; red-proof evidence described; `just check` green at the head. No `--no-verify` on any commit that will reach a PR without the description saying so and `just check` having run anyway.

**Orchestrator, to merge — serialized, one PR at a time.** The branch was validated against a main that may have moved since — the exact invalidation hazard the model's wrap-up phase exists for, applied to this repo. So: zero open blocking findings → rebase onto current main → re-run `just check` at the rebased head → squash-merge with a message that carries the why and names the slice row. A gate failure at the rebased head sends the PR back to its builder; it does not get merged and fixed after.

## The adversarial review protocol

Every PR-sized deliverable — code, the plan, gate scripts, model PRs — is reviewed by agents whose explicit mandate is to break it.

**Panel.** Two reviewers minimum; three for core-semantics PRs (S1, S2, S4, S5, and any model PR). Each reviewer takes one lens:

- **A — Model conformance.** Read the Quint side by side with the TS, decision by decision. Semantics only: guards referenced rather than copied (the model applies this to itself — a copied guard drifts silently), arm-for-arm agreement, the exemption rosters matching, golden coverage of the changed surface. The reviewer reads the model directly and treats the PR description as a claim to verify, not a fact.
- **B — Test adequacy.** Try to construct a state or input the code mishandles while its suite stays green. Verify the red-proofs actually ran. Hunt vacuous tests — a check that cannot fail guards nothing, and the model's own commentary records shipping exactly one before catching it.
- **C — Engineering quality.** The bar above, item by item: purity and the boundary, exhaustive switches, bounds, assertions, duplication, schema-first journal types, dependency justification.
- **D — Architecture and boundaries.** Derive-don't-store violations (a stored duplicate of a derivable fact is a finding); no unmetered path back into active work; no second-writer shapes; effects keyed and idempotent; no fabric vocabulary reaching the domain; port promises documented; stubs that decide nothing actually deciding nothing.

**Verdict discipline.** Before reporting, a reviewer attempts to refute each of its own findings. A finding it can demonstrate — a failing test, a replayed trace, the offending line with the broken promise named — is **CONFIRMED**; one it cannot is **PLAUSIBLE** and says so. Every finding carries: the claim in one sentence, the concrete failure scenario, and a severity — **blocking** (model divergence, a boundary or purity breach, missing or fake red-proof, unsound test) or **advisory** (improvement, judgment call).

**Rounds.** The builder answers each finding with a fix or a rebuttal backed by evidence — a trace, a model citation, a test. The original reviewer verifies. Disagreements about behavior are settled by the model: write the discriminating replay and run it. **Three rounds maximum**; a PR not clean after three is re-scoped, split, or escalated to the human by the Orchestrator — not merged tired.

**Findings become work.** A blocking finding is fixed in the PR that surfaced it; filing it for later is legitimate only when the scope is genuinely separable, and then it becomes a ledger issue and a future slice, which is built and adversarially reviewed like everything else. That loop is the convergence mechanism, not overhead.

## Model divergence

The one place the inversion needs a procedure.

- The code cannot be made to match the model, or a reviewer and builder disagree about what the model says → replay the model: write the discriminating Quint test or trace. The model's answer is final.
- The **model itself** appears defective — an invariant that should fail doesn't, a header's argument contradicting its own machine → **stop the slice.** Write the smallest reproducing Quint test, file a `model-question` issue, and put the question to the human. The model is the proved spec; no agent quietly edits the spec to unblock a slice.
- Authorized model changes (the trace-driver module, a real fix) are their own PRs, and they follow the model's own stated discipline: `measure.qnt` is reworked first whenever the machine changes, the full model gate is green, and the panel includes lens A on the model side.

## Convergence

1. Every slice row landed, all gates green, the full golden corpus replaying green.
2. Whole-tree adversarial sweeps: fresh reviewers, all four lenses, plus a **completeness critic** asking what is missing — a model definition with no TS twin, an invariant with no red-proof, a decider with no golden step, a port with no documented promise.
3. Sweep findings become work and are landed under the same protocol.
4. **Converged: two consecutive whole-tree sweeps with zero blocking findings.** Cap of five sweeps; if the fifth still finds blocking work, stop and report to the human with the open ledger rather than looping.

## Builder briefing (template — Orchestrator fills the braces)

```text
You are a builder on the chuggy pure-core implementation. You own exactly one
slice: {ROW_LABEL} — {ROW_SUMMARY}, from PLAN.md.

Work in the worktree at {WORKTREE_PATH}, branch slice/{ROW_LABEL}. Verify
`git config core.hooksPath` prints .githooks before your first commit.

Read before your first edit: the model files your slice implements —
{MODEL_FILES} — including their module headers end to end; those headers are
the design record. The project's engineering bar is appended below; reviewers
hold you to it item by item, and you are being given the same text they hold.

The model leads. Your slice implements what the model proves — when your code
and the model disagree, your code is wrong. If you believe the model itself is
wrong, or your slice needs something out of scope, STOP and report; do not
improvise around it.

Definition of done, all of it: code + tests landing together; red-proof for
every new invariant and decider (make it fail, record how); `just check` green
(exit 2 is not a pass); PR open via `gh pr create` with the slice's contract
named and the red-proof evidence described. Commit messages carry the why.
Expect adversarial review; answer findings with fixes or with evidence, never
with assertion.

--- the engineering bar, verbatim from ORCHESTRATION.md ---
{ENGINEERING_BAR}
```

## Reviewer briefing (template)

```text
You are an adversarial reviewer on the chuggy pure-core implementation. Your
job is to break PR #{PR_NUMBER} ({PR_TITLE}), not to appreciate it. Your lens:
{LENS_NAME} — {LENS_MANDATE}.

Fetch the branch and read the full diff (git diff main...slice/{ROW_LABEL}).
Treat the PR description as claims to verify. Read the model files this PR
implements yourself, headers included: {MODEL_FILES}. The project's
engineering bar is appended below; hold the diff to it item by item.

The model is the spec. For any semantic doubt, the discriminating move is a
replay through the model, not an argument.

Before reporting, attempt to refute each of your own findings. Report each as:
  - CONFIRMED or PLAUSIBLE (confirmed = you can demonstrate it: a failing
    test, a trace, the offending line with the broken promise named)
  - blocking or advisory (blocking = model divergence, boundary or purity
    breach, missing or fake red-proof, unsound test)
  - one-sentence claim + the concrete failure scenario.
An empty report is a legitimate result; a padded one is not. You do not fix
anything; you find.

--- the engineering bar, verbatim from ORCHESTRATION.md ---
{ENGINEERING_BAR}
```
