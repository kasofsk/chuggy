# Task B (PR 7b) — the report crosses the boundary; an evaluator's death parks the ticket

Worktree `~/claude/chuggy-wt/evinst`, branch `model/evaluation-instance`, which carries Task A (copy, model, goldens, generated, domain, actor) merged with Task S (migration 012). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Read, in order: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7b — decisions" (3, 4, 5's cap and 8 are yours) **and the progress line that corrects decision 3** (the exhausted-retry signal is yours to add), `pr7/survey.md` §3, §5 and surprises 5–8, 11, `pr7/tasks/7b/A-report.md` and `S-report.md` (what landed, by file:line, the report spelling 012 admits, and the six postgres cases S lists as yours), `pr7/tasks/7a/B.md` and `B-report.md` (this task's shape in 7a), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres writes and reads, scheduler, http contract), `src/contract/`, `test/contract/{representations.ts, contractDocument.json}`, and the tests of all of them under `test/`; and 012 (unlanded, S's) for the one arm the corrected decision 3 adds.

- `wire.ts storedSchedulerCompletion` and every stored-text reader (memory `stored-text-outside-the-journal.md`) parse `TaskDone{ticket, task, report}`; `projectWriter.ts` no longer writes `EvalReduce` or `ExecutionBlocked`; `decisionPlan.ts` spawns the evaluation obligations the deciders return (the instance's `currentTaskObligations`) and cancels by identity; `executionScheduler.ts:86-93`'s draining-siblings arrangement and its doc go; `executionScheduler.ts:610-624`'s blocked path submits per task.
- **The exhausted-retry signal (decision 3, corrected):** `schedulerCompletion.ts:77-83`/`executionSchedulerRun.ts:77-83` terminalize an exhausted safe-retry budget through `submit_task_completion` with a distinct `in_outcome` value (name it in the roster the door already checks; DROP/CREATE/GRANT if the signature moves, else `CREATE OR REPLACE`); 012 maps it to `TerminalFailureReport{kind: ProcessFailure}` for either task kind. For an evaluator that marks it `EvaluatorProcessFailed`, the stage concludes `EvaluationBlocked` and the ticket parks; for a work task it is `WorkFailureEscalated` as today. Add S-style rows to `migration.test.ts` for the new outcome (admitted, and the report it journals), red-proved.
- `reworkCap.ts` reads the domain's rework count over the instances (A's function), never the record.
- Contract: `executionResultSchema.verdict` stays the manifest's `Pass | Fail`; `executionSummarySchema` unchanged unless A's report says the console needs a field it cannot derive from identities and statuses — say so if you add one. The contract document follows only if a schema moves.
- Tests: the six postgres cases S lists; `i3`/`ticketServiceRun`/`projection` for a blocked evaluator parking and a resume re-asking only it at generation 2 (the wire integers of the two passes untouched, the resumed evaluator minted fresh); a work-cycle rework after `EvaluationFailed` counted by the cap.
- Comments: nothing says `EvalReduce`, `ExecutionBlocked`, a verdict called `Pass` on the journal, or siblings draining.

NOT yours: `model/`, `src/domain/`, `src/actor/`, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each exit.

## Commits

On `model/evaluation-instance`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7b/B-report.md`: tip, what changed per layer, the outcome value the door gained and 012's arm for it, what C must change (by file:line) and any wire field C reads, files outside your layers touched, gates on the tip, anything GOAL.md or the A/S reports got wrong. Under ~60 lines. Write the report, reply with its contents, and stop.

## Addendum (orchestrator, after A and S)

The branch tip is 0d2e1639: A's 1c885b36 merged with S's 280b9dec. Read `tasks/7b/A-report.md` §"The shapes S, B and C build on" and §"What B and C must change" — that is your site list — and `S-report.md`. Three things the two do not agree on are yours to settle, and 012 (unlanded) is yours to edit for them; S is finished.

1. **The report spelling is the codec's** (`src/generated/model-api.ts` `taskTerminalReportSchema`, `decisionEventSchema`'s `TaskDone`): a report value carries no `ticket`; `WorkResultReport.value = {result}`, `EvaluationResultReport.value = {result, verdict}`, `TerminalFailureReport.value = {evidence, kind}` with `evidence` a positive integer; `TaskDone.value = {ticket, task, report, onFailure}`. 012's arm and door (`012-task-report.ts:128-165`, `:285-313`) still spell S's `ticket` inside the value and know no `evidence` or `onFailure`; move them to the codec's spelling, and every migration-suite row with them. `evidence` is the wire task integer the door already holds (`bound.task`): positive, unique per ticket through the execution unique, and it names the row a reader would open. Say so once in the door's doc.
2. **The disposition crosses the door.** The model carries `onFailure` on every `TaskDone` and consults it only where the report concludes a failed stage (`model/ticket.qnt` `applyTaskReport` and `domain.qnt decideEvalStageReduce`). `projectWriter.ts:401-408` is where the cap is applied today, on the reduce event that no longer exists. Decide it where the cap lives, in the process that submits the completion: `reworkDisposition(ticket, cap)` from `reworkCap.ts` over the ticket as projected at completion, against the ticket-service cap, in one place; it reaches the row as a new `in_on_failure text` parameter of `submit_task_completion` (`ReworkEvaluationFailure` | `EscalateEvaluationFailure`), journalled on every `TaskDone`, a work task's included. The signature moves, so DROP/CREATE/GRANT (010's precedent, `baseline/privileges.ts` for the grant); the arm admits exactly the two values and refuses an absent one. If the projection the caller can read lags the journal in a way that changes the count, say so in the report rather than papering over it.
3. **The exhausted-retry outcome.** Add the `in_outcome` value (`schedulerCompletion.ts:577-610` is the one producer; the explicit empty manifest it seals stays sealed, so the door's `(in_outcome = 'Blocked') <> (in_manifest IS NULL)` pair gains the new value on the manifest side); the door maps it to `TerminalFailureReport{evidence, kind: ProcessFailure}` for either task kind. A's copy treats `EvaluatorProcessFailed` as blocked, so an evaluator's exhausted retry parks the ticket and a resume re-asks it; a work task's stays `WorkFailureEscalated`. `Failed` with a manifest for an evaluator stays `EvaluatorFail`.

Two facts from A that change the mint and the fixtures: **`spawned` is a slot counter** (`idsAccounted` is `workCyclesStarted + Σ over runs of generation × roster size`), so `requestTasks` bumps by the run's whole roster and mints the wire integer at `base + the evaluator's position in the roster`, dispatching only the obligations the instance owes (a resume claims the roster and dispatches the blocked evaluator alone; the gaps are fine, the mint stays injective and monotone); and `TaskOutcome` has no `Cancelled` and `test/actor/harness.ts` no `plainResult` (`plainDisposition`, `walkToFirstJudgement`, `firstJudgement` instead). Red-prove the slot bump: a mint that bumps by the tasks dispatched must collide after a resume, and a case must say so.

Gates to add to your list: `check-conformance` and `check-random` must stay green (A's goldens are the model's output, never hand-edited), and `check-model-api` if you touch `src/generated`, which you should not need to.
