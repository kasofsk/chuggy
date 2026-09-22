# Task B (PR 7b) — the report crosses the boundary

Tip `3545efa9` on `model/evaluation-instance`, six commits off `0d2e1639`, not pushed.
No `model/`, `src/domain/`, `src/actor/`, `src/generated/` or `ui/` file is touched.

## Per layer

- **`src/interpreter/`** — `ticketCommand.ts`: `TaskDone` joins the Exclude list, so no principal may
  offer one; new `SchedulerCompletionEvent` = `TaskDone` minus `onFailure`, `isSchedulerCompletion`.
  `wire.ts storedSchedulerCompletion` parses `{ticket, task, report}` through the generated
  `decodeTaskIdentity`/`decodeTaskTerminalReport` and refuses a named `onFailure`. `projectWriter.ts`
  writes neither `EvalReduce` nor `ExecutionBlocked`; `completionEvent` stamps the disposition (below);
  escalation evidence is taken only when the decision actually escalated. `decisionPlan.ts` spawns the
  instance's `currentTaskObligations` and mints at `spawned − roster + slot + 1`, slot being the
  evaluator's position in the run's roster; the `ReduceEvaluation` continuation branch is gone
  (`projectDecision.ts:207-215` narrows to `"ReduceWork"`; the column's other value is now unwritten, no
  migration). `reworkCap.ts` reads `evaluationFailureReworksStarted`. `resultManifest.ts` takes the
  contract's `ResultVerdict`. `executionScheduler.ts`/`sessionScheduler.ts`/`executionSchedulerRun.ts`
  retire the draining-siblings and `ExecutionBlocked` prose.
- **`src/adapters/postgres/`** — `readiness.ts` hands a completion operation its `completion` event;
  `continuationSource` throws on any kind but `ReduceWork`. `schedulerCompletion.ts` submits an
  exhausted budget under its own outcome.
- **Contract** — untouched: `executionResultSchema.verdict` is still `Pass | Fail`,
  `executionSummarySchema` unchanged, so `contractDocument.json` does not move.

## The outcome value and 012's arm

`in_outcome = 'ProcessFailed'`, produced only by `schedulerRetriesExhausted`. It sits on the manifest
side of the door's existing pairs (manifest present, no reason, `bound.verdict = 'Fail'`), so the
binding checks needed nothing. 012 maps it to `TerminalFailureReport{evidence, kind: ProcessFailure}`
for either task kind, ahead of the task-kind branch, and `UPDATE execution` still records `Failed`, so
`execution_outcome_is_known`, `allExecutionOutcomes`, `contract/rosters.ts` and the console are
untouched. 012 also moved to the codec's report spelling (`evidence`, no `ticket` in the value) and
refuses a completion naming `onFailure`, as it refuses one naming `verdict`.

## The Addendum's item 2 is not implemented as written — read this

Item 2 says the disposition reaches the row as a new `in_on_failure text` parameter, decided in the
process that submits the completion. **That process cannot decide it.** The scheduler holds no rework
cap (only `src/roots/ticketService.ts` and `controlPlane.ts` configure `rework`), no ticket state, and
no privilege on `journal_entry` or `ticket_projection` — `schedulerCompletion.ts`'s own header says so,
and `executionScheduler.ts` says "NOTHING HERE DECIDES A TICKET". So: **the boundary emits
`{ticket, task, report}`, 012 refuses a named disposition for being named (009's device), and
`projectWriter.ts:397-412` stamps `reworkDisposition(held, writer.rework.cyclesMax)` over the ticket
as the writer holds it at its serialization point** — which is where `src/actor/decisionEvent.ts`'s
header already says a choice belongs. The projection cannot lag: the writer reads its own replayed
graph, not a stored row. `submit_task_completion` therefore keeps its signature, so no DROP/GRANT.
If the orchestrator wants the parameter anyway, it needs the cap and the ticket carried to the
scheduler first; that is a separate change.

## Two further decisions

- **A source no dispatch can read defers every input with no client.** `ExecutionBlocked` was what
  parked a ticket whose spawn could not be sourced; nothing replaces it, and refusing a completion
  would settle at the boundary a task the journal never heard settle. Client operations are still
  Refused with their code (`projectWriter.ts:545-561`).
- **A latent live bug, not mine and not fixed:** a finalizer-rework work spawn's bundle carries
  `TargetCommit` but no `Repository`, so `workSource` answers undefined and the next evaluation spawn's
  `observe` returns `RefUnreadable` — which until this branch parked the ticket and now defers it
  forever. Worth its own ticket.

## For C, and files outside my layers

C changes nothing for me: the wire is unchanged, no contract field moved, no new response shape, and
the ticket read's escalation vocabulary is A's `escalationTags`, already carrying
`EvaluationBlockedEscalated`. C's tip `4185edb9` is `ui/` only and merges cleanly.
One file outside my layers: `test/domain/fixtures.ts` gains `reportedAt(task, verdict)`, the pairing
the door builds, which the three `test/postgres` suites needed where they passed a verdict string.

## Gates on the tip

`check-source` 0 · `check-boundaries` 0 · `check-queries` 0 · `check-postgres` 0 (76 suites) ·
`check-conformance` 0 (12 goldens, 208 steps) · `check-random` 0 (2000 runs) · `check-figures` 0 ·
`check-comments` 0 · `check-paths` 0. `check-model-api` not run: `src/generated` untouched.

**Red-proofs.** Seven single mutations of 012, all RED: the outcome roster losing `ProcessFailed`; the
`ProcessFailed` arm deleted; the execution row recording the submission verbatim; the evidence taken
from the ticket instead of the task; a named disposition left unweighed; the report's own `ticket`
left unweighed; the evidence left unweighed. Three of the mint: `base` counted off the tasks
dispatched (the resume case and the cancellation case); the slot taken from the evaluator key (the
sparse case and the cancellation case). One of the scheduler: `schedulerRetriesExhausted` submitting
its execution's own outcome (the evaluator case, on a fresh database).

## What the earlier reports got wrong

- S: "making it park needs a new signal from the caller — a signature change" — it needed a new
  `in_outcome` value, not a new parameter; the signature did not move.
- S's twelve report rows and four door rows all carried `ticket` inside the report value; moved.
- Nothing in GOAL.md or A-report.md was wrong. A's site list was accurate line for line.
- Both prior reports note the attribution line; mine ends `Claude Fable 5.1` as the brief names.
