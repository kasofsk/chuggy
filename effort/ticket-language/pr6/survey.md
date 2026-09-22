# PR 6 survey — Import task_contract (chuggy main 62574ae8, 2026-09-21)

Read-only, against the plan table's PR 6 row and the package's `task.qnt` at the
pin 76c95a9. Paths are under `/home/geoff/claude/chuggy`; the fabric is
`/home/geoff/claude/chuggy-fabric`.

## Surprises

1. **The package's work identity has no fan-out.** `WorkTask{ticket, cycle}`
   (`task.qnt:2`) is one task per cycle; chuggy authors `workFanout` from
   `1..nTasks` (`domain.qnt:85`, `config.ts:37-41`, `ticket.qnt:240`), an
   invariant pins the live set to it (`domain.qnt:941-943`), and though the
   default is 1 (`authoring.ts:499`) the choice is on the wire
   (`responses.ts:693,823`) and in the schema (`relations.ts:115`). Either work
   fan-out collapses to 1 here, or the identity imported is not the package's.
2. **chuggy has no cycle number, deliberately.** `ticket.qnt:101` leaves `cycle`
   off `Task` because it "is derivable from the record's kind sequence", and
   `task.ts:55-74` walks the record that way. The package carries it as
   `Ticket.workCyclesStarted` (package `ticket.qnt:76`), a PR 8 field.
3. **The package's stage is a positive key; chuggy's is a 0-based index.**
   `stage > 0` (`task.qnt:51`) against `asStageIndex` admitting 0
   (`ids.ts:86-90`), `evalStage` basing at 0 (`ticket.qnt:342-344`) and
   `stage >= 0` (`relations.ts:303`). The placeholder `stageIndex + 1` meets
   the console's three `+1` label sites (`ticketLedger.ts:441-445`,
   `TicketLedger.tsx:376`, `TicketUsage.tsx:52`).
4. **`WorkTask`/`EvaluationTask` are already taken, by PR 3.** chuggy's
   `TaskKind` constructors (`ticket.qnt:68`) are spelled exactly like the
   package's `TaskIdentity` constructors (`task.qnt:13-14`), so the two cannot
   share a Quint namespace, and `generate-model-api.ts:155` refuses a duplicate
   typedef name across every module in the IR. The import is not additive.
5. **`model/` cannot import the package at this pin, and a copy is gated like
   any model file.** `package.json:6` depends on Quint alone;
   `node_modules/@kasofsk` does not exist. A copy at
   `model/task-contract/task.qnt` *is* picked up: `git ls-files 'model/*.qnt'`
   matches nested paths (checked), so `check-model.sh:46` typechecks it,
   `check-figures.sh:44,79` gates it, and `generate-model-api.ts:120-124`
   compiles it through `api.qnt`'s relative imports.
6. **Duplicate absorption is already a refusal, twice over.** `TaskDone` is not
   enabled unless a live task is outstanding (`actor/decisionEvent.ts:207-215`,
   `refinement.qnt:337-344`), and `submit_task_completion` answers
   `AlreadySubmitted` or `BindingMismatch` on `(ticket, task, source_effect,
   manifest, digest, verdict)` (`008:176-197`). `decideTaskDone`'s absorb-by-id
   (`domain.qnt:383-387`) is unreachable from the journal. `TaskNotCurrent`
   renames behaviour chuggy has; what it adds — a refusal as a *decision
   result* — is PR 8's.
7. **The worker never names a task, so nothing it sends has to change.** The
   report body is `{version, verdict, report, handoffs, diagnostics, source?}`
   (`images/worker/source.mjs:8-10`, accepted at `resultManifest.ts:554-580`);
   correlation is the attempt bearer alone (`workerPlaneServer.ts:615-632`), and
   `read_worker_attempt` returns `task_kind` but neither ticket nor task
   (`functions.ts:2576-2604`). `submit_worker_result` reads `e.ticket, e.task`
   off the execution row itself (`functions.ts:3896,4017-4019`), and the
   completion's idempotency key is `sha256('execution:'||execution)`
   (`008:231-233`). The plan row's "needs the fabric to report the obligation
   back" is not true of this tree.
8. **The minted integer must stay injective and monotone within a ticket or
   registrations vanish silently.** `execution_names_one_logical_task UNIQUE
   (tenant,project,ticket,task)` (`constraints.ts:102-103`) is the target of
   `ON CONFLICT … DO NOTHING` (`scheduler.ts:404`), so a projection that repeats
   a number — per-cycle or per-generation numbering — turns a distinct
   obligation into a no-op insert. One FK points at a task row
   (`constraints.ts:460-461`); a trigger freezes `execution.task`
   (`functions.ts:1130-1137`).
9. **An authored configuration keys a requirement by the decimal task id.**
   `taskDefaults["2"]` (`executionRequirement.ts:439`, fixtures
   `test/interpreter/executionRequirement.test.ts:82,188,261,289`) and
   `taskKindDefaults["Evaluation:<stage>"]` (`:441-444`). The SPIKE leaves
   `execution_requirement.qnt` out of scope "unless a PR above finds one
   importing ticket vocabulary" — this is that PR, at user-facing keys.
10. **The four opaque refs exist as digests already, and a fold to a model int
    exists** (`result_digest_fold`, `functions.ts:3176-3184`, used at
    `008:216`). What is missing is a home on the *ticket*: chuggy resolves the
    definition per request at dispatch (`scheduler.ts:380-405`) against the
    decision's configuration pin (`decision.ts:327`), while the package hangs it
    off `ReleasedTicket.workConfiguration` at create (package `ticket.qnt:60`).
11. **The console never displays a task id — it reconstructs cycle and
    generation.** `ticketLedger.ts:229-248` invents the cycle ordinal by
    counting work sets, `:254-270` invents the program run from a non-monotonic
    stage index, and `:141-154` groups a fan-out with a `/-\d+$/` regex over the
    execution identity — a format `schedulerIdentity.ts:14-19` declares opaque
    and `scheduler.ts:380,389` mints as `execution-<uuid>-<task>`. A structured
    identity deletes that inference and fixes `runTotals.ts:241-243`, whose key
    `` `${taskKind}/${stage}` `` merges a stage across every cycle.
12. **The integer is a sort and paging key in five places, and `generation` is
    taken.** `ticketLedger.ts:163-165`, `TicketLedger.tsx:389-391`,
    `ticketExecutions.ts:55-61` (the live-frame fold places by `>`),
    `operationalReads.ts:280-284` (row tuple `(e.ticket,e.task)`), and the HTTP
    cursor, which pins `task` as a positive integer and refuses one that does
    not re-encode byte-identically (`http/contract.ts:130-133,427-429`).
    Separately `executionAttemptSchema.generation` (`responses.ts:547`, drawn at
    `TicketExecutions.tsx:109`) is the attempt fence generation, a different
    number at a different level from `EvaluationTask.generation`.
13. **PR 3/4/5 left this PR almost nothing.** The only forward references are
    payloads (`pr5/GOAL.md:25`) and `WorkEscalation.resumeInput`
    (`pr5/survey.md:11,101`) — and `WorkInput` is `WorkCause`/`ReleasedContent`
    (package `ticket.qnt:6-19`), PR 8's. PR 3 deferred the `Verdict` rename to
    PR 7 "with the worker's report"; by surprise 7 the report does not move here
    either, so that deferral holds.

## 1. The model

Today. `TaskKind = WorkTask | EvaluationTask(int)` (`ticket.qnt:68`), `TaskState`
(`:90`), `Task = {id, kind, state}` (`:105`); `Ticket.tasks` (`:252`), `.record`
(`:264`), `.spawned` (`:270`). Allocation is ticket-sequential: `firstTaskId`
(`:329`), `nextTaskId` (`:355`), `spawnTasks` (`:350`), `spawnOn` (`:365`),
`retireLive` (`:376`), `resolveTask` (`:397`), `combine` (`:413`), `evalStage`
(`:342`). Spawn sites: `domain.qnt:367,412,454,468,498,574,580`. Readers:
`reducibleWorkIn`/`reducibleEvalIn` (`:303,307`), `decideTaskDone` (`:383`),
`escalate` (`:343`), revoke (`:223`), and four invariants — `tasksWellFormed`
(`:937`), `recordWellFormed` (`:964`), `recordMonotone` (`:983`), `idsAccounted`
(`:1002`). The journal event is `TaskDone({ticket, tid, verdict, result:
TaskResultRef{manifest, digest, schema}})` (`refinement.qnt:270-277`). TypeScript
mirrors it: `src/domain/task.ts` whole, `ids.ts:28,78,94`,
`enablement.ts:104-123,171-178,227-232`, `invariants.ts:109-160`,
`deciders.ts:147,161-179,260,305,382`,
`actor/decisionEvent.ts:100-106,158-162,207-215`; `api.qnt:14-17,35` exports five
of the types.

Target. `TaskIdentity` (`task.qnt:12-14`), `TaskDefinition` of four opaque ints
(`:16-21`), `TaskObligation` (`:23-27`), `ValidatedTaskResult` (`:29-32`),
`TaskFailure`/`TaskTerminal` (`:34-39`), the validity predicates (`:46-88`). The
live obligation is derived, not stored: `liveTaskList` (package
`ticket.qnt:455-463`), `workTaskObligation` (`:380-387`, `contextRef` = the
cycle), `currentTaskObligations` over the running stage's still-`Awaiting`
evaluators (`evaluation.qnt:327-339`), `taskCurrent` (`:153-161`). The refusal is
`decideTaskTerminal` (`ticket.qnt:732-779`): identity current **and**
`produced.result.obligation == workTaskObligation(…)` — definition and
`contextRef` included — else `TaskNotCurrent`; `reportAdmissible` (`:339-342`)
repeats it inside `evolve`.

What PR 6 can honestly carry: the work identity in full (with surprise 2's
counter) and, for evaluation, `stage = stageIndex + 1`, `generation = 1`,
`evaluator` = the fan-out ordinal. That placeholder is stable within a stage run
and is what the ordinal already means, so it refuses nothing it should admit; it
cannot survive PR 7's resume-at-generation+1, which the wipe answers.
`TaskDefinition`/`ValidatedTaskResult`/`TaskTerminal` have no chuggy producer
until something puts the refs on the ticket (surprise 10), so importing them
means importing dead types unless the split's piece (b) rides along. **Literal
import: no — a verbatim copy** (surprise 5), replaced by `node_modules` at PR 9.

## 2. Identity across the boundary

Minted by `spawnOn`; projected by `decisionPlan.ts:62-71 requestTasks` — seven
lines mapping `WorkTask → {task: id, kind:"Work"}` and `EvaluationTask(s) →
{task: id, kind:"Evaluation", stage:s}`, the PR 3 boundary. Written to
`execution_request_task` (`decision.ts:332-340`); materialized one execution row
per task (`scheduler.ts:380-405`, minting `execution-<uuid>-<task>` and resolving
the requirement per `(task, kind, stage)`); carried through `LogicalExecution`
(`executionScheduler.ts:350-358`) and `AttemptPlacement` (`:758-762`); handed to
the pod as `CHUG_WORKER_TASK` (`workerPod.ts:128-156,285-320`; golden
`test/adapters/kubernetesWorkerPodDocument.golden.json`) with `ticket, task,
taskKind, stage, generation, sourceRequest, inputBundle(+Digest),
configuration*(+Digest), profile, requirement*(+Digest), briefing, authority,
workerPlane`. The worker reads only `taskKind`, once (`entrypoint.mjs:228`), plus
`ticket`/`attempt` for the branch name (`images/worker/source.mjs:3-6`); the pod
labels are read back by nothing (`workerPod.ts:27-31`); the pool wire carries no
identity by design (`contract/workerPool.ts:1-19`, `poolPlacement.ts:156-169`).

Returning: the manifest and the bearer, nothing else (surprise 7). chuggy rebinds
in `submit_task_completion` and journals `TaskDone{ticket, tid, verdict,
result{manifest: manifest_ordinal, digest: result_digest_fold(digest), schema:
schema_version}}` (`008:210-218`); the `Blocked` arm journals
`ExecutionBlocked{ticket}` with no task at all (`008:203-208`).
`storedSchedulerCompletion` reads it back (`wire.ts:277-286`);
`materializationOf` writes the continuation fence `(expectedTicketVersion,
expectedPhase, taskSetGeneration = ticket.spawned)` (`decisionPlan.ts:369-395`),
checked at `projectWriter.ts:272-287` — chuggy's existing "is this still the
current task set" test and its nearest relative to obligation currency.

So "the whole obligation on the wire" means, on this tree, the whole obligation
*inside* chuggy: identity from `execution_request_task`, definition from
`requirement_digest`/`configuration_digest`/`input_bundle_digest` and
`schema_version`, `contextRef` from the cycle — every field locked in the same
transaction that writes the journal row.

## 3. Schema — migration 009

Carrying a task id or kind: `execution_request_task(task, kind, stage)` with its
three CHECKs and PK (`relations.ts:296-306`, `constraints.ts:108-109`);
`execution.task` with `execution_counters_are_positive` (`relations.ts:206,228`),
the unique, FK and trigger of surprise 8, and column grants
(`privileges.ts:367-369`); `execution_request.kind` (`relations.ts:289`);
`execution.requirement_source ∈ {ExplicitTask, TaskKindDefault, …}` (`:233`);
`project_continuation.kind` and `.task_set_generation` (`:728,731`);
`dispatch_candidate.work_fanout` (`:115`); `read_worker_attempt`'s `task_kind`
(`functions.ts:2576,2594`); `execution_backlog` (`:1109-1112`); the owed-count
query (`scheduler.ts:416`); and `decision_event_is_valid`'s `TaskDone` arm, which
requires `command_integer(value->'tid')` (`008:109-117`) and has not changed
since the baseline. The result family carries no task — it is reached through
`execution` (`relations.ts:307-322`).

009's shape. **Columns, not one JSON column**: `execution_request_task` is granted
to `chuggy_api` column by column (`privileges.ts:449-454`) and 008's own argument
(`008:49-52`) is that a half-present identity should refuse the query. So `cycle`,
`work_cycle`, `stage`, `generation`, `evaluator`, nullable per kind, with an
"identity is whole" CHECK per arm in the idiom of `execution_request_task_check`
(`relations.ts:303`), a `GRANT SELECT(col)` per new column (or the API read fails
only at runtime), and — if `execution.task` stops being an integer — the restated
unique, FK and `ON CONFLICT` target (`scheduler.ts:404`).

The refusal: `submit_task_completion` already refuses a non-current obligation
(`008:183-197`); refusing the *whole* obligation means adding the definition refs
to that disjunction, which changes the argument list — and the EXECUTE grants
spell the full signature (`privileges.ts:248-249`), so it is `DROP FUNCTION` +
re-`CREATE` + re-`GRANT` (precedent `003:402`). The `AlreadySubmitted` arm
(`008:176-182`) stays: it is the at-least-once absorption the fabric needs, which
the package's refusal does not replace.

The wipe: 009 cannot be additive. The cycle, generation and evaluator were never
written, `journal_entry.entry` is digest-chained (`relations.ts:619-620`) and
`operation.command`/`payload_digest` hold the same bytes. 009 reuses 008's guard
verbatim (`008:69-75`) and names `deploy/rig/wipe-tickets.sql`, which already
truncates every task-bearing relation and resets the counters.

## 4. The four opaque refs

| package | chuggy today | after |
|---|---|---|
| `workload` | the image inside `execution.requirement_value` (`executionRequirement.ts:123-130`), summarized by `requirement_digest` (`scheduler.ts:392-394`) | one int, compared for equality |
| `inputs` | `execution_request.input_bundle(+_digest)` (`relations.ts:288`) over `input_bundle_reference` rows built at `decisionPlan.ts:257-315`, plus the briefing (`taskBriefing.ts`) | one int |
| `executionRequirements` | `requirement_identity/value/digest/source` + `platform_default_version` (`relations.ts:212-216`), resolved per task by `materializeExecutionRequirement` (`executionRequirement.ts:422-462`) | one int; `execution_requirement.qnt` stays chuggy's |
| `resultContract` | `execution_result.schema_version` (`relations.ts:314`), already journalled as `result.schema` (`008:217`) | one int |

Three are hex digests and `result_digest_fold` is the existing fold; the fourth is
already an integer. The domain would compare and never read them — but only once
something puts them on the ticket or the dispatch effect, which today resolves
them *after* the decision (surprise 10).

## 5. Wire and console

Exposed: `executionSummarySchema.task/taskKind/stage` (`responses.ts:483-485`),
`request` optional (`:488-497`), the `(ticket, task)` page order (`:518-525`),
`executionTaskKinds` (`rosters.ts:140-141`), `requirementSources` (`:165-171`),
`workFanout`/`program` (`:693-694`, `:820-828`). The ticket read names no task
(`:224-257`); no route has a task path segment (`http.ts:328-332`). Produced by
`operationalReads.ts:132-173,257,273-274,329,345-346` — both execution reads
re-marry `execution.task` to `execution_request_task.kind/stage` per row. Console:
`ticketLedger.ts` is the inference engine (surprise 11) and is what a structured
identity mostly deletes; `TicketLedger.tsx`, `TicketSituation.tsx` (`resumedFrom`,
`:39-44`), `TicketUsage.tsx`, `runTotals.ts` and `codeLabels.ts:181-192` draw off
its output. `ConversationWorkCard.tsx` is not a task card and is out of scope.

## Sizing

101 files name a task id, a task kind or a task-kind roster: `model` 9 ·
`src/domain` 8 · `src/actor` 2 · `src/interpreter` 8 · `src/adapters` 14 ·
`src/contract` 2 · `src/generated` 1 · `test` 39 · `ui/…/app` 5 · `ui/…/test` 13
· `images/worker` 2. Eleven goldens re-emitted; one migration; one boundary
function replaced; one wipe; no fabric or worker release.

## Split

The plan row is four changes wearing one hat, and only two of them need each
other.

**(a) Structured identity inside chuggy.** `TaskIdentity` replaces `Task.id` +
`TaskKind` across `ticket.qnt`, `domain.qnt`, `refinement.qnt`'s `TaskDone`,
`api.qnt`, the generated types, `src/domain/*`, `actor/decisionEvent.ts`, eleven
goldens and the conformance suite; surprise 2's cycle counter arrives with it;
`decisionPlan.ts:62-71` keeps minting today's integer and `stage`, so
`execution_request_task`, `execution`, `CHUG_WORKER_TASK`, the wire and the
console are untouched. **Migration:** the journal's `TaskDone` payload changes,
so `decision_event_is_valid`'s arm (`008:109-117`) must admit the new shape — a
migration, and because the old rows are digest-chained, **a wipe**.
**Fabric/worker:** no. The minting must stay injective and monotone per ticket
(surprise 8), and the evaluator ordinal must come from the same `program[stage]`
order `spawnTasks` already walks, or be stored — deriving it is sound today
because the program is replayed.

**(b) The four opaque refs on the dispatch effect.** Touches the model's
`Ticket`/effects, `decisionPlan.ts`, `decision.ts`, `scheduler.ts`, and the
authoring path if the definition is authored rather than resolved. **Migration:**
yes, if the refs become durable ticket state. **Fabric/worker:** no. **This
should not be its own PR and should not be in PR 6 at all**: the package hangs
the definition off `ReleasedTicket` (package `ticket.qnt:60`), which is PR 8's
type, and chuggy resolves it after the decision (surprise 10). Fold it into PR 8
and say so in the SPIKE.

**(c) Exact-obligation refusal.** The boundary can reconstruct the obligation
from the execution row — identity from `execution_request_task`, definition from
the three digests and `schema_version`, `contextRef` from the cycle — in the same
locked transaction, so the worker's report is unchanged (surprise 7);
`source_effect` (`schedulerCompletion.ts:228`) is already a second binding
coordinate and should be kept. Touches `submit_task_completion` (signature change
⇒ DROP/CREATE/GRANT), `decision_event_is_valid`, `wire.ts`, the actor's
enablement. **Migration and wipe:** the same one as (a). **Fabric/worker:** no.
Splitting it out buys a second wipe for nothing: **(a) and (c) are one PR.**

**(d) The literal import.** Not available (surprise 5): the copy is what PR 6
lands, as its first commit; pointing Quint at `node_modules` stays PR 9.

**Order and shape.** One PR = (d)'s copy, then (a) + (c); (b) moves to PR 8. What
stays untractable in any split is the evaluation half: `EvaluationTask{stage,
generation, evaluator}` cannot be honest before PR 7 gives evaluators keys and
stages generations, so PR 6 ships §1's placeholder and PR 7 rewrites it under the
same wipe. If that is still too large, the honest second cut is (a) for the
**work** identity only, `EvaluationTask` keeping today's `(stage, ordinal)` — but
that leaves two vocabularies in one sum for a PR, and pays the migration and the
wipe twice.

## Release coupling

**No lockstep.** Nothing the fabric or the worker sends carries a task identity
(surprise 7), and the outward direction is informational: the worker reads
`taskKind` once (`entrypoint.mjs:228`) and never reads `task`, `stage` or
`generation`; the labels are read back by nothing; the pool wire is
identity-free. The fabric names no task id or kind anywhere in its tree except
one object keyed by the two wire kind strings — `CHUG_SCHEDULER_EXECUTION_POLICY`
(`cluster/apps/chuggy-scheduler.yaml:484,495`, parsed at
`src/roots/schedulerConfig.ts:185-195`). So PR 6 releases as PRs 1–5 did: a
chuggy image, 009 applied to a wiped journal, and a mechanical fabric
source-commit bump.

Lockstep is forced by exactly two strings, and only if this PR changes them: the
wire task kinds `Work`/`Evaluation`, whose consumers outside chuggy's source are
that policy object and `entrypoint.mjs:228`. Keep them — as PR 3 did — and the
fabric and the worker image stay where PR 3 left them. The other way to force it
is to make the worker *attest* the obligation in its manifest, which changes
`submit_worker_result`'s arguments, the worker image and the plane together; that
is the PR 7 conversation and belongs out of PR 6.
