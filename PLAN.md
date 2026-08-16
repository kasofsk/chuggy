# PLAN — the pure-core implementation, sliced

The slice table for the TypeScript implementation of the machine `model/` proves, per
ORCHESTRATION.md. The model is the spec; every claim below that could be checked against the
model source was checked against the model source (grep patterns and counts in
[the enumeration](#the-model-surface-enumeration)), not taken from prose. Where a count in
ORCHESTRATION.md differs from the model's, the difference is called out and the plan follows
the model. Amended in round 1 of the adversarial panel (PR #2): the domain invariants
re-homed below the spine, s2 split, the trace mechanism made two-tier on probe evidence.

**This is the branch's own map, and it is the only one.** `README.md` and `CLAUDE.md` are
upstream main's files, synced into this branch and describing main — a tree where `model/`
lives alone and no implementation exists — so their status prose is true where it is written
and is not this branch's to edit. An implementation slice that "corrected" README's status
would be editing another branch's description of itself, and the correction would arrive as
a conflict the next time main moved. What is true of the code in this branch is stated here
and in the headers of the files themselves.

## The slice table

One row per PR-sized slice; branch `slice/<label>`. The Orchestrator keeps the status column
current (open / in progress / PR # / landed PR #).

| label | contract delivered | depends on | status |
|---|---|---|---|
| `plan` | This document: the slice table, the trace-mechanism decision, the model-surface enumeration. | — | landed PR #2 |
| `s0-toolchain` | TypeScript (strict), formatter, linter, test runner — defaults never argued with; the target tree (`src/domain/`, `src/effects/`, `src/interp/`, `src/adapters/`, one real file each); the module-graph purity rule (dependency-cruiser or equivalent) forbidding `src/domain/` any transitive path to I/O or ambient capability, landing in the same commit as the directories; a `check-ts.sh` gate (three-valued exit, sibling `*.test.sh`, sequenced in `.chug/tasks/ci.sh` cheapest-first before `check-model.sh`). | plan | landed PR #8 |
| `s1-measure` | `measure.qnt` in TS: its 23 exported types (`Phase` through `Bounds` — roster in the enumeration) and every pure function — the account sizers (`wrapUpBudget`, `reworkBudget`), the named rank ladder and `phaseRank`, `radix`/`stageWeight`/`rankWeight`/`microBound`/`micro`, `ticketMeasure`/`sysMeasure`, and the task plumbing (`firstTaskId`, `spawnTasks`, `nextTaskId`, `spawnOn`, `retireLive`, `resolveTask`, `taskPassed`, `combine`, `runningCount`, `evalStage`, `stagesLeft`, `hasOpenHumanTask`). Radix weights derived exactly as the model derives them, never as literals. Unit tests pin values against the model at the mc consts, including the blindness pins (`measureArtifactBlindTest`, `measureProjectBlindTest` mirrored). | s0-toolchain | landed PR #10 |
| `s2a-guards-work` | `domain.qnt`'s authoring-and-work half: 12 of the 20 `*In` predicates (`canArriveIn`, `dependableIn`, `draftsIn`, `revocablesIn`, `revocableIn`, `readiesIn`, `isReadyIn`, `isBlockedIn`, `depsDoneIn`, `dispatchableIn`, `taskPhaseIn`, `reducibleWorkIn`) with the shared read/draw defs `waitsOn`, `depArtifacts`, `deliverableTaskIds`; the authoring universes (`projects`, `wrapUpChoices`, `stageChoices`, `validPrograms`, `defaultProgram`) and `freshTicket`; the decision plumbing `withTicket`, `move`, `noop`, `escalate`; deciders `decideArrive`, `decideRelease`, `decideRevoke` (the atomic cascade), `decideDispatch`, `decideTaskDone`, `decideWorkReduce` (6 of 13). Consts arrive as an explicit config record (the model's module consts). Every union switched exhaustively with `assertNever`; guards referenced, never copied (the m6 discipline). The `chuggy_test.qnt` runs whose subjects live here, mirrored. | s1-measure | landed PR #16 |
| `s2b-eval-gate-desk` | The other half: the remaining 8 `*In` (`reducibleEvalIn`, `wrapUpStartablesIn`, `wrapUpStartableIn`, `leaseFreeIn`, `holdingIn`, `doneIn`, `retryablesIn`, `retryableIn`) with `wrapUpOutcomes`, `resumeCharge`, `leaseOf`, `withWrapUpObs`, `completeTicket`; deciders `decideEvalStageReduce`, `decideWrapUpStart`, `decideDequeue`, `decideWrapUpResolve`, `decideCompleteDuplicate`, `decideRevalFail`, `decideOpRetry` (the remaining 7, including the guarded-unreachable `operator-retry-unreachable` arm, implemented exactly as the model writes it). The 57-run mirror of `chuggy_test.qnt` closes with this slice. | s2a-guards-work | landed PR #23 |
| `sync-project-vocabulary` | Unplanned alignment: mirror upstream main's repo→project namespace rename (#34) through src/, absorb the figures-ban gate (#33) and rulings-redo prose (#30), re-verify the run mirror. Added by the Orchestrator when upstream moved during s2b's review. | s2b-eval-gate-desk | landed PR #36 |
| `s2c-invariants` | All 24 domain invariants (the `allInvariants` conjuncts) plus the named halves (`measureNonNegative`, `stepDescends`) as pure TS predicates — over `Core` plus one step of history exactly where the model reads it (`lastStep`, `prevMeasure`, `prevRecords`: `wrapUpIsolation`, `quietProjectLandsCleanly`, `terminalsAbsorbing`, `recordMonotone`, `stepDescends` are step-invariants) — usable by any test layer and by runtime assertions. Red-proof per invariant: each shown failing against a tree carrying the defect it names. Their model home is `chuggy_domain`, so their slice home is the domain layer, below every consumer. | s2b-eval-gate-desk | landed PR #38 |
| `s3-conformance` | The spine, and the single owner of the decision-event vocabulary: the `Cmd` type (12 constructors) with `execCmd` (total dispatch onto the s2 deciders) and `cmdEnabled` (enablement over an explicit `Core`, referencing the s2 predicates); the two-tier golden corpus (mechanism below) — emitter, manifest (command, seed, consts per fixture), committed fixtures; the ITF decoder, both tiers decoding into the one `Cmd` vocabulary; the replayer — drive `execCmd` per step, require exact `StepRecord` and post-`Core` equality, and evaluate all 24 s2c invariants after every step (spine layer 1 to the letter), with the stutter/settled treatment specified in the mechanism section; a `check-conformance.sh` gate (three-valued, sibling test, replays committed fixtures, never regenerates). Coverage obligations enforced by the emitter and re-checked by the gate: all 13 deciders, all 22 reachable step labels, all 8 `stepDescends` exemption arms, at least one fixture per mc instance. | s2c-invariants | landed PR #41 |
| `s4-random` | The seeded randomized layer mirroring the model's: random legal action walks at the mc consts on all three instances, the full 24-invariant bundle (s2c) asserted after every step; the three anti-vacuity witnesses (`freeClimbNever`, `cascadeParkNever`, `stageAdvanceNever`) as expected-violation probes, so the exemption arms and the cascade stay exercised in TS, not dead. | s3-conformance | landed PR #46 |
| `s5-actor` | `refinement.qnt`'s runtime: `Entry` — the journal schema written schema-first, static type derived, reusing s3's `Cmd` and storing `StepRecord` in the golden-trace vocabulary; `genesis`, `replayCore`, `journalLegalOn` (thin folds over s3's `execCmd`/`cmdEnabled`); `domain.qnt`'s `installCore` — the refinement-layer seam, which s3 deliberately left unlanded because nothing below this slice has a seam to install a replay across; the world-accounting functions (`hasEffect`, `stepsTicket`, `isSpawnFor`, `isCompletionFor`, the `*SpawnsOn`/`*CompletionsOn` counters); the journaled-actor runtime — single writer, journal-before-effect, executor cursor, crash recovery by replay; the journal-store port (in-memory append-only stub, promises documented); all 7 refinement invariants as predicates; the crash-seam suite — crash at every observable seam, recovery-by-replay proven, re-emission absorbed by journal seq, and the hazard demonstration mirroring `chuggy_refinement_test.qnt`'s 13 runs (the dispatch double-spend, the rework double-spend, the duplicate cycle), whose expects conjoin the s2c domain bundle exactly as the model's do. | s3-conformance | landed PR #45 |
| `s6-interpreter` | The effect vocabulary as a typed ADT — the 8 effect strings become constructors, serialized 1:1 to the journal/trace strings; one interpreter; the fabric port stub (records spawns and cancellations, decides nothing; the harness delivers completions including duplicates and stale ones); desk/authoring surfaces as harness events; the end-to-end walk — a ticket driven arrival through landing against stubs, journal-before-effect enforced structurally, duplicate deliveries injected and absorbed. Every port documents what it promises, where it may fail, ordering and idempotence. | s4-random, s5-actor | landed PR #48 |
| `sweep-1-fixes` | Convergence sweep 1 findings (lenses A-D + completeness critic): the recovery cursor's missing world bound, the conformance gate's unpinned finding-producers, the replayer's deletable bundle verdict, the roster staleness alarm, and the cross-slice drift batch. Round 2 extended the roster alarm to the surfaces stated as `val` conjunctions and sum types — `allInvariants`' conjuncts, `Cmd`'s arms, both refinement bundles as separate rosters — closing the class where a model-side addition passed every gate. Sweep findings become work under the same protocol. | s6-interpreter | landed PR #50 |
| `sync-attempt-rename` | Absorb upstream main's `StepRecord.landing` → `attempt` rename (kasofsk PR #51, plus the comments-only prose alignment of kasofsk PR #52 that landed while the slice was cut) through the TS mirrors (`itf.ts`, `entry.ts`, `compare.ts`, `domain.ts`, tests) and the committed corpus, regenerated from the renamed model so `fieldsExactly` re-derives the schema rather than a sed restating it. Sweep 2 finding S2-1 (issue #53); the alarm that would have caught it at gate time is S2-2, in `sweep-2-conformance`. | sweep-1-fixes | landed PR #54 |
| `sweep-2-gates` | Sweep 2's shell-territory findings (issue #53): `check-model.sh` discovers the model's test modules instead of hardcoding them and refuses a suite that ran nothing; `check-duplication.sh` parses its count from the table rather than an ANSI artifact and refuses a collapsed corpus; `doc-lint.sh` makes an empty corpus a could-not-run; plus the gate advisories (exit-code contract on missing tools, the suite-timeout classification, the bare `cd`, `fresh_repo` dedup, stale messages). | sweep-1-fixes | landed PR #55 |
| `sweep-2-conformance` | Sweep 2's findings in the source and the corpus (issue #53): the record/type schema roster (the twelfth alarm — `measure.qnt`'s record fields and `Entry` against `itf.ts`/`entry.ts`); `sumTypeArms`' comment/blank truncation; the refinement bundles' name↔call membership guard; resume-arm coverage granularity with fixtures for the unreached cells; per-fixture length pinning; `recoverFrom`'s brand-launder closure; the dynamic-import ban extended to every layer carrying a reachability rule; the walker `offered` red-proof; the decode both-directions case; the manifest-reader refusal proofs. | sync-attempt-rename | landed PR #56 |
| `sync-wrap-up-vocabulary` | Absorb upstream PR #52's prose vocabulary (landing → wrap-up) through the TS mirrors' own comments and interpreter names (`LandingPort`, `ports.landing`, `landingStep`, and the comment sites — explicitly including model-header-title mirrors and by-type identifiers, not only narrative prose; PR #54's round-1 packet carries the starting roster) — the declared gap PR #54 left rather than widening a mechanical rename into a judgment sweep. The `sync-project-vocabulary` shape, again. | sweep-2-conformance | landed PR #60 |
| `sync-wrap-up-identifiers` | Absorb upstream PR #57: the model renamed its own land-family identifiers (`escLanding`→`escWrapUp`, `jLand`→`jWrapUp`, `quietLandDeterministicTest`→`quietWrapUpDeterministicTest`, both attribution run names) — the exact negative roster PR #60 kept because the model kept it. The slice's demonstration is sweep 2's machinery firing on real drift for the first time: the witness-run roster reds on the merged-but-unmirrored tree. Mirrors, test titles, manifest run fields and the fixture follow; PR #60's keep-arguments for these names are rewritten with them. | sync-wrap-up-vocabulary | in progress |
| `figures-ts-closure` | Close the recorded `check-figures` shadow whole or not at all (lens C's three-part plan, issue #53): widen the corpus glob to `*.ts`, make the comment predicate file-type-aware (a leading `*` is prose in TS block comments and a `case` arm in `.sh`/`.qnt`), and rewrite the spelled-quantity surface the widened gate uncovers. A half-fix converts a declared gap into a silent one. | sweep-2-conformance | planned |

## Convergence

The protocol: whole-tree sweeps (lenses A–D plus a completeness critic, each a fresh
session), every finding fixed under the slice protocol, until two consecutive sweeps
return zero blocking findings; the sweep cap is ORCHESTRATION.md's, and hitting it
reports to the human the same as converging does.

**Sweep 1: complete; fixes landed as PR #50.** Its structural result, in one line: the
machine was cross-checked and the checkers were not — every blocking finding was a hole
in a gate, an alarm, or a recovery bound rather than in the machine the model proves.
All were closed and each closure verified by the lens that found it, red-proof by named
test. Sweep 2 runs on the repaired tree and its briefs carry the checker-checking class
explicitly.

**Sweep 2: complete; NOT clean.** The consolidated packet is issue #53; the work is the
`sync-attempt-rename`, `sweep-2-gates` and `sweep-2-conformance` rows above. The machine
again came up sound — decider-body mutations die, `cmdEnabled` matches the model conjunct
for conjunct, every enumeration row re-derives — and the findings again live in the
checking apparatus, one level further out than sweep 1 reached: upstream state (the model
here was behind main's rename and nothing looked), gates holding hand-copied model facts
(`check-model.sh`'s module lists), the committed evidence files as second statements of
the model (fixture truncation slack, the un-rostered record schemas), and controls without
red proofs (the walker's payload-space alarm, the manifest reader's refusals). Sweep 3
runs after the three rows land.

**Sweep 2 fix work: landed** as PRs #54, #55 and #56, each
through the full round protocol with every closure verified by the finder that filed it.
Carried out of the fix rounds as recorded context, none blocking: `decideOpRetry`'s
`RWrapUp` arm is held by a deterministic driveTrace script with two live red-proved
refutation triggers, pending the model-side witness run that would let the corpus carry
it (the model-question issue tracks it); one stale count-shaped comment survives at the
`no-restricted-imports` heading in `eslint.purity.config.js` and the obfuscation-limit
paragraph's reassurance clause is scoped to the pure core while the rules now reach
further — both comment-level, both for sweep 3's record.

Recorded by sweep 1's verification, carried forward as context rather than opened as
findings:

- **`model/measure.qnt` is not opened by the roster alarm.** Its exported types have no
  list-shaped TS counterpart for a roster comparison to hold; a new field on a decoded
  type is caught instead by `itf.ts`'s `fieldsExactly` on regeneration. Declared here so
  the shadow is a decision, not an oversight.
- **`.chug/tasks/check-figures.sh` scans `*.md`, `*.sh`, `*.qnt`, the hook and the
  justfile — TypeScript comments are outside its corpus.** The ban is the tree's rule and
  the gate is one surface of it; the most prose-heavy surface is currently enforced by
  review alone (a stale spelled-out count in a `.ts` comment shipped and was caught by
  hand in PR #50's close-out). Candidate work for a sweep finding or a follow-up slice.

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

What round 1 changed, and why — **the record of that round, in the numbers it had.**
Where a count below has since moved (the invariant bundle at 23, the mirror at 56), the
moved figure is in the slice table above and the model-surface enumeration below. It is
not back-dated here, because what round 1 decided against what it knew is what this
section is for:

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

- **Tier 1 — targeted violation search:** `quint run --out-itf --mbt` with pinned seeds,
  on the three mc instances. Covers the bulk of the obligations, with native decision
  events. Every committed tier-1 fixture is an `expect: violation` search; the plain
  sampled-walk modality this row once also named has no committed representative, because
  a walk that violates nothing pins nothing a violation search does not already pin —
  recorded by sweep 2's critic, declared here rather than left implied.
- **Tier 2 — deterministic witness exports:** `quint test --out-itf` on the model's
  *existing* witness modules (`model/tests/chuggy_witness_test.qnt`). Covers exactly the
  obligations sampling cannot reach — not a coincidence but the model's own design: the
  witness suite exists under the no-arm-without-a-witness rule to pin deterministically
  what random exploration misses, and the implementation inherits those traces as
  fixtures.

### What was probed (this worktree, quint 0.32.0, rust backend, 2026-08-15)

Tier-1 capability:

- `quint run --out-itf` emits `{#meta, vars, states}`; every state carries the domain
  vars fully serialized — `tickets` (complete `Ticket` records), `lastStep` (the complete
  `StepRecord`: label, transitions, effects, attempt), `prevMeasure`, `prevRecords`. Sum
  types arrive as `{tag, value}`, ints as `{#bigint}`, sets as `{#set}`, maps as `{#map}`.
  Probe: `quint run model/mc/mc_chuggy.qnt --main=mc_chuggy_budgeted
  --invariant=allInvariants --max-steps=5 --seed=0x1 --mbt --out-itf=…`.
- **Plain ITF is not replayable as decisions** — no action identity, no picks: a
  `task-done-duplicate` step's picks are recoverable from nothing.
- **`--mbt` closes exactly that gap**: each state gains `mbt::actionTaken` and
  `mbt::nondetPicks` (every nondet binder as an Option; the fired action's picks are
  `Some` — verified: `arrive` carries deps/prog/project/wrapUp, `taskDone` carries j/tid/v,
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
  --max-samples=10000 --max-steps=100 --seed=0xf1` → `[ok]` (not found); the same
  at 100000 × 100, run under `timeout 90`, returned no verdict; lens B: not reached
  across ~240k traces, budgets to 200000 × 100, multiple seeds.
- The `ticket-escalated wrapup_budget_exhausted` label:
  `quint run model/mc/mc_chuggy.qnt --main=mc_chuggy_budgeted
  --invariant='lastStep.label != "ticket-escalated wrapup_budget_exhausted"'
  --max-samples=10000 --max-steps=100 --seed=0xb1` → `[ok]`; the same `timeout 90`
  result at the larger budget, and lens-B negatives.

Both targets sit behind chains of ~15–25 correctly-drawn steps (two full gate loops; a
rework loop into a park plus the resume) against uniform action and verdict draws — the
search is not close, and no further seed hunt is planned.

Tier-2 capability: `quint test` has `--out-itf` (one trace per test) and no `--mbt`. Both
resistant obligations are **already pinned by existing deterministic witness traces at
exactly the mc consts**, verified by export:

- `chuggy_witness_free_test::freeClimbDeterministicTest` (consts ≡ `mc_chuggy_retryfree`):
  a 16-state trace ending on the resistant arm — `operator-retry`, PEscalated →
  PEvaluating.
- `chuggy_witness_multiproject_test::movedReworkAttributedTest` (consts ≡
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
| domain invariants (`allInvariants` conjuncts) | **24** | counted in the bundle — completionExclusive, revokedNeverCompletes, wrapUpIsolation, quietProjectLandsCleanly, leaseExclusive, noLeaseWithoutAKind, artifactWellFormed, projectsWellFormed, wrapUpWellFormed, terminalsAbsorbing, deskConsistent, wrapUpWallNamed, accountsBounded, tasksWellFormed, recordWellFormed, recordMonotone, idsAccounted, programsWellFormed, depsAcyclic, idsDense, stuckSubsetCovered, cascadeSafety, noStructuralDeadlock, measureDescends (= measureNonNegative ∧ stepDescends, both delivered as named predicates) | s2c |
| anti-vacuity witnesses (not in the bundle) | 3 | freeClimbNever, cascadeParkNever, stageAdvanceNever — expected-violation probes | s4 |
| refinement invariants | **7** | the conjuncts of `refinementCore` (journalLegal, recoveryComplete, executorSound, journalCompletionsMatchLedger) plus the three further conjuncts of `refinementInvariants` (journalCoversWorld, noDoubleSpentBudget, noDuplicateCycle). Raw `grep -E '^  val ' model/refinement.qnt` yields 14: these 7 + the 2 bundles + the 5 re-exposure wrappers (allDomainInvariants, memCore, obs, measureNow, measurePrev) | s5 |
| theorems (refinement.qnt header) | **4** | refinement (journalLegal), no-double-spend/no-duplicate-cycle (theorem 2's invariants), recovery completeness, the hazard demonstration | s5 |
| `stepDescends` exemption arms | **8** | the `exempt` disjunction — init; task-done-duplicate; complete-duplicate; settled; operator-retry RPending flavor; operator-retry RetryFree pipeline flavor; ticket-arrived; ticket-revoked desk-only flat | s3 (golden coverage), s2c (the predicate) |
| exported types | **25** | `grep -cE '^  type ' model/measure.qnt` → 23 (the anchored form; unanchored `grep 'type '` also matches comment lines) — Phase, TaskKind, TaskOutcome, TaskState, Task, Verdict, Combinator, Stage, WrapUpPricing, ReworkPolicy, RetryPricing, Resume, Reason, WrapUpOutcome, WrapUpObs, WrapUp, ArtifactMark, Ticket, Core, Transition, StepRecord, Decision, Bounds — plus Cmd and Entry in refinement.qnt | s1 (23), s3 (Cmd), s5 (Entry) |
| `Cmd` constructors | 12 | the type's arms; `settle` has none by design (replay treatment: s3, mechanism section) | s3 |
| effect strings | **8** | CreateDraft, Revoke, OpenHumanTask, SpawnWorkTasks, SpawnEvalTasks, EnqueueWrapUp, OpenGate, Complete — matches ORCHESTRATION.md's list exactly | s6 (ADT), s3 (trace equality) |
| step labels | 23 (**22 reachable**) | init, ticket-arrived, ticket-released, ticket-revoked, dispatch, task-done, task-done-duplicate, work-passed, eval-stage-passed, eval-passed, rework-started eval_failure, rework-started wrapup_failure, wrapup-started, ticket-done, ticket-escalated work_failed, ticket-escalated rework_budget_exhausted, ticket-escalated wrapup_budget_exhausted, ticket-escalated gas_exhausted, ticket-escalated revalidation_failed, complete-duplicate, operator-retry, settled — plus operator-retry-unreachable, guarded unreachable (retryableIn refuses RNone), excluded from golden-coverage obligations and implemented as the model writes it | s3 |
| mc instances | 3 | budgeted, deadline_only, retryfree (mc_chuggy.qnt) | s3, s4 |
| pinned model tests inherited as the mirror bar | 57 / 12 / 13 runs | `grep -c '^\s*run '` per file — chuggy_test.qnt (unit; mirrored across s2a/s2b); chuggy_witness_test.qnt (8 modules; inherited as s3's Tier-2 fixtures and s4's expected-violation probes); chuggy_refinement_test.qnt (3 modules; mirrored in s5) | s2a, s2b, s3, s4, s5 |

### Where ORCHESTRATION.md and the model differ

- **Exemption arms: ORCHESTRATION.md names 7, the model has 8.** Its parenthetical roster
  (arrival, both duplicates, `settled`, the pre-work resume, the RetryFree churn, the
  desk-only revoke) omits `init`, which is an arm of the `exempt` disjunction and the
  roster's first entry in domain.qnt. The plan plans against 8; `init` is trivially covered
  by every fixture's first step.
- **Domain invariants: ORCHESTRATION.md says 23, the model has 24.** `wrapUpWellFormed`
  joined `allInvariants` in kasofsk PR #30, giving the wrap-up universe the durability
  `projectsWellFormed` and `programsWellFormed` already had. The plan plans against 24, and
  the s2c row above is the contract; ORCHESTRATION.md is the human's mandate text and was
  left as written. **The full site list, so a later editor fixes all of them or none:**
  ORCHESTRATION.md lines 12 ("all 23 safety invariants"), 51 ("the 23 invariants as
  executable predicates"), 84 ("evaluating all 23 invariants after every step") and 85
  ("All 23 domain invariants") — every one of them the same fact.
- **Refinement invariant name: ORCHESTRATION.md:85 says `journalLandingsMatchLedger`; the
  conjunct is `journalCompletionsMatchLedger`.** No definition of the cited name exists in
  `refinement.qnt`, at this branch's base or on current main, so the citation resolves to
  nothing. Corrected in the enumeration row above; recorded rather than edited here, for
  the same reason as the count.
- **ORCHESTRATION.md:31's `just check` baseline no longer adds up.** It states a dated
  whole-suite duration and attributes it to the model gate. Two stages have been added to
  the sequencer since that measurement — the TypeScript gate and its fixture suite — so
  the total is low and the attribution is no longer the whole story. Recorded, not edited:
  the figure sits in the mandate text, and `.chug/tasks/check-figures.sh` is the standing
  answer to figures of this kind everywhere it can reach.
- Every other count ORCHESTRATION.md states checks out against the source. Each row above
  ships the procedure that re-derives its own figure, which is where to check it rather
  than trusting a line that says it was checked.
- **Model-internal naming drift — RESOLVED upstream.** This entry used to record that
  the model's prose still said "land-duplicate" where the machine emits
  `"complete-duplicate"`. The model has since lost the old name entirely (grep for it in
  `model/` returns nothing at the head PR #54 synced), so the drift no longer exists;
  the entry stays as the record that it once did and was caught. `JLandDuplicate` at
  `src/spine/entry.test.ts` is a correct negative fixture — a tag outside the vocabulary
  that must be refused — not a survivor.
