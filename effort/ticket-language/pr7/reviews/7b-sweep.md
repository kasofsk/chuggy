# Mutation sweep — PR 7b "The evaluation instance", whole branch

Reviewed at `2acc04d1` in a detached worktree, scope `git diff f8d6c8fd..2acc04d1`.
Fresh session; I authored none of it. Each mutation was applied alone, proved to
have changed its file, and reverted; the worktree was byte-clean when removed.

## APPROVE

**137 mutations** over the model, the protocol copy's mirror, the domain, the
actor, the interpreter, the adapters, 012, the contract and the console. **113
went red in the narrowest gate or suite that should catch them. 24 survived; none
is a behaviour defect** — eleven equivalent, inert or structurally
non-informative, thirteen proof gaps gathered into seven findings a cheap case
each closes (1–4 are the ones I would land), plus two false comments.

Baseline at the tip, all clean: unit suites 1326, console `vitest run` 1308,
`migration.test.ts` 95 (own database `sweep7b`, dropped), conformance 10, random
walk 7 at 2000 samples, `model-api` 4, `quint test` 48 plus witnesses and the
refinement, five doc gates 0. `diff` of `evaluation.qnt` against the package at
76c95a9 prints exactly the six hunks `model/AGENTS.md` names and nothing else;
`task-contract/task.qnt` is verbatim. Nothing under `.chug/`, `images/`,
`deploy/` or in `~/claude/chuggy-fabric` names `EvalReduce`, `ExecutionBlocked`,
`ReduceEvaluation` or `submit_task_completion`; `images/worker` keeps `Pass|Fail`,
which is decision 3.

## The table — red

| # | mutation | went red in |
|---|---|---|
| q1–q9 | `.qnt` `currentInstance` first; `withInstance` appends; `instanceRuns` drops the current run; `runSpawnTotal` ignores the generation; `spawnEvalRun` claims one slot; `beginEvaluation` stamps `workCyclesStarted` / names `j+1`; `liveTasks` owes nothing in Evaluation / keeps a settled work task | `quint test` ×1–4 each |
| q10–q16 | `.qnt` work wall taken as a failed task; settled evaluator drawn as a stage advance; blocked parks at the failure wall; the owed guard dropped; the disposition inverted; passed → Done; `workProduced` inverted | `quint test` ×1–6 each |
| e1, e2, e4–e6, e8–e12, e19 | `concludeStage` blocks before it fails / does not wait; `resumeBlocked` re-asks every evaluator / keeps the generation; `statusBlocked` drops `EvaluatorProcessFailed`; `taskIdentityFor` uses the index; generation 0; obligations owe the whole roster; `concludeStage` re-asks its own stage; `applyFailure` swaps the kinds; `begin` asks the last stage | `deciders`, `task`, `invariants`, `enablement`, `witnesses`; e10/e11 non-terminating; e12/e19 in `check-conformance` |
| t1–t11, t14–t19 | `withInstance`/`currentInstance`/`instanceRuns` as q1–q3; `runSpawnTotal`; the cap counting every cycle / every failure; `liveTasks` both ways; `spawnEvalRun`; `reportValid` evidence 0; the verdict always a pass; `retireLive` keeps the task; `spawnWork` mints nothing; `runningStageIndex` 0; `owesTask` compares nothing | `deciders`, `ticket`, `invariants`, `reworkCap`, `enablement` |
| d1–d8 | the phase routed the wrong way; the work wall as a failed task; the stage-advance test inverted; passed → Done; the disposition inverted; blocked → the failure wall; the resume not reopening; `workProduced` inverted | `deciders`, `journal`, `recovery` |
| n1, n2, a1–a3, a5 | `completableIn` back to the task phases; `outstandingTaskIn` vacuous; enablement drops `reportMatchesTask` / `reportValid` / the outstanding test / `completableIn` | `enablement`, `hazard`, `decisionSemantics` |
| r1, p1–p4, w1, w3 | the cap read strictly; the mint base by what was asked / by evaluator key / zero-based; the roster narrowed; a stored completion naming a disposition; the ingress parser admitting a completion | `reworkCap`, `i3`, `dispatchWriter`, `wire` |
| i2–i4, i6, i7 | `evaluationsWellFormed` drops the ticket / the program / the blocked-wall agreement; `evaluationsMonotone` admits a rewrite; `tasksWellFormed` admits a live task outside Work | `invariants` ×1 each |
| pw1–pw5 | the transient guard passing everything; the park's evidence override dropped; a continuation parking; the wall evidence on any escalation; the disposition always escalate | `dispatchWriter` (E's two new cases + the evidence case) |
| s1–s4, s6–s17 | 012: `verdict`/`onFailure` unrefused; the failure arm's kind roster and evidence; the evaluation verdict roster; `<> 'array'` restored for `prog`/`deps`; a report naming its ticket; a wall journalled as a process failure; the exhausted retry as a verdict; the blocked evidence naming the ticket; the CHECK and the door roster without `ProcessFailed`; the outcome folded back to `Failed`; the guard deleted; the identity's evaluator | `migration.test.ts`, on exactly the row that owns each |
| x1–x6 | the exhausted retry submitted as `Failed`; `schedulerSettle` ignoring what it was told; a completion resolved as an ordinary `Decide`; a `ReduceEvaluation` continuation scheduled; the finalizer-rework bundle without `preparation`; acceptance admitting `TaskDone` as an ordinary tag | `schedulerStore`, `readiness`, `finalizerRework`, `privileges` |
| c1–c8, c10–c14, c18, c20, c21 | the fold keeping one generation; every row Current; superseded first; the verdict over every generation; a blocked stage short-circuiting; `executionStopped` both ways; `stageExpected`; `cycleLastSet` first; the totals key without cycle / generation; `generationLabel`; the label without the generation; `resumedStage` over any stage that ran; "Evaluation cancelled"; the raw outcome word | 1–6 console cases each |

## Round 1's fixes, each re-proved here

D's five: c1 (the superseded fold) reddens the sum case; c5 the queued-after-block
case; c18 the resumed-stage predicate; c20 the copy; c13/c14 the spelling. E's
five: x5 (1a, the bundle), pw1/pw2/pw3/pw5 (1b, the park), x6 (2, the privileges
guard), pw4 (3, the evidence gating), x1/x2/s13/s15 (5, `ProcessFailed` on the
row). 2acc04d1's two: c6/c7 (`executionStopped`) and c21 (the project table)
redden; **`summaryVerdict`, the other half of that commit, does not** — finding 1.

## E's park (addendum)

**No durable unreadable input can still defer forever.** The only landing that
still defers durable evidence is a continuation, and exactly one continuation
kind survives this branch: `ReduceWork` (`readiness.ts` throws on any other, x4
reddens). Its spawn is an evaluation, so `observe` takes the `Evaluation` arm,
whose only unreadable is `workSource` answering `undefined`
(`executionSourceObservation.ts:84-86`) — needing the newest `SpawnWork` row, its
bundle's `Repository` and its `TargetCommit` (`executionSourceHistory.ts:55-57`),
all three of which every spawn path writes via `inputBundleReferencesOf` from
`source` or from `evidence.preparation` on the finalization path, which x5 pins.
The wedge is unreachable by construction; every other durable unreadable is
refused to a client or parked. Noted, not filed: where main raised
`IntegrityContradiction` the tip returns `{ deferred }`, so a broken construction
would starve the writer silently rather than say so.

**The name does not mislead.** The row's own line is `escalationEvidenceLabel`
(`codeLabels.ts:156`) → "Ref unreadable" / "Remote denied", so the park is not
read as a judgement about the work. Transient guard (pw1) and override (pw2)
redden, as do pw3–pw5. **Every generation a row (D):** c1 reverts
`evaluatorRowsOf` to the highest-only fold and reddens `ticketLedger.test.ts`'s
three-row case on exactly the assertion that the rows sum to the cycle's rollup.

## Findings

1. **`TicketLedger.tsx:427` `summaryVerdict` is unpinned, and is `setVerdict`
   written twice.** `return "Failed";` for its last line leaves `vitest run`
   1308/1308, so the half of 2acc04d1 drawing an ungrouped stopped evaluator has
   no case. It is `ticketLedger.ts:179` `setVerdict` over a one-row list, arm for
   arm: delete it and export `setVerdict`, closing gap and duplicate at once.
2. **`ticketLedger.ts:390` `cycleComplete` counts superseded rows against the
   roster.** `row.evaluators.length >= row.expected` for
   `stageEvaluatorsCurrent(row).length` survives every console suite: a
   two-evaluator stage whose first evaluator holds two generations and whose
   second is off the page then reads `complete`, which the file's own header
   promises never happens. One case.
3. **`TicketSituation.tsx:56` `.at(-1)` is unpinned.** D's case holds one running
   resumed stage, so `.at(0)` survives. The differing page is reachable and is
   round 1's finding 2 again — stage 1 blocks, resumes, passes; stage 2 blocks,
   resumes, fails; nothing running, and `.at(0)` names stage 1 while the ledger
   draws stage 2. One case, two settled resumed stages.
4. **`invariants.ts:185` `idsAccounted` only pins the under-mint.** `===` → `>=`
   survives the unit suites, the conformance replay and the walk: everything that
   reddens it mints too few. The over-mint — a spawn site bumping the counter
   twice, what the invariant's header argues about — is unpinned. A hand-built
   ticket with `spawned` one above the sum.
5. **`012-task-report.ts:187` the `arm NOT IN (…)` refusal has no row.** The
   suite's "a report at a constructor this machine has none of" carries no
   `result`, so `jsonb_typeof(produced) <> 'object'` below refuses it either way.
   The shape that clause uniquely catches is a fourth constructor carrying a
   well-formed `result` and `verdict: "EvaluatorPass"`. One row in `taskReports`.
6. **`ticket.ts:288` `reportMatchesTask` is pinned only at the enablement.**
   Admitting a work report for an evaluator survives everything: the decider
   applies nothing and the evaluator stays owed forever. `decisionEventEnabled`
   refuses it (a1 reddens), so the code is right — but the predicate, and
   `decideTaskDone`'s `owesTask` guard (d9), have no case. Two assertions.
7. **`evaluation.ts:515` `evaluatorStatusEquals` ignores what a produced status
   produced.** Dropping `left.value.value === right.value.value` survives,
   weakening `instanceEquals` and so `evaluationsMonotone`: an earlier instance
   rewritten only in a result reference would pass. One value-level assertion in
   `equality.test.ts`, which holds the field roster already.
8. **Two comments the branch made false.** `ticketLedger.ts:39-45` — "one row per
   evaluator …, bounded by `nativeHttpDraftEvaluatorsMax`": D made it one row per
   evaluator *per generation*, and a generation is unbounded, so the bound is the
   page. `codeLabels.ts:82-86` — `gitEvidenceLabel` is "the continuation path's
   own wall": after E, git evidence reaches an escalation only through a
   completion; a continuation defers and never escalates (pw3).

## Survivors that are not findings

Equivalent or inert: `applyProduced`'s `owed` guard (subsumed by `withStatus`'s
`taskCurrent` and the Running invariant's awaiting term); `resumedStage`'s
`running` filter (a running resumed stage is always the highest-numbered);
`reworkEntries` (no TS caller; the model pins it). Non-informative: the two
`reportChoices` arms and `runStageBefore`'s tie-break (a narrower draw cannot fail
a walk); `executionTone`'s `ProcessFailed` arm (a totality test);
`dispositionChoices` and the stored completion's `ticket < 1` (unspellable above
the decoder); `planValid`'s uniqueness and `instanceValid`'s `planValid` (implied
by `programsWellFormed` + `stagesEqual`); `sameKeys`'s cardinality,
`stageRunValid`'s `generation > 0`, `evaluationsWellFormed`'s strict cycle order
and `taskRefOf` reading the generation (nothing observes it).
