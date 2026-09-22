# Task B — the rename in the interpreter, the adapters, the contract and their tests

Worktree `~/claude/chuggy-wt/rename`, branch `model/rename`, which now carries Task A (model, goldens, generated mirror, domain, actor, semantics 5) and Task S (migration 006). Run `npm ci` if `node_modules` is stale. Read, in order: `~/claude/chuggy-effort/ticket-language/pr3/GOAL.md` (decisions are settled), `pr3/survey.md` (§1–§8, §10–§12 are your map), `pr3/tasks/A-report.md` and `pr3/tasks/S-report.md` (what landed and what they left for you, including every file outside A's layers A touched mechanically), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres reads and writes, kubernetes, supplied, http), `src/contract/` (rosters, responses, wire), and the tests of all of them under `test/`. Specifically:

- Every renamed literal in those layers takes the new spelling (phases, resume points, outcome, `TicketGraph`/`graph`, `CreateTicket`, `StageDefinition`, the three reasons, task kinds `WorkTask`/`EvaluationTask` in the domain).
- The fabric-facing execution task kind stays `Work`/`Evaluation` (`executionTaskKinds`, `execution_request_task.kind`, `CHUG_WORKER_TASK.taskKind`): map the domain's `WorkTask`/`EvaluationTask` to it at the adapter, as `SpawnWorkTasks → SpawnWork` is mapped in `decisionPlan.ts`. Effects and `Verdict` are untouched (deferred).
- `BlockedReason` (`src/interpreter/executionScheduler.ts`) becomes its own roster of the five wall names, no longer `Extract<Reason, …>`; the kubernetes and supplied adapters keep producing them; `execution.blocked_reason` keeps storing them; wherever a wall became the ticket's `reason`, it becomes `WorkExecutionUnavailableEscalated` and the wall name is what `submit_execution_outcome` already records on the execution.
- The ticket read gains `executionBlockedBy?: BlockedReason`: the `blocked_reason` of the ticket's most recent execution with `outcome = 'Blocked'`, present only while `reason = 'WorkExecutionUnavailableEscalated'` (a tagged query in `src/adapters/postgres/nativeReads.ts`; `check-queries` must agree). The wire's `escalationReasons` becomes the three; `ticketResponseSchema` carries the new field; the contract document/fixtures follow.
- Stored rows: the postgres readers that decode journal/decision rows go through the normalising decoder A wrote; nothing in your layer compares against an old spelling except the readers whose job is to admit it.
- `src/adapters/postgres/schema/README.md` and every comment in your layers naming a renamed literal.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Gates

`check-source` (unit + static), `check-boundaries`, `check-queries`, `check-postgres` (the migrated schema is what your queries run on), `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each gate's exit on the tip.

## Commits

On `model/rename`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr3/tasks/B-report.md`: tip, what changed per layer, the query for `executionBlockedBy`, the adapter mapping sites, files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~60 lines.

## Notes from A and S (read their reports; these are the load-bearing ones)

- S: `submit_task_completion` builds its `ExecutionBlocked` event out of `execution.blocked_reason`, so the five wall names are what the boundary writes NEXT, not only what it wrote before. Collapse a wall-named reason to `WorkExecutionUnavailableEscalated` on the read side (the decoder or the event builder), or the decider is handed a value the renamed `Reason` no longer has. `decision_event_is_valid` admits the five for this reason as much as for the journal.
- S: `request_finalization_approval` is the function that reads a phase (`'Finalization'` alone after 006); `submit_finalization_result` reads none. GOAL.md's sentence about `bound.phase` was wrong; 006 is right.
- S: 006 carries no guard by argument (every narrowed check is over a total rewrite of its own column); its header says why.
- A: `test/ui/{resumePoint,ticketActions}.test.ts` carry temporary model↔contract name maps because the contract had not renamed; DELETE both maps when you rename `src/contract/rosters.ts`.
- A: `projectWriter.ts` lost `executionSourceBlockedReason`; a ticket parked for an unreadable source names the one wall, and the RemoteDenied distinction survives only on the execution row. `durableEvidences` in `test/interpreter/dispatchWriter.test.ts` lost a column for the same reason. Make sure `executionBlockedBy` still reaches the reader for that path.
- A: `decisionPlan.ts`'s `requestTasks` already maps `WorkTask`/`EvaluationTask` → fabric `Work`/`Evaluation`.
- A: 14 unit reds on the tip are exactly the contract renames (`test/contract/rosters.test.ts`, `events`, `responses`, `test/adapters/httpEventStream.test.ts`); they are yours to turn green.
- The branch tip you start from carries A (e59bd4aa) merged with S (2ab38d70). `check-postgres` on that tip is red only because the TypeScript wrote old spellings into renamed columns; your rename is what turns it green.
