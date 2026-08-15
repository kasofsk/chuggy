# PLAN — the pure-core implementation, sliced

The slice table for the TypeScript implementation of the machine `model/` proves, per
ORCHESTRATION.md. The model is the spec; every claim below that could be checked against the
model source was checked against the model source (grep patterns and counts in
[the enumeration](#the-model-surface-enumeration)), not taken from prose. Where a count in
ORCHESTRATION.md differs from the model's, the difference is called out and the plan follows
the model. Amended in round 1 of the adversarial panel (PR #2): the domain invariants
re-homed below the spine, s2 split, the trace mechanism made two-tier on probe evidence.

## The slice table

One row per PR-sized slice; branch `slice/<label>`. The Orchestrator keeps the status column
current (open / in progress / PR # / landed PR #).

| label | contract delivered | depends on | status |
|---|---|---|---|
| `plan` | This document: the slice table, the trace-mechanism decision, the model-surface enumeration. | — | landed PR #2 |
| `s0-toolchain` | TypeScript (strict), formatter, linter, test runner — defaults never argued with; the target tree (`src/domain/`, `src/effects/`, `src/interp/`, `src/adapters/`, one real file each); the module-graph purity rule (dependency-cruiser or equivalent) forbidding `src/domain/` any transitive path to I/O or ambient capability, landing in the same commit as the directories; a `check-ts.sh` gate (three-valued exit, sibling `*.test.sh`, sequenced in `.chug/tasks/ci.sh` cheapest-first before `check-model.sh`). | plan | landed PR #8 |
| `s1-measure` | `measure.qnt` in TS: its 23 exported types (`Phase` through `Bounds` — roster in the enumeration) and every pure function — the account sizers (`wrapUpBudget`, `reworkBudget`), the named rank ladder and `phaseRank`, `radix`/`stageWeight`/`rankWeight`/`microBound`/`micro`, `ticketMeasure`/`sysMeasure`, and the task plumbing (`firstTaskId`, `spawnTasks`, `nextTaskId`, `spawnOn`, `retireLive`, `resolveTask`, `taskPassed`, `combine`, `runningCount`, `evalStage`, `stagesLeft`, `hasOpenHumanTask`). Radix weights derived exactly as the model derives them, never as literals. Unit tests pin values against the model at the mc consts, including the blindness pins (`measureArtifactBlindTest`, `measureRepoBlindTest` mirrored). | s0-toolchain | in progress |
| `s2a-guards-work` | `domain.qnt`'s authoring-and-work half: 12 of the 20 `*In` predicates (`canArriveIn`, `dependableIn`, `draftsIn`, `revocablesIn`, `revocableIn`, `readiesIn`, `isReadyIn`, `isBlockedIn`, `depsDoneIn`, `dispatchableIn`, `taskPhaseIn`, `reducibleWorkIn`) with the shared read/draw defs `waitsOn`, `depArtifacts`, `deliverableTaskIds`; the authoring universes (`repos`, `wrapUpChoices`, `stageChoices`, `validPrograms`, `defaultProgram`) and `freshTicket`; the decision plumbing `withTicket`, `move`, `noop`, `escalate`; deciders `decideArrive`, `decideRelease`, `decideRevoke` (the atomic cascade), `decideDispatch`, `decideTaskDone`, `decideWorkReduce` (6 of 13). Consts arrive as an explicit config record (the model's module consts). Every union switched exhaustively with `assertNever`; guards referenced, never copied (the m6 discipline). The `chuggy_test.qnt` runs whose subjects live here, mirrored. | s1-measure | open |
| `s2b-eval-gate-desk` | The other half: the remaining 8 `*In` (`reducibleEvalIn`, `wrapUpStartablesIn`, `wrapUpStartableIn`, `leaseFreeIn`, `holdingIn`, `doneIn`, `retryablesIn`, `retryableIn`) with `wrapUpOutcomes`, `resumeCharge`, `leaseOf`, `withWrapUpObs`, `completeTicket`; deciders `decideEvalStageReduce`, `decideWrapUpStart`, `decideDequeue`, `decideWrapUpResolve`, `decideCompleteDuplicate`, `decideRevalFail`, `decideOpRetry` (the remaining 7, including the guarded-unreachable `operator-retry-unreachable` arm, implemented exactly as the model writes it). The 56-run mirror of `chuggy_test.qnt` closes with this slice. | s2a-guards-work | open |
| `s2c-invariants` | All 23 domain invariants (the `allInvariants` conjuncts) plus the named halves (`measureNonNegative`, `stepDescends`) as pure TS predicates — over `Core` plus one step of history exactly where the model reads it (`lastStep`, `prevMeasure`, `prevRecords`: `wrapUpIsolation`, `quietRepoLandsCleanly`, `terminalsAbsorbing`, `recordMonotone`, `stepDescends` are step-invariants) — usable by any test layer and by runtime assertions. Red-proof per invariant: each shown failing against a tree carrying the defect it names. Their model home is `chuggy_domain`, so their slice home is the domain layer, below every consumer. | s2b-eval-gate-desk | open |
| `s3-conformance` | The spine, and the single owner of the decision-event vocabulary: the `Cmd` type (12 constructors) with `execCmd` (total dispatch onto the s2 deciders) and `cmdEnabled` (enablement over an explicit `Core`, referencing the s2 predicates); the two-tier golden corpus (mechanism below) — emitter, manifest (command, seed, consts per fixture), committed fixtures; the ITF decoder, both tiers decoding into the one `Cmd` vocabulary; the replayer — drive `execCmd` per step, require exact `StepRecord` and post-`Core` equality, and evaluate all 23 s2c invariants after every step (spine layer 1 to the letter), with the stutter/settled treatment specified in the mechanism section; a `check-conformance.sh` gate (three-valued, sibling test, replays committed fixtures, never regenerates). Coverage obligations enforced by the emitter and re-checked by the gate: all 13 deciders, all 22 reachable step labels, all 8 `stepDescends` exemption arms, at least one fixture per mc instance. | s2c-invariants | open |
| `s4-random` | The seeded randomized layer mirroring the model's: random legal action walks at the mc consts on all three instances, the full 23-invariant bundle (s2c) asserted after every step; the three anti-vacuity witnesses (`freeClimbNever`, `cascadeParkNever`, `stageAdvanceNever`) as expected-violation probes, so the exemption arms and the cascade stay exercised in TS, not dead. | s3-conformance | open |
| `s5-actor` | `refinement.qnt`'s runtime: `Entry` — the journal schema written schema-first, static type derived, reusing s3's `Cmd` and storing `StepRecord` in the golden-trace vocabulary; `genesis`, `replayCore`, `journalLegalOn` (thin folds over s3's `execCmd`/`cmdEnabled`); the world-accounting functions (`hasEffect`, `stepsTicket`, `isSpawnFor`, `isLandingFor`, the four `*SpawnsOn`/`*LandingsOn` counters); the journaled-actor runtime — single writer, journal-before-effect, executor cursor, crash recovery by replay; the journal-store port (in-memory append-only stub, promises documented); all 7 refinement invariants as predicates; the crash-seam suite — crash at every observable seam, recovery-by-replay proven, re-emission absorbed by journal seq, and the hazard demonstration mirroring `chuggy_refinement_test.qnt`'s 11 runs (the dispatch double-spend, the rework double-spend, the duplicate cycle), whose expects conjoin the s2c domain bundle exactly as the model's do. | s3-conformance | open |
| `s6-interpreter` | The effect vocabulary as a typed ADT — the 8 effect strings become constructors, serialized 1:1 to the journal/trace strings; one interpreter; the fabric port stub (records spawns and cancellations, decides nothing; the harness delivers completions including duplicates and stale ones); desk/authoring surfaces as harness events; the end-to-end walk — a ticket driven arrival through landing against stubs, journal-before-effect enforced structurally, duplicate deliveries injected and absorbed. Every port documents what it promises, where it may fail, ordering and idempotence. | s4-random, s5-actor | open |

## Sequencing

The skeleton's order is kept; round 1 re-cut its grain. The measure stays first after
toolchain because the model puts it first (standing rule 1: measure.qnt is written before
the machine and reworked before it). `s3-conformance` is the spine: nothing after it merges
without replaying green. Everything before s3 is sequential (each slice consumes the
previous one's exports); s4 and s5 run in parallel once s3 lands — their contracts no
longer overlap even implicitly, because s5's mirror bar (the refinement suite's expects)
conjoins the domain bundle, which lives in s2c, below both. s6 needs both. At most three
builders concurrently, only on non-overlapping slices — one through s3, two on s4∥s5, one
on s6.

What round 1 changed, and why:

1. **The 23 invariant predicates moved from the old s4 into s2c** (panel F2): their model
   home is `chuggy_domain` — the domain layer — and both downstream consumers need them:
   s3's replayer (spine layer 1) and s5's crash-seam suite (every `expect` in the model's
   refinement tests conjoins the domain bundle; refinement.qnt makes that load-bearing for
   theorem 4). This also retires round 0's re-cut argument (a) entirely: spine layer 1
   lands whole in s3 — exact equality *and* the 23 evaluated after every step — with
   nothing deferred and nothing left to argue.
2. **s2 split into s2a/s2b** (panel F5): guards land beside the deciders they guard, the
   56-run mirror splits by subject and closes at s2b. The split costs no schedule —
   everything pre-s3 was sequential already — and keeps each lens-A read (Quint beside TS,
   decision by decision) within a three-round review's grasp.
3. **s5 stays one slice** (F5's second half, declined with argument): with
   `Cmd`/`execCmd`/`cmdEnabled` homed in s3 and the domain bundle in s2c, what remains is
   one runtime shape whose crash-seam suite is inseparable from the actor it crashes — a
   split would land an actor without its seam proofs, the exact thing the layer exists to
   hold, and tests land with the behavior they cover (the bar).
4. **Kept from round 0:** the journal schema does not wait for the effect ADT. s5's
   `Entry` stores `StepRecord` with the model's effect strings — journal rows are
   golden-trace steps (refinement.qnt's own words) — so the schema is stable from s5
   onward; s6's ADT constructors parse/print those strings 1:1, changing no stored byte.

`settle` has no TS decider and no `Cmd` — the model marks it simulator plumbing, and
refinement.qnt journals no counterpart. Its replay treatment is owned by s3 and specified
in the mechanism section: a settled step drives no decider and verifies post-`Core`
identity plus the exact settled noop record.

## The golden-trace mechanism (decided; amended in round 1)

**Decision: a two-tier ITF corpus, both tiers emitted by the pinned quint 0.32.0, `model/`
untouched.**

- **Tier 1 — sampled walks and targeted violation search:** `quint run --out-itf --mbt`
  with pinned seeds, on the three mc instances. Covers the bulk of the obligations, with
  native decision events.
- **Tier 2 — deterministic witness exports:** `quint test --out-itf` on the model's
  *existing* witness modules (`model/tests/chuggy_witness_test.qnt`). Covers exactly the
  obligations sampling cannot reach — not a coincidence but the model's own design: the
  witness suite exists under the no-arm-without-a-witness rule to pin deterministically
  what random exploration misses, and the implementation inherits those traces as
  fixtures.

### What was probed (this worktree, quint 0.32.0, rust backend, 2026-08-15)

Tier-1 capability:

- `quint run --out-itf` emits `{#meta, vars, states}`; every state carries all four domain
  vars fully serialized — `tickets` (complete `Ticket` records), `lastStep` (the complete
  `StepRecord`: label, transitions, effects, landing), `prevMeasure`, `prevRecords`. Sum
  types arrive as `{tag, value}`, ints as `{#bigint}`, sets as `{#set}`, maps as `{#map}`.
  Probe: `quint run model/mc/mc_chuggy.qnt --main=mc_chuggy_budgeted
  --invariant=allInvariants --max-steps=5 --seed=0x1 --mbt --out-itf=…`.
- **Plain ITF is not replayable as decisions** — no action identity, no picks: a
  `task-done-duplicate` step's picks are recoverable from nothing.
- **`--mbt` closes exactly that gap**: each state gains `mbt::actionTaken` and
  `mbt::nondetPicks` (every nondet binder as an Option; the fired action's picks are
  `Some` — verified: `arrive` carries deps/prog/repo/wrapUp, `taskDone` carries j/tid/v,
  and so on). Action + picks is the decision event, 1:1 with the `Cmd` vocabulary.
- **Pinned seed ⇒ identical trace outside `#meta`** (comparison rule below):
  diff-verified across two same-seed `--seed=0x1 --mbt` runs.
- **Violation search reaches what sampling favors**: `--invariant=cascadeParkNever` (seed
  0x2a, 500 samples × 30 steps) violates on a cascade-parking revoke; the inline form
  works — `--invariant='lastStep.label != "wrapup-started"'` found the dequeue at seed
  0x2a, 20000 × 60.

The limit of Tier 1 — found by lens B in round 1, confirmed here: **two mandatory
obligations resist violation search.**

- The RetryFree pipeline-resume exemption arm:
  `quint run model/mc/mc_chuggy.qnt --main=mc_chuggy_retryfree --invariant=freeClimbNever
  --max-samples=10000 --max-steps=100 --seed=0xf1` → `[ok]` (not found) in 17s; the same
  at 100000 × 100 exceeded a 90s wall cap without verdict; lens B: not reached across
  ~240k traces, budgets to 200000 × 100, multiple seeds.
- The `ticket-escalated wrapup_budget_exhausted` label:
  `quint run model/mc/mc_chuggy.qnt --main=mc_chuggy_budgeted
  --invariant='lastStep.label != "ticket-escalated wrapup_budget_exhausted"'
  --max-samples=10000 --max-steps=100 --seed=0xb1` → `[ok]` in 21s; same 90s-cap result
  and lens-B negatives.

Both targets sit behind chains of ~15–25 correctly-drawn steps (two full gate loops; a
rework loop into a park plus the resume) against uniform action and verdict draws — the
search is not close, and no further seed hunt is planned.

Tier-2 capability: `quint test` has `--out-itf` (one trace per test) and no `--mbt`. Both
resistant obligations are **already pinned by existing deterministic witness traces at
exactly the mc consts**, verified by export:

- `chuggy_witness_free_test::freeClimbDeterministicTest` (consts ≡ `mc_chuggy_retryfree`):
  a 16-state trace ending on the resistant arm — `operator-retry`, PEscalated →
  PEvaluating.
- `chuggy_witness_multirepo_test::movedReworkAttributedTest` (consts ≡
  `mc_chuggy_budgeted`): an 18-state trace containing `rework-started wrapup_failure` and
  ending on `ticket-escalated wrapup_budget_exhausted`.
- Command: `quint test --main=<module> --out-itf='…_{test}_{seq}.itf.json'
  model/tests/chuggy_witness_test.qnt`.

### Decode and comparison rules (owned by s3; one `Cmd` vocabulary)

- **Tier 1**: `(mbt::actionTaken, mbt::nondetPicks)` → `Cmd`, directly.
- **Tier 2**, by state reconstruction into the same `Cmd` vocabulary: transitions carry
  the stepped ticket; the task-set diff carries tid and verdict; an arrival's authored
  data rides the new ticket record; a dequeue's `moved` is encoded by the target phase, a
  resolution's outcome by its label. Every non-stutter step is fully determined, and the
  witness traces are deterministic — a decode failure is an emitter-time error, never a
  gate-time guess.
- **Stutter steps** (`task-done-duplicate`, `complete-duplicate` — their picks are
  structurally absent from any state pair): verify post-`Core` identity and the exact
  noop `StepRecord`, and drive the decider across the full absorbing pick class (every
  resolved-live and retired task id, both verdicts, for the task duplicate; every Done
  ticket for the landing duplicate) — bounded by the ticket's id history, and strictly
  stronger than replaying the one lost pick. **`settled` steps**: no decider driven;
  post-`Core` identity plus the exact settled noop record. The emitter may truncate a
  trailing settled run to one representative step (settle dominates long retryfree
  walks); the corpus keeps at least one settled step.
- **Comparison ignores `#meta` wholesale** — both `timestamp` and `description` embed the
  generation time. The ITF `vars` array lists the two `mbt::` entries twice (a 0.32.0
  quirk the decoder tolerates), and `{#set}`/`{#map}` contents carry no order guarantee
  across regenerations — the decoder and any fixture diffing compare them as sets and
  maps, order-insensitively, never as byte arrays.

### The argument

1. **`model/` stays untouched — now including the two resistant obligations.** Tier 2
   consumes the witness suite the model already maintains under its own
   no-arm-without-a-witness discipline; nothing is added to the model, so no model PR, no
   spec-editing risk, and no second driver roster to drift (the m6/p3 lesson).
2. **One decision-event vocabulary, one owner.** Native where sampling emits (Tier 1),
   reconstructed deterministically where the model's own pins are the source (Tier 2) —
   both into s3's `Cmd`, which s5's journal then reuses.
3. **Coverage is mechanical and enforced**: the emitter fails when the committed corpus
   misses an obligation; every fixture's command, seed, and consts live in the manifest.
4. **The gate replays, never regenerates**: committed fixtures insulate the verdict from
   `--mbt`'s experimental status and from quint upgrades — either would break scripted
   regeneration visibly under the 0.32.0 pin in `check-model.sh`, never the gate.

Fallback, one line further down than in round 0: if a *future* obligation is reached by
neither tier — sampling cannot find it and no witness pins it — that is first a hole in
the model's own witness discipline; the fix is the severable trace-driver module
(refinement.qnt's `journalStep` pattern, whose journal var carries the decision events
in-state, so plain `--out-itf` suffices), landed as a model PR under the model-change
discipline. Nothing currently known needs it.

## The model-surface enumeration

Counts verified against the `.qnt` source in this worktree, 2026-08-15 (measurement
procedures noted; where a raw grep over-counts, the raw figure and the discriminating
procedure are both stated). Every item is owned by a slice; the completeness reviewer
should check this table against the source, not against ORCHESTRATION.md.

| surface | count | verified by | slice |
|---|---|---|---|
| `decide*` deciders (domain.qnt) | **13** | `grep 'pure def decide'` — Arrive, Release, Revoke, Dispatch, TaskDone, WorkReduce (s2a); EvalStageReduce, WrapUpStart, Dequeue, WrapUpResolve, CompleteDuplicate, RevalFail, OpRetry (s2b) | s2a (6), s2b (7) |
| `*In` enablement predicates (domain.qnt) | **20** | `grep -E 'pure def [a-zA-Z]+In\('` — rosters split as in the two slice contracts | s2a (12), s2b (8) |
| enablement-adjacent shared defs | 6 | deliverableTaskIds, waitsOn, depArtifacts (s2a); wrapUpOutcomes, resumeCharge, leaseOf (s2b) | s2a, s2b |
| domain invariants (`allInvariants` conjuncts) | **23** | counted in the bundle — completionExclusive, revokedNeverCompletes, wrapUpIsolation, quietRepoLandsCleanly, leaseExclusive, noLeaseWithoutAKind, artifactWellFormed, reposWellFormed, terminalsAbsorbing, deskConsistent, wrapUpWallNamed, accountsBounded, tasksWellFormed, recordWellFormed, recordMonotone, idsAccounted, programsWellFormed, depsAcyclic, idsDense, stuckSubsetCovered, cascadeSafety, noStructuralDeadlock, measureDescends (= measureNonNegative ∧ stepDescends, both delivered as named predicates) | s2c |
| anti-vacuity witnesses (not in the bundle) | 3 | freeClimbNever, cascadeParkNever, stageAdvanceNever — expected-violation probes | s4 |
| refinement invariants | **7** | the conjuncts of `refinementCore` (journalLegal, recoveryComplete, executorSound, journalLandingsMatchLedger) plus the three further conjuncts of `refinementInvariants` (journalCoversWorld, noDoubleSpentBudget, noDuplicateCycle). Raw `grep -E '^  val ' model/refinement.qnt` yields 14: these 7 + the 2 bundles + the 5 re-exposure wrappers (allDomainInvariants, memCore, obs, measureNow, measurePrev) | s5 |
| theorems (refinement.qnt header) | **4** | refinement (journalLegal), no-double-spend/no-duplicate-cycle (theorem 2's four invariants), recovery completeness, the hazard demonstration | s5 |
| `stepDescends` exemption arms | **8** | the `exempt` disjunction — init; task-done-duplicate; complete-duplicate; settled; operator-retry RPending flavor; operator-retry RetryFree pipeline flavor; ticket-arrived; ticket-revoked desk-only flat | s3 (golden coverage), s2c (the predicate) |
| exported types | **25** | `grep -cE '^  type ' model/measure.qnt` → 23 (the anchored form; unanchored `grep 'type '` also matches 2 comment lines) — Phase, TaskKind, TaskOutcome, TaskState, Task, Verdict, Combinator, Stage, WrapUpPricing, ReworkPolicy, RetryPricing, Resume, Reason, WrapUpOutcome, WrapUpObs, WrapUp, ArtifactMark, Ticket, Core, Transition, StepRecord, Decision, Bounds — plus Cmd and Entry in refinement.qnt | s1 (23), s3 (Cmd), s5 (Entry) |
| `Cmd` constructors | 12 | the type's arms; `settle` has none by design (replay treatment: s3, mechanism section) | s3 |
| effect strings | **8** | CreateDraft, Revoke, OpenHumanTask, SpawnWorkTasks, SpawnEvalTasks, EnqueueWrapUp, OpenGate, Complete — matches ORCHESTRATION.md's list exactly | s6 (ADT), s3 (trace equality) |
| step labels | 23 (**22 reachable**) | init, ticket-arrived, ticket-released, ticket-revoked, dispatch, task-done, task-done-duplicate, work-passed, eval-stage-passed, eval-passed, rework-started eval_failure, rework-started wrapup_failure, wrapup-started, ticket-done, the five ticket-escalated labels, complete-duplicate, operator-retry, settled — plus operator-retry-unreachable, guarded unreachable (retryableIn refuses RNone), excluded from golden-coverage obligations and implemented as the model writes it | s3 |
| mc instances | 3 | budgeted, deadline_only, retryfree (mc_chuggy.qnt) | s3, s4 |
| pinned model tests inherited as the mirror bar | 56 / 12 / 11 runs | `grep -c '^\s*run '` per file — chuggy_test.qnt (unit; mirrored across s2a/s2b); chuggy_witness_test.qnt (8 modules; inherited as s3's Tier-2 fixtures and s4's expected-violation probes); chuggy_refinement_test.qnt (3 modules; mirrored in s5) | s2a, s2b, s3, s4, s5 |

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
