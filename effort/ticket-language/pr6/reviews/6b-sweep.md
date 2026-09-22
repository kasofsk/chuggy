# Mutation sweep — PR 6b "Structured task identity", whole branch

Reviewed at `f8691ffd` in `~/claude/chuggy-wt/identity-sweep`, detached, scope
`git diff 1e986583..f8691ffd`. Fresh session; I authored none of it. Each
mutation was applied alone, proved to have changed its file, and reverted; the
worktree was byte-clean when removed. Both `node_modules` symlinked, no
`npm ci`.

## APPROVE

Eighty-two mutations plus two reachability controls, over every added or
changed behaviour the brief names. Sixty-one went red in the narrowest gate or
suite that should catch them. **Twenty-one survived; none is a behaviour
defect.** Five are provably equivalent, inert or structurally non-informative;
the rest are proof gaps, gathered into six findings a cheap case each closes.
Three false lines in the model's own headers are findings of the class this
branch already took twice. The round ships; findings 1–3 are the ones I would
land before the PR.

Baseline at this tip, all run here and all clean: check-model (114) ·
check-model-api · check-conformance (11 goldens) · check-random (2000 runs) ·
check-source (6 stages, 207 unit suites) · check-postgres (76 suites) ·
`migration.test.ts` (87, own database) · check-queries · check-console (1300
vitest) · check-console-sheets · check-boundaries · check-figures ·
check-comments · check-paths · doc-lint · check-duplication · check-gates ·
check-shell-quoting · check-knowledge. `emit-goldens.sh` reproduces all eleven
byte for byte. `model/task-contract/task.qnt` diffs empty against the package.

## The table — red

| # | mutation | went red in |
|---|---|---|
| Q1, Q3 | `.qnt` `spawnWork` repeats the cycle / the identity carries the index | check-model ×2 |
| Q2 | `.qnt` `stageGeneration` constant 1 | `executionBlockedEvaluationResumeFreshTest` |
| Q5 | `.qnt` `stageGeneration` counts every evaluator | same test |
| X3b | the copy edited (`taskOwner` reads the cycle) | `evaluationResumeWitness` — the copy is gated |
| M1, M2 | `spawnWork` repeats the cycle / does not move the counter | 23 and 12 unit cases |
| M3, M4, M6 | `stageGeneration` constant / across cycles / at the wrong stage | `decisionSemantics`, `recovery` |
| M7, M8 | the identity carries the index / evaluators from zero | 21 and 10 cases |
| M9, M10 | an evaluation names the previous cycle / a work ordinal of zero | 13 and 1 |
| M11, M13, M14 | equality ignores the generation / `evalStage` returns the key / rework counted at the failing cycle | `task`, 18 cases, 4 cases |
| M15 | ordinal order reversed | `deciders`, `invariants`, `task`, `vocabulary` |
| M16–M21 | each conjunct of `idsAccounted`, `taskIdentitiesValid`, `tasksWellFormed` (both arms, the ordinal run) and `recordWellFormed` | `invariants` ×1 each |
| M22, M23, M24 | `outstandingTaskIn` by arm alone / equality drops the counter / `TaskDone` enablement drops the live check | `journal`+`enablement`, `equality`, `journal`+`recovery` |
| M25, M26 | the mint repeats per set / counts the live set twice | 1 case each |
| M29, M32 | the requirement key admits stage zero / the roster takes `ExplicitTask` back | `executionRequirement`, `rosters` |
| X1, X2 | the contract's copy renames the stage / drops the work cycle | `responses`+`rosters` ×2 |
| A2 | a work row names stage zero | check-postgres, 284 cases |
| S1–S12 | 008's guard; `cycle` nullable; the work arm admitting a stage; the stage's index floor; the evaluation arm's generation; the `evaluator` grant; `NOT value ? 'tid'`; the evaluation arm on the work arm's cycle field; the door swapping stage and generation; the door building the cycle off the wire integer; a typo in `TicketDefault`; 010 unregistered | `migration.test.ts`, on exactly the case that owns each |
| G1, G2 | the ITF vocabulary swaps cycle and stage / encodes the ghost as the counter | check-conformance ×2 |
| G3 | the manifest miscounts a golden's steps | check-conformance |
| C1, C3 | the run cut by generation (the pre-fix defect) / cut at the highest stage | 1 and 7 console cases |
| C6–C13, C16–C18 | the set key drops the generation; `stageLabel` +1; `stageExpected` by the key; the cycle ordinal counted; `runStageKey` merges cycles; `identityCycle` reads the generation; the superseding cycle from the wrong side / off by one; `stageRowLabel` +1; the page ordered by execution identity; stage rows from zero | 1–30 console cases each |

## Findings

1. **`src/adapters/postgres/operationalReads.ts:146` — no gate ever executes
   the evaluation arm of the boundary's identity.** A control that makes that
   arm throw unconditionally passes check-postgres whole (76 suites), so every
   evaluation row in the tree reaches the executions read as a Work row or not
   at all. Downstream, four mutations survive check-postgres, check-queries,
   check-conformance and the unit suite: `decision.ts:351` writing the
   generation into `cycle` (A1) and swapping stage and generation (A1b), and
   `operationalReads.ts:150,154` dropping both refusals (A4, A5) and swapping
   the cycle and the stage on the way back out (A6). A1 is the serious shape:
   `submit_task_completion` journals the `TaskDone`'s `workCycle` from that
   column, so a wrong write makes every evaluator completion name a cycle that
   is not live and be absorbed as stale. The write arm *is* reached (a control
   there reddens 140 cases) — only its values are unasserted, because every
   fixture has cycle, stage, generation and evaluator all 1. Fix: one case that
   registers a SpawnEvaluation whose four counters differ and reads it back
   through `postgresOperationalReads.executions`, asserting `row.identity`.
   `test/postgres/operationalReads.test.ts:264` is where it belongs. House
   rule 13.

2. **`src/adapters/postgres/schedulerRows.ts:221` — the tree's one
   column→index translation is unpinned.** Deleting the `- 1` survives
   check-postgres, check-queries, check-conformance and the unit suite. That
   value is `LogicalExecution.stage`, which reaches `purposeBlock` in
   `taskBriefing.ts:513` — the stage's authored command block — and the pod
   document's `stage`. The only fixture that reaches `executionRowLogical`
   (`test/adapters/schedulerRows.test.ts:33`) sets `stage: null`, so the
   translation the whole 010 floor change rests on has never run in a test.
   Fix: one case there with `task_kind: "Evaluation", stage: "1"` asserting
   `execution.stage === 0`.

3. **`ui/chuggy-ui/app/core/ticketLedger.ts:21` names a decider that does not
   exist**, and **`:10` keeps the claim this PR deleted everywhere else.**
   `decideEvaluateTicket` appears nowhere in the tree; the two spawn sites are
   `decideWorkReduce` (`model/domain.qnt:410`) and `decideResumeTicket`
   (`:581`). `:10` says `task` is "the ticket-wide ordinal the model issues in
   sequence" — the model issues no task numbers at all now, which is exactly
   what `ids.ts:26-31` and `finalizerPreparation.ts:33-36` were rewritten to
   say. E's commit rewrote both paragraphs. The same class in the model: **`model/ticket.qnt:19`
   and `model/domain.qnt:651` both say `evalStage` derives the stage "from the
   live set's kind marks"**, and `TaskKind` left the model; **`model/ticket.qnt:271`
   says the spawn ghost makes "history-unique *sequential* identity" a checked
   theorem**, contradicting `domain.qnt:1004`, which A rewrote to drop the
   word. Round 1's finding 2 and D's fix were this sentence at `domain.qnt:348`;
   these four were not reached. None is in the diff, and all four became false
   because of it.

4. **`src/domain/ticket.ts:108` — the TS `stageGeneration`'s `evaluator === 1`
   conjunct is unproved while the model's is.** Dropping it survives the unit
   suite, check-conformance and check-random; the same drop in
   `model/ticket.qnt` reddens `executionBlockedEvaluationResumeFreshTest`. A
   stage of fan-out two re-entered by a resume would then number its second run
   generation 3, which the console draws as the run's ordinal. No TS fixture
   has a fanned-out stage a resume re-enters. Fix: mirror the model's own case.

5. **`ui/chuggy-ui/app/core/ticketLedger.ts:318-327` — two of `runsCutOf`'s
   three clauses and `taskSetMapOf`'s merge are unpinned, and the module header
   states all three as properties.** Numbering a run by the position rather
   than by `set.generation` (C2), dropping `open === undefined ||` (C4) and not
   merging two sets of one stage (C5) all survive 1300 console cases. Each
   shows on a page whose cycle lost its stage-1 generation-1 row — reachable
   through `ticketExecutionsFolded`'s delete frame, the same input round 1's
   finding 2 used. Confirmed on pages I built: the tip reads that page's run as
   ordinal 2 and C2 reads it as 1; the tip is total where C4 throws
   `TypeError`. Fix: two cases in `test/ticketLedger.test.ts` beside E's.

6. **Four one-line floors nothing asserts.** `ungroupedLabel`
   (`TicketLedger.tsx:379`) takes a `+ 1` back with 1300 console cases green —
   it is the one stage number the page draws before the draft arrives, and this
   PR moved exactly that offset; the existing case at
   `ticketPageLedger.test.tsx:465` draws seven rows and asserts no label.
   `taskIdentityValid`'s `stage`, `generation` and `evaluator` floors relax to
   `>= 0` unnoticed (`task.ts:212-216`); `test/domain/task.test.ts:78-81` pins
   two of the six counters. `executionSummarySchema.identity`
   (`responses.ts:514`) goes `.optional()` unnoticed, though
   `responses.test.ts:560` already deletes a field *inside* it. And
   `materializeExecutionRequirement`'s new `stage < 1`
   (`executionRequirement.ts:423`) relaxes to `< 0` unnoticed.

## Survivors that are not findings

- **C15 — provably equivalent.** `stageOrdinalWork` back to `-1`: an identity's
  stage is `>= 1`, so both sort work first and both label it "Work". The
  comment saying so is true.
- **M28 — inert.** The `named(held, …)` filter on a spawn: `spawnOn` refuses a
  non-empty set, so `after.tasks ∩ before.tasks` is always empty.
- **Q4, X3, G4 — structurally non-informative.** Weakening a model invariant
  (`taskIdentitiesValid` → `true`) cannot red an invariant *search*; the model
  red-proofs no invariant, and the TS mirror pins this one (M17). Likewise
  `refinement.qnt:342`'s `TaskDone` enablement and `draws.ts:189`'s `permitsIn`
  are guards over a draw already constrained to a live outstanding task, so
  weakening either changes no reachable step. M24 pins the TS equivalent.
- **M27 — unobservable today, and I did not file it.** The cancel arm minting
  off `after` rather than `before` (`decisionPlan.ts:192`) survives
  check-postgres whole, though eleven live cases reach that arm. It would name
  task numbers the ticket never spawned; nothing reads a cancel request's task
  rows (`schedulerRegisterCancellation` retires by ticket), so it is inert
  rather than wrong. Worth one assertion if that arm ever gains a reader.

## Docs pass and fabric alignment

Finding 3 is what the docs pass turned up. Everything else the diff touches
reads true, checked on the code: 010's "the stage was already granted at the
baseline" (`privileges.ts:454`, and the api's set is exactly
`tenant, project, request, task, kind, stage` — true) and "nothing in
`privileges.ts` spells a new signature" (`:248-249`, parameter for parameter —
true); `decisionPlan.ts:94`'s "`execution_names_one_logical_task` … a silent
no-op insert" (`constraints.ts:103` is that UNIQUE and `scheduler.ts:405` is
`ON CONFLICT … DO NOTHING` — true); `schedulerRows.ts:12-17`'s "every reader of
a stage here reads it through this translation" (all four other readers of the
column take it positive: `scheduler.ts:388` into `materialize`,
`operationalReads.ts:161` into the identity, and `:738,1000,1116` plus
`schedulerCompletion.ts:127` into `executionRowLogical` — true);
`ticket.qnt:361`'s "every work spawn site (dispatch, both reworks, the work
resume)" (four `spawnWork` calls in `domain.qnt`, four in `deciders.ts` —
true); `AGENTS.md:12-14`'s attribution (`domain.qnt:976,1033` — true, round 2's
fix holds). check-figures, check-comments, check-paths and doc-lint are 0, and
the branch states no lesson (house rule 16).

**Fabric alignment: clean.** Nothing under `.chug/`, `images/` or `deploy/`
names `tid`, a task identity or a stage index, and neither does
`~/claude/chuggy-fabric`. `images/worker/entrypoint.mjs:228` reads
`task.taskKind`, which this branch did not move, and the worker reads no stage
at all — which is what finding 2 protects.

## Notes

- **On E's fix, as the fresh eyes the addendum asked for.** I rebuilt the
  reviewer's page (stage 1 gen 1 Blocked → stage 1 gen 2 Passed → stage 2 gen 1
  Passed) and two of my own — a second block giving stage 1 gen 3, and a resume
  re-entering stage 1 with stage 2 already passed at gen 1 and passing again at
  gen 2 — through `ticketLedger`. All three read true: runs `[1 Superseded,
  2 Current]`, `[1, 2 Superseded, 3 Current]` and `[1 Superseded, 2 Current]`,
  each superseded run `["1 Blocked", "2 Skipped"]` or `["1 Passed",
  "2 Blocked"]`, each current run `["1 Passed", "2 Passed"]`, and every cycle
  summary `cycleLastSet` at stage 2 Passed with `complete` true. Mutating the
  cut rule back to a generation bucket reddens E's own case with run 1 as
  `["1 Blocked 2", "2 Passed 4"]`, which is the defect round 1 described.
- Round 2's sources case is in the table as S11: a typo in `'TicketDefault'`
  reddens "an execution registered under a requirement a task named is
  refused", so 0b8e93e7's fix bites.
- I did not mutate the goldens' step bodies: they are the model's output and
  `emit-goldens.sh` owns them. I mutated the manifest (G3) and the ITF
  vocabulary (G1, G2) instead.
- Practices invoked: `comments-describe-the-code` (the docs pass) and
  `modular-and-layered-code` (findings 1 and 2 are its "test hardest at
  boundaries" — the boundary here is the column round trip).
- Worktree `identity-sweep` removed; every database this sweep made
  (`idsweep_*`) dropped itself.
