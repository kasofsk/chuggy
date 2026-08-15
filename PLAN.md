# PLAN — the pure-core implementation, sliced

The slice table for the TypeScript implementation of the machine `model/` proves, per
ORCHESTRATION.md. The model is the spec; every claim below that could be checked against the
model source was checked against the model source (grep patterns and counts in
[the enumeration](#the-model-surface-enumeration)), not taken from prose. Where a count in
ORCHESTRATION.md differs from the model's, the difference is called out and the plan follows
the model.

## The slice table

One row per PR-sized slice; branch `slice/<label>`. The Orchestrator keeps the status column
current (open / in progress / PR # / landed PR #).

| label | contract delivered | depends on | status |
|---|---|---|---|
| `plan` | This document: the slice table, the trace-mechanism decision, the model-surface enumeration. | — | open |
| `s0-toolchain` | TypeScript (strict), formatter, linter, test runner — defaults never argued with; the target tree (`src/domain/`, `src/effects/`, `src/interp/`, `src/adapters/`, one real file each); the module-graph purity rule (dependency-cruiser or equivalent) forbidding `src/domain/` any transitive path to I/O or ambient capability, landing in the same commit as the directories; a `check-ts.sh` gate (three-valued exit, sibling `*.test.sh`, sequenced in `.chug/tasks/ci.sh` cheapest-first before `check-model.sh`). | plan | open |
| `s1-measure` | `measure.qnt` in TS: all 23 exported types (`Phase` through `Bounds` — roster in the enumeration) and every pure function — the account sizers (`wrapUpBudget`, `reworkBudget`), the named rank ladder and `phaseRank`, `radix`/`stageWeight`/`rankWeight`/`microBound`/`micro`, `ticketMeasure`/`sysMeasure`, and the task plumbing (`firstTaskId`, `spawnTasks`, `nextTaskId`, `spawnOn`, `retireLive`, `resolveTask`, `taskPassed`, `combine`, `runningCount`, `evalStage`, `stagesLeft`, `hasOpenHumanTask`). Radix weights derived exactly as the model derives them, never as literals. Unit tests pin values against the model at the mc consts, including the blindness pins (`measureArtifactBlindTest`, `measureRepoBlindTest` mirrored). | s0-toolchain | open |
| `s2-deciders` | `domain.qnt`'s pure layer in TS: all 13 `decide*` deciders, all 20 `*In` enablement predicates, the shared draw/guard definitions (`deliverableTaskIds`, `wrapUpOutcomes`, `resumeCharge`, `leaseOf`, `waitsOn`, `depArtifacts`), the decision plumbing (`freshTicket`, `withTicket`, `move`, `noop`, `withWrapUpObs`, `escalate`, `completeTicket`), and the authoring universes (`repos`, `wrapUpChoices`, `stageChoices`, `validPrograms`, `defaultProgram`). Consts arrive as an explicit config record (the model's module consts). Every union switched exhaustively with `assertNever`; guards referenced, never copied (the m6 discipline). Unit tests mirror what `model/tests/chuggy_test.qnt` pins (56 runs), including the guarded-unreachable `operator-retry-unreachable` arm, implemented exactly as the model writes it. | s1-measure | open |
| `s3-conformance` | The spine: the ITF emitter script (pinned seeds, `--mbt`; regeneration only ever by script, seed and command recorded per fixture in a manifest that also records each fixture's consts), the committed golden corpus, the ITF decoder, the TS replayer (drive the S2 deciders with each step's recorded action + picks; require exact `StepRecord` and post-`Core` equality), and a `check-conformance.sh` gate (three-valued, sibling test, replays committed fixtures, never regenerates). Corpus coverage obligations, enforced by the emitter and re-checked by the gate: every one of the 13 deciders, every one of the 22 reachable step labels, every one of the 8 `stepDescends` exemption arms, and at least one fixture per mc instance (all three). | s2-deciders | open |
| `s4-invariants` | All 23 domain invariants (the `allInvariants` conjuncts) plus their named halves (`measureNonNegative`, `stepDescends`) as pure TS predicates usable by any test layer and by runtime assertions; the replayer extended to evaluate all 23 after every golden step; the seeded randomized layer mirroring the model's — random legal action walks at the mc consts on all three instances, full bundle asserted after every step; the three anti-vacuity witnesses (`freeClimbNever`, `cascadeParkNever`, `stageAdvanceNever`) as expected-violation probes so the exemption arms stay exercised in TS too. Red-proof per invariant: each shown failing against a tree carrying the defect it names. | s3-conformance | open |
| `s5-actor` | `refinement.qnt` in TS: `Cmd` (12 constructors) and `Entry` — the journal schema written schema-first, static type derived, `StepRecord` stored in the golden-trace vocabulary (the model's effect strings) so the schema is stable before s6's typed ADT; `genesis`, `execCmd`, `cmdEnabled`, `replayCore`, `journalLegalOn`; the world-accounting functions (`hasEffect`, `stepsTicket`, `isSpawnFor`, `isLandingFor`, the four `*SpawnsOn`/`*LandingsOn` counters); the journaled-actor runtime — single writer, journal-before-effect, executor cursor, crash recovery by replay; the journal-store port (in-memory append-only stub, promises documented); all 7 refinement invariants as predicates; the crash-seam suite — crash at every observable seam, recovery-by-replay proven, re-emission absorbed by journal seq, and the hazard demonstration mirroring `chuggy_refinement_test.qnt`: effect-before-journal visibly double-spending (the dispatch double-spend, the rework double-spend, the duplicate cycle). | s3-conformance | open |
| `s6-interpreter` | The effect vocabulary as a typed ADT — the 8 effect strings become constructors, serialized 1:1 to the journal/trace strings; one interpreter; the fabric port stub (records spawns and cancellations, decides nothing; the harness delivers completions including duplicates and stale ones); desk/authoring surfaces as harness events; the end-to-end walk — a ticket driven arrival through landing against stubs, journal-before-effect enforced structurally, duplicate deliveries injected and absorbed. Every port documents what it promises, where it may fail, ordering and idempotence. | s4-invariants, s5-actor | open |

## Sequencing

The proposed S0–S6 skeleton is kept — no reordering. The measure stays first after toolchain
because the model puts it first (standing rule 1: measure.qnt is written before the machine
and reworked before it). `s3-conformance` is the spine: nothing after it merges without
replaying green. Everything before s3 is sequential (each slice consumes the previous one's
exports); s4 and s5 may run in parallel once s3 lands — their contracts do not overlap (s4
owns invariants and the randomized layer, s5 owns the actor and the crash seams). s6 needs
both. At most three builders concurrently, only on non-overlapping slices — in practice one
builder through s3, two on s4∥s5, one on s6.

Two boundaries are sharpened rather than re-cut, and both need saying because
ORCHESTRATION.md's spine text bundles them differently:

1. **Golden-step invariant evaluation lands in s4, not s3.** Spine layer 1 says the replayer
   evaluates all 23 invariants after every step; the invariants themselves are layer 2, and
   the skeleton puts them in S4. s3's exact post-`Core` equality is the stronger check on a
   conforming trace — if the TS state equals the model state, the model already proved every
   invariant there. Evaluating TS invariants over golden states is a test *of the invariant
   predicates* against known-good states, so it lands with the predicates: s4 extends the s3
   replayer in the same gate. Nothing is lost in the window because s3's equality check is
   already strictly stronger for conformance purposes.
2. **The journal schema does not wait for the effect ADT.** s5's `Entry` stores `StepRecord`
   with the model's effect strings — journal rows are golden-trace steps (refinement.qnt says
   exactly this) — so the schema the journal commits to is the trace vocabulary, stable from
   s5 onward. s6's ADT constructors parse/print those strings 1:1; introducing the ADT
   changes no stored byte.

`settle` deliberately has no TS decider and no `Cmd`: the model marks it simulator plumbing
(refinement.qnt journals no counterpart), so its absence from every slice is a decision, not
a gap.

## The golden-trace mechanism (decided)

**Decision: ITF traces via `quint run --out-itf` with `--mbt` and pinned seeds.** The
severable trace-driver model PR is the recorded fallback, scoped to any coverage corner the
search cannot reach.

What quint 0.32.0 actually emits — probed in this worktree, rust backend, 2026-08-15:

- `--out-itf` writes `{#meta, vars, states}`; **every state carries all four domain vars
  fully serialized**: `tickets` (complete `Ticket` records), `lastStep` (the complete
  `StepRecord` — label, transitions, effects, landing), `prevMeasure`, `prevRecords`. Sum
  types arrive as `{tag, value}`, ints as `{#bigint}`, sets as `{#set}`, maps as `{#map}`.
- **Plain ITF is not replayable as decisions.** No action identity, no picks: a `task-done`
  row's tid/verdict is only inferable by diffing task sets, and a `task-done-duplicate` or
  `settled` step's picks are recoverable from nothing — the state is identical and
  `lastStep` carries no tid.
- **`--mbt` closes exactly that gap.** Each state gains `mbt::actionTaken` (the fired domain
  action's name) and `mbt::nondetPicks` (every nondet binder as an Option; the fired
  action's picks are `Some` — verified: `arrive` carries `deps_`/`prog`/`repo_`/`wrapUp_`,
  `taskDone` carries `j`/`tid`/`v`, and so on). Action + picks is precisely the decision
  event — it maps 1:1 onto refinement.qnt's `Cmd` constructors, so the replayer drives the
  TS deciders with the model's own picks and compares `StepRecord` + post-`Core` exactly.
- **Pinned seeds are deterministic**: two runs with `--seed=0x1` produced byte-identical
  traces modulo the `#meta` timestamp (verified by diff, 2026-08-15).
- **Targeted coverage works by violation search**: running with a negated target as the
  invariant yields a trace ending on exactly the step sought, `#meta.status: "violation"`.
  Verified on a named witness (`--invariant=cascadeParkNever` → final step a cascade-parking
  revoke) and on an inline expression (`--invariant='lastStep.label != "wrapup-started"'` →
  found at 20000 samples × 60 steps on the budgeted instance). The model's own anti-vacuity
  witnesses are already this shape and are reused as-is.

The argument, against the trace-driver alternative:

1. **`model/` stays untouched.** No model PR, no spec-editing risk, and no second driver
   roster that can drift from the machine's guards — the exact copied-guard failure the
   model's own history (m6, p3) exists to warn about.
2. **The decision event is native**, not reconstructed: `(actionTaken, nondetPicks) ≅ Cmd`.
3. **Coverage is mechanical**: pinned-seed instance walks for the bulk, one violation-search
   fixture per stubborn target, seeds and commands recorded in the manifest; the emitter
   fails when the committed corpus misses an obligation.
4. **The gate replays, never regenerates** — committed fixtures insulate it from the one
   real risk, `--mbt` being flagged experimental. A quint upgrade that changed the `--mbt`
   shape would break regeneration (a scripted, visible event under the 0.32.0 pin in
   `check-model.sh`), never the gate's verdict on committed goldens.

Fallback: if a coverage obligation resists violation search within the emitter's recorded
sample budget, that corner — and only that corner — is generated by a severable
trace-driver module in `model/` on refinement.qnt's pattern, landed as a model PR under the
model-change discipline (measure first, full gate, lens A on the panel).

## The model-surface enumeration

Counts verified against the `.qnt` source in this worktree, 2026-08-15 (grep patterns
noted). Every item is owned by a slice; the completeness reviewer should check this table
against the source, not against ORCHESTRATION.md.

| surface | count | verified by | slice |
|---|---|---|---|
| `decide*` deciders (domain.qnt) | **13** | `grep 'pure def decide'` — Arrive, Release, Revoke, Dispatch, TaskDone, WorkReduce, EvalStageReduce, WrapUpStart, Dequeue, WrapUpResolve, CompleteDuplicate, RevalFail, OpRetry | s2 |
| `*In` enablement predicates (domain.qnt) | **20** | `grep -E 'pure def [a-zA-Z]+In\('` — revocableIn, retryableIn, depsDoneIn, canArriveIn, dependableIn, draftsIn, revocablesIn, readiesIn, taskPhaseIn, reducibleWorkIn, reducibleEvalIn, wrapUpStartablesIn, holdingIn, doneIn, retryablesIn, isReadyIn, isBlockedIn, dispatchableIn, leaseFreeIn, wrapUpStartableIn | s2 |
| enablement-adjacent shared defs | 6 | deliverableTaskIds, wrapUpOutcomes, resumeCharge, leaseOf, waitsOn, depArtifacts | s2 |
| domain invariants (`allInvariants` conjuncts) | **23** | counted in the bundle — completionExclusive, revokedNeverCompletes, wrapUpIsolation, quietRepoLandsCleanly, leaseExclusive, noLeaseWithoutAKind, artifactWellFormed, reposWellFormed, terminalsAbsorbing, deskConsistent, wrapUpWallNamed, accountsBounded, tasksWellFormed, recordWellFormed, recordMonotone, idsAccounted, programsWellFormed, depsAcyclic, idsDense, stuckSubsetCovered, cascadeSafety, noStructuralDeadlock, measureDescends (= measureNonNegative ∧ stepDescends, both delivered as named predicates) | s4 |
| anti-vacuity witnesses (not in the bundle) | 3 | freeClimbNever, cascadeParkNever, stageAdvanceNever — expected-violation probes | s4 |
| refinement invariants | **7** | `grep '^  val '` refinement.qnt — journalLegal, recoveryComplete, executorSound, journalCoversWorld, noDoubleSpentBudget, noDuplicateCycle, journalLandingsMatchLedger (plus the two bundles refinementCore / refinementInvariants) | s5 |
| theorems (refinement.qnt header) | **4** | refinement (journalLegal), no-double-spend/no-duplicate-cycle (theorem 2's four invariants), recovery completeness, the hazard demonstration | s5 |
| `stepDescends` exemption arms | **8** | the `exempt` disjunction — init; task-done-duplicate; complete-duplicate; settled; operator-retry RPending flavor; operator-retry RetryFree pipeline flavor; ticket-arrived; ticket-revoked desk-only flat | s3 (golden coverage), s4 (predicate) |
| exported types | **25** | `grep 'type '` — 23 in measure.qnt (Phase, TaskKind, TaskOutcome, TaskState, Task, Verdict, Combinator, Stage, WrapUpPricing, ReworkPolicy, RetryPricing, Resume, Reason, WrapUpOutcome, WrapUpObs, WrapUp, ArtifactMark, Ticket, Core, Transition, StepRecord, Decision, Bounds) + 2 in refinement.qnt (Cmd, Entry) | s1 (23), s5 (2) |
| `Cmd` constructors | 12 | the type's arms; `settle` has none by design | s5 |
| effect strings | **8** | CreateDraft, Revoke, OpenHumanTask, SpawnWorkTasks, SpawnEvalTasks, EnqueueWrapUp, OpenGate, Complete — matches ORCHESTRATION.md's list exactly | s6 (ADT), s3 (trace equality) |
| step labels | 23 (**22 reachable**) | init, ticket-arrived, ticket-released, ticket-revoked, dispatch, task-done, task-done-duplicate, work-passed, eval-stage-passed, eval-passed, rework-started eval_failure, rework-started wrapup_failure, wrapup-started, ticket-done, the five ticket-escalated labels, complete-duplicate, operator-retry, settled — plus operator-retry-unreachable, guarded unreachable (retryableIn refuses RNone), excluded from golden-coverage obligations and implemented as the model writes it | s3 |
| mc instances | 3 | budgeted, deadline_only, retryfree (mc_chuggy.qnt) | s3, s4 |
| pinned model tests inherited as the mirror bar | 56 / 12 / 11 runs | `grep -c '^\s*run '` — chuggy_test.qnt; chuggy_witness_test.qnt (across its 8 witness modules); chuggy_refinement_test.qnt (across its 3 modules) | s2, s4, s5 |

### Where ORCHESTRATION.md and the model differ

- **Exemption arms: ORCHESTRATION.md names 7, the model has 8.** Its parenthetical roster
  (arrival, both duplicates, `settled`, the pre-work resume, the RetryFree churn, the
  desk-only revoke) omits `init`, which is an arm of the `exempt` disjunction and the
  roster's first entry in domain.qnt. The plan plans against 8; `init` is trivially covered
  by every fixture's first step.
- All other stated counts check out against the source: 23 invariants, the named seven,
  four theorems, eight effect strings, eight witness modules, three instances.
- **Model-internal naming drift, flagged for the ledger (not blocking, no planning
  impact):** the prose in measure.qnt's STUTTER set, domain.qnt's roster comment, and
  refinement.qnt's `JLandDuplicate` all say "land-duplicate", but the label the machine
  actually emits — and the goldens will carry — is `"complete-duplicate"`
  (`decideCompleteDuplicate`; the exemption arm matches on the emitted string). The code is
  self-consistent; the prose lags a rename. Worth a `model-question` issue for a
  comment-only model PR, not a stop.
