# PR 7 survey — Import evaluation_protocol (chuggy main e9a6136e, 2026-09-22)

Read-only, against the plan table's PR 7 row and the package's `evaluation.qnt`
at the pin 76c95a9. Paths are under `/home/geoff/claude/chuggy`; the fabric is
`/home/geoff/claude/chuggy-fabric`.

## Surprises

1. **`evaluation.qnt` cannot be copied verbatim and used at this pin.**
   `EvaluatorDefinition = {key, task: TaskDefinition}` (`evaluation.qnt:4-7`)
   and `planValid` demands `taskDefinitionValid(entry.task)` (`:468`) — four
   positive opaque refs, every producer of which PR 6 moved to PR 8
   (`pr6/survey.md:294`, Split b). `EvaluationInput` is the same wall twice:
   `invariant` requires `workResult > 0` **and** `acceptedSourceRef > 0`
   (`:475-476`), and chuggy's model has an artifact number
   (`model/ticket.qnt:226,237`, `domain.qnt:413`) but **no source ref at all** —
   the accepted commit lives only in the adapter
   (`src/interpreter/executionSource.ts:9-14`). PR 6b's verbatim precedent does
   not survive this row.
2. **A keyed evaluator breaks the wire integer's injectivity, silently.**
   `decisionPlan.ts:96-102` mints `spawnedBefore + taskOrdinal(identity)` and
   `taskOrdinal` is the evaluator number (`src/domain/task.ts:82-89`), while
   `spawnOn` bumps `spawned` by the set's *size* (`model/ticket.qnt:381`). Keys
   `{1,3}` make the next set restart at `spawnedBefore+2` and re-mint 3, which
   collides on `execution_names_one_logical_task`
   (`constraints.ts:103`) under `ON CONFLICT … DO NOTHING`
   (`scheduler.ts:405`): a lost registration, no error. Mint by position in the
   ordered set, not by the key.
3. **Sparse keys also drop tasks out of the record.** `retireLive` walks
   `range(1, tasks.size() + 1)` matching `taskOrdinal` (`model/ticket.qnt:426-429`),
   so a set keyed `{1,3}` retires one task and `idsAccounted`'s
   `spawned == record.length + tasks.size` goes red in the next state. Same root
   as 2: three places assume evaluator ordinals are `1..n` dense.
4. **There is no per-evaluator authoring today, at any layer.** A stage is a
   width (`StageDefinition = {fanout: int}`, `model/ticket.qnt:118`), the
   configuration's `evaluations[]` is one block per *stage*
   (`taskConfiguration.ts:44-58`), the briefing selects
   `configuration.evaluations[stage]` (`taskBriefing.ts:468-476`,
   `executionSchedulerRun.ts:495-502`), and the requirement key is
   `Evaluation:<stage>` (`executionRequirement.ts:426-430`). A fan-out of N is N
   **identical** evaluators on one brief. Keying them changes an authored
   repository file read back through a digest-pinned revision
   (`.chug/configurations/chuggy-development.json:48`, two stages, one block
   each) — not a model-and-schema change with a console follow-up.
5. **The manifest's `Pass|Fail` is the worker's attestation, and should not
   move.** `images/worker/result.mjs:6` and `checks.mjs:258` emit it,
   `resultManifest.ts:573-578` accepts it, `submit_worker_result` refuses
   anything else (`baseline/functions.ts:3928`) and seals it into
   `execution_result.verdict` (`relations.ts:321`). `EvaluatorPass|EvaluatorFail`
   (`evaluation.qnt:24`) is the *domain's* vocabulary, and the package has **no
   work verdict at all** — a work task produces a result or reports
   `TerminalFailureReport` (package `ticket.qnt:86-88`). The rename is an
   adapter map.
6. **`TaskDone(Failed)` already does `EvaluatorProcessFailed`'s job.** An
   exhausted safe-retry budget terminalizes as one `TaskDone(Failed)` carrying
   the explicit empty manifest (`executionSchedulerRun.ts:77-83`,
   `schedulerCompletion.ts:77-81,593-610`) — "the job pays" for evaluator death.
   The blocked path is a *second* producer: `ExecutionBlocked` is the five
   definitive walls only (`executionScheduler.ts:610-624`).
7. **`ExecutionBlocked` names no task, and its siblings are deliberately left to
   rot.** `010-task-identity.ts:255-258` journals `ExecutionBlocked{ticket}`;
   `decideExecutionBlocked` reads the phase alone and escalates the ticket
   (`domain.qnt:547-555`). `executionScheduler.ts:86-93` states the consequence:
   the outstanding siblings drain and their completions are "refused by the
   writer as the auditable staleness 006 already describes". Under the package
   those completions become *admissible*. This piece deletes a documented
   staleness path rather than adding one.
8. **`EvalReduce` disappears, and with it the journaled disposition pick.** The
   package reduces inside the terminal report's own decision (`concludeStage`,
   `evaluation.qnt:238-272`); chuggy journals `TaskDone` then `EvalReduce`
   carrying `onFailure` (`actor/decisionEvent.ts:114-118`,
   `projectWriter.ts:396-409`). Folding them puts the disposition on the
   completion event — a journal shape change.
9. **The rework cap reads the record, which is what this PR deletes.**
   `evaluationFailureReworksStarted` walks `record` + `tasks`
   (`src/domain/task.ts:106-122`) for `reworkCap.ts:53-61`. SPIKE decision 1
   puts it on `workCyclesStarted` (`model/ticket.qnt:267`), which cannot
   separate an evaluation rework from a finalization one — the distinction
   `reworkCap.ts:15-22` argues for. The cap gets shorter or it gets a counter.
10. **The console's run cut, fixed four hours ago, is aimed at the wrong rule.**
    `runsCutOf` cuts a cycle's sets "at every set of the lowest stage it holds,
    because that is the stage a spawn enters the program at"
    (`ui/chuggy-ui/app/core/ticketLedger.ts:313-327`, task E, `0e80a7df`). The
    package's resume re-enters the **blocked** stage at generation+1
    (`evaluation.qnt:297-325`), so a resumed run does not begin at the lowest
    stage and folds into the open run. `TicketSituation.tsx:38-43` hard-codes
    "Resumed from stage 1" beside it.
11. **Nothing durable has to change for a `StageRun`.** Domain state is rebuilt
    by replaying the journal (`actor/journal.ts:74-95`,
    `actor/obligations.ts:46-48`); `ticket_projection` is a read model and
    `execution_request_task` already carries `cycle, stage, generation,
    evaluator` in columns with grants (`010-task-identity.ts:120-128`). The
    evaluator column's *meaning* changes — ordinal to authored key — with no
    DDL. The migration work is the journal validator and
    `submit_task_completion`.
12. **The ticket read carries no program, so the console reads the draft.**
    `ticketResponseSchema` (`src/contract/responses.ts:224-256`) has no program
    field; the ledger's `TicketAuthoring` is `DraftResponse["authoring"]`
    (`ticketLedger.ts:68`) and `authoring.program[stage - 1].fanout` is how it
    knows a stage's expected width (`:244`).
13. **PR 3–6 left PR 7 exactly two things.** The `Verdict` rename
    (`pr3/GOAL.md:29`, `pr6/GOAL.md:11,47`) and the placeholder evaluation
    identity (`pr6/survey.md:135,294-295`); `pr5/survey.md:12,20` also parks
    `EvaluationReworkEntry` and `EvaluationBlockedEscalated(EvaluationInstance)`
    here. Nothing else points at this PR.

## 1. The model today against the package

Today. `StageDefinition = {fanout}` (`model/ticket.qnt:118`), `Verdict = Pass |
Fail` (`:110`), `Task = {identity, state}` (`:106`); on the ticket `program`
(`:245`), `tasks` (`:248`), `record` (`:260`), `workCyclesStarted` (`:267`),
`spawned` (`:275`). Derived: `evalStage` off the live set (`:342`),
`stageGeneration` off the record at evaluator one (`:401`), `spawnEvalStage`
(`:412`), `retireLive` (`:423`), `combine` (`:457`). Deciders:
`decideWorkReduce` (`domain.qnt:406`), `decideEvalStageReduce` (`:446`, three
edges with the disposition an input), `decideExecutionBlocked` (`:547`),
`decideResumeTicket` (`:571`, evaluation arm `:580-582`). `Escalation` is six
nullary constructors (`ticket.qnt:172`) with `resumeOf` (`:185`); program
well-formedness is an invariant (`domain.qnt:1040-1046`).

Target: `EvaluationPlan`/`StageDefinition{key, evaluators}`/`EvaluatorDefinition`
(`evaluation.qnt:4-16`), `StageRun{stageIndex, generation, evaluators: int ->
EvaluatorStatus}` (`:38-42`), `EvaluationProgress` (`:44-47`),
`EvaluationState` (`:49-53`), `EvaluationInstance` (`:55-60`); `taskCurrent`
(`:153-161`), `reportProduced` (`:163-195`), `reportWithoutResult` (`:197-236`),
`concludeStage` (`:238-272`), `resumeBlocked` (`:297-325`),
`currentTaskObligations` (`:327-339`), `reworkEntries` (`:355-363`), and the
invariants at `:365,394,405,458,472`.

The instance replaces `program` (→ `plan`), `tasks` (→ `stage.evaluators`, the
live obligation derived by `currentTaskObligations`), `record` (→
`completedStages`, per-evaluator rather than per-task), `evalStage` (→
`stageIndex`), `stageGeneration` (→ `progress.generation`, stored on the run),
`combine` (→ `stagePassed`), `decideEvalStageReduce` (→ `concludeStage`) and
`EvalReduce` (→ the report's own decision). Staying chuggy's: the work side
entirely (`workCyclesStarted`, `spawnWork`, `decideWorkReduce`), `spawned` (the
artifact number and the continuation fence), `artifact`, `Escalation`'s other
five arms and the `Resume` sum.

## 2. Evaluator keys

A stage is a count and nothing else. The count is authored on the ticket
(`src/contract/authoring.ts:24-33`), defaulted one per configured block
(`authoring.ts:490-492`), offered as `1..N_TASKS` (`domain.qnt:93-95`,
`authoring.ts:495`) and capped by the configuration's block count
(`authoring.ts:482-485`). What an evaluator *does* comes from the configuration
by stage index — purpose (`executionSchedulerRun.ts:495-502`), block
(`taskBriefing.ts:468-476`), requirement key `Evaluation:<stage>`
(`executionRequirement.ts:426-430`) — so every evaluator of a stage gets the
same brief.

Keying them changes four things a reader sees. **Authoring:** a stage is a list
of evaluator keys; `programStageSchema` (`authoring.ts:24`) and `choices.stages`
(`authoring.ts:450-453,494-497`, `responses.ts:849-851`) change shape.
**The configuration:** each `evaluations[i]` gains an *optional* `evaluators`
list — absent meaning one evaluator, which keeps every pinned revision the wipe
leaves behind parseable (`taskConfiguration.ts:565-596`) — and the two
checked-in configurations declare theirs. **Dispatch:** briefing and requirement
select `(stage, evaluator)`, so `taskKindDefaults` gains a qualifier or keeps
`Evaluation:<stage>` and says why. **Console:** the creation picker draws a
count (`ticketCreation.ts:538-540`, `TicketProvenance.tsx:133`) and the ledger
reads the expected width off `authoring.program[stage-1].fanout`
(`ticketLedger.ts:244`); both read a roster instead.

## 3. The verdict and the report

The worker attests `{version, verdict: "Pass"|"Fail", report, handoffs,
diagnostics, source?}` (`images/worker/result.mjs:1-9`, `entrypoint.mjs:486-506`,
accepted at `resultManifest.ts:553-580`); `submit_worker_result` seals it
(`baseline/functions.ts:3877,3928,4007-4016`); `submit_task_completion` re-reads
it under lock, refuses a mismatch (`010-task-identity.ts:210,243-245`) and
journals `TaskDone{ticket, task, verdict, result}` (`:269-277`). The rename is
**purely inside chuggy**: the adapter maps `Pass → EvaluatorPass` and, on the
work side, `Fail → TerminalFailureReport(ProcessFailure)`, since a work task has
no verdict in the package. The manifest, the plane function, its grants and the
worker image do not move (surprise 5).

"Evaluator infrastructure death becomes `EvaluationBlocked`" touches two
producers. The **Blocked** arm of `submit_task_completion` (`010:255-258`)
journals `ExecutionBlocked{ticket}` from the five definitive walls, validated at
`:170-174`, and `decideExecutionBlocked` escalates off the phase
(`domain.qnt:547-555`); the evidence stays `execution.blocked_reason`
(`010:303`). The **exhausted-retry** arm is the other and is a
`TaskDone(Failed)` today (`executionSchedulerRun.ts:77-83`). Both become
per-task terminal reports — `TaskExecutionUnavailable` and `TaskProcessFailed`
(`task.qnt:36-39`) — each marking one evaluator and leaving the stage
`Running`. `ExecutionBlocked` stops being ticket-level and gains a task: the
journal shape change, and the retirement of
`executionScheduler.ts:86-93`'s draining siblings.

## 4. Resume at generation+1 keeping passes

`decideResumeTicket`'s evaluation arm respawns the whole lowest stage
(`domain.qnt:580-582`), with `stageGeneration` keeping the second run's
identities distinct (`ticket.qnt:394-408`). `resumeBlocked` instead bumps the
blocked run's generation and re-asks only the blocked evaluators
(`evaluation.qnt:297-325`); passes keep their `Produced` status.
`EvaluationBlockedEscalated` then carries the saved instance (package
`ticket.qnt:53,612-617`) where chuggy's is nullary (`ticket.qnt:172`) — no new
column, because the projection's escalation is derived from replayed state.

The console's run cut becomes wrong, not approximate (surprise 10). Under the
package there is **one** evaluation instance per work cycle and a resume
continues it, so "program run" has nothing to group: the honest shape is
cycle → stages, a stage carrying its generations. `runsCutOf`, `programRunsOf`
and `ProgramRun` (`ticketLedger.ts:307-341`) collapse; `resumedFrom`
(`TicketSituation.tsx:38-43`) reads the blocked stage off the instance instead
of counting runs; `runTotals.ts:259-262`'s `(cycle, kind, stage)` key needs
`generation` or two generations of one stage merge into one figure.

## 5. Schema

Carrying a program or a fan-out: `dispatch_candidate.program` text
(`relations.ts:116`, encoded `decision.ts:239-244`, decoded
`dispatchViews.ts:64`) and `decision_event_is_valid`'s `CreateTicket` arm, which
requires `command_integer(item->'fanout')` per stage (`010:189-195`). Carrying a
task record: nothing — it is replayed (surprise 11). Carrying a verdict:
`execution_result.verdict` with its CHECK (`relations.ts:316,321`) and the
`TaskDone` validator's `value->>'verdict' IN ('Pass','Fail')` (`010:158`).
Carrying a rework count: nothing; it is derived. The identity columns already
carry what a `StageRun` needs to rebuild an obligation at the boundary
(`010:120-128`, read back `operationalReads.ts:141-167`).

So both migrations are journal-shaped, and each needs the wipe because
`journal_entry.entry` is digest-chained; the guard is 008's (`010:113-119`).

- **011 (with 7a):** the `CreateTicket` `prog` arm admits `{key, evaluators}`
  and refuses `fanout`; `dispatch_candidate.program`'s encoding follows (no DDL;
  the table is truncated by the wipe).
- **012 (with 7b):** `decision_event_is_valid` gains the terminal-report arms
  and its `ExecutionBlocked` arm gains a task; `submit_task_completion` is
  rewritten whole again (010's precedent) to journal the evaluation verdict
  vocabulary and name the task on the blocked path; the disposition moves onto
  the completion event and `EvalReduce`'s arm is deleted. Signature unchanged,
  so the grants need not be restated.

## 6. Wire and console

Exposed: `programStageSchema{fanout}` (`authoring.ts:24`) inside
`authoringSchema`, `draftInitializationResponseSchema.choices.stages`
(`responses.ts:849-851`), `dispatchCandidateSchema.program` (`:723`),
`executionSummarySchema.identity/taskKind/task` (`:505-529`),
`executionResultSchema.verdict` over `resultVerdicts` (`:590`,
`rosters.ts:215`). The ticket read carries none of it (surprise 12). Console:
`ticketLedger.ts` whole (the run layer, the width read at `:244`, the labels at
`:469-477`), `runTotals.ts:234-262`, `TicketLedger.tsx`, `TicketUsage.tsx`,
`TicketSituation.tsx:34-43`, `ticketCreation.ts:538-540`,
`TicketProvenance.tsx:133`.

After 7a a stage is a named roster rather than "3×" and the creation form picks
evaluators. After 7b a blocked evaluator shows as blocked inside a stage that is
still running, instead of the ticket parking with two siblings draining; a
resumed stage shows generation 2 beside the passes it kept; the program-run row
disappears.

## Sizing

84 files name `fanout` or `StageDefinition`: `model` 4 · `src` 26 · `test` 34 ·
`ui` 10 (of which `test/golden` 11). 156 name a verdict; 40 sites read
`.program`. Eleven goldens re-emitted per PR; two migrations; two wipes.

## Split

Four changes wear this hat, and the first is independent of the other three.

**(a) The evaluator is a key.** `StageDefinition{fanout}` → `{key, evaluators}`;
the configuration gains an optional per-stage evaluator list; briefing, purpose
and requirement select by `(stage, evaluator)`; surprises 2 and 3 are fixed;
authoring, `choices.stages`, the creation picker and the ledger's width read
follow. **Migration** 011 **+ wipe. Worker/fabric:** no — the briefing is
composed server-side and handed to the pod (`workerPod.ts:295-299`), and the
wire task kinds are untouched.

**(b) The verdict vocabulary.** `Verdict` → `EvaluationVerdict` on the
evaluation side and `TaskTerminal` on both, mapped at the adapter; the manifest
stays (surprise 5). **Migration:** the `TaskDone` arms, shared with (c).
**Worker/fabric:** no.

**(c) Per-evaluator status, and infra death stops being a verdict.**
`EvaluatorStatus`, `StageRun`, `EvaluationInstance` beside `phase`;
`concludeStage` folds `EvalReduce` away; `ExecutionBlocked` gains a task and the
exhausted-retry arm becomes `TaskProcessFailed`; the rework cap moves to
`workCyclesStarted` (surprise 9). Needs (b) for the report vocabulary and (a)
for the evaluator map's keys. **Migration** 012 **+ wipe. Worker/fabric:** no.

**(d) Resume at generation+1 keeping passes.** `resumeBlocked`,
`EvaluationBlockedEscalated(EvaluationInstance)`, the console's run layer
collapsing. Needs (c); adds no migration of its own. Split *out* of (c) it ships
a state where a blocked stage is representable and its resume still re-runs the
passes — worse than either end, so it rides with (c).

**The opaque-ref decision is 7a's, not PR 8's.** Surprise 1 leaves three
choices: copy verbatim and author four refs per evaluator at release (PR 8's
`ReleasedTicket` half arrives here, and `inputs` is not resolvable at release
anyway); copy verbatim and fill them with placeholders (a validity predicate
satisfied by construction, in a proved file); or **copy with
`EvaluatorDefinition` carrying the key alone and `EvaluationInput` carrying the
artifact alone**, the divergence named in `model/AGENTS.md` beside the copy as
PR 8's remaining delta. Take the third: it is the treatment PR 6b gave the types
with no caller, one level on, and the only one that neither enlarges PR 7 by
PR 8 nor asserts something untrue in `model/`.

**Recommended cut: two PRs — 7a (a), 7b (b+c+d).** They fail differently: 7a is
an authoring-and-dispatch change whose blast radius is the configuration file
and the minting arithmetic; 7b is a protocol change whose blast radius is the
deciders, the journal and the ledger. A reviewer reads each against one failure
mode. 7a is also the only piece reasonable without the instance existing, and it
is where surprises 2 and 3 bite — two silent data losses deserving their own
red-proofs rather than a line in a 3000-line diff. The console is rewritten once
in each: 7a changes what a stage's width means, 7b deletes the run layer.

**What one PR would cost.** The whole of §1's target lands with the authoring
change, the configuration change, both journal shapes, the rework cap's move and
the ledger's collapse in one diff — roughly twice 6b across §Sizing's 84 files
plus the verdict surface, one migration, one wipe. It saves one release cycle
and one reviewer round. It costs the mutation sweep its grain: the sweep is the
second review, and a sweep over a diff that changes both what an evaluator *is*
and what a stage *does* cannot red-proof one term at a time — the
guard-fails-open signature. Two PRs, two wipes.

## Release coupling

**None, for either piece.** Nothing crossing the boundary changes: the worker
reads `taskKind` once (`entrypoint.mjs:228`) and never a stage, an evaluator or
a verdict vocabulary it did not itself emit; the pod's `briefing` is composed
server-side (`workerPod.ts:295-299`); the manifest keeps `Pass|Fail`
(surprise 5), so `submit_worker_result`'s signature and grants are untouched;
the fabric names the two wire task kinds in one object
(`chuggy-fabric/cluster/apps/chuggy-scheduler.yaml:493,495`) and nothing else.
Both release as PRs 1–6 did: a chuggy image, the migration applied to a wiped
journal, a mechanical fabric source-commit bump.

**7a has one coupling the others do not: the authored configuration.** The rig's
`chuggy-development` must declare its evaluators before a ticket released under
it can name them, and the wipe keeps configuration revisions. Making `evaluators`
optional (§2) is what keeps every kept revision parseable and the drafts page
readable; the new shape arrives with the importer's own run over the released
commit, as 6a's and 6b's releases did. Required instead, the release grows a
re-import **before** the sanity ticket, and a configuration read between the
migration and the import answers `InvalidRequest` — the shape of the #724 trap.

**The one way to force lockstep** is renaming the manifest's verdict: that moves
`images/worker/result.mjs`, `submit_worker_result`'s argument list and its
grants together, and buys nothing the adapter map does not. Keep it out of both
pieces.
