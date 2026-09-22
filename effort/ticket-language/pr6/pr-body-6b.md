Step 6b of the ticket-language convergence (`chug-ticket-domain` at 76c95a9): **structured task identity.**

The package's task module arrives byte for byte as `model/task-contract/task.qnt` (the package is not a dependency at this pin; the literal import is a later step). A task is named by its identity, `WorkTask{ticket, cycle}` or `EvaluationTask{ticket, workCycle, stage, generation, evaluator}`, in place of the ticket-sequential integer and chuggy's own task kind. The ticket counts the work cycles it has started, and an invariant holds the counter to the record. The evaluation identity is the honest placeholder until the evaluation protocol lands: the stage is the package's positive key, the evaluator is its ordinal within the stage, and the generation is counted off the record so a resumed stage never re-mints a retired identity. The journal's `TaskDone` names the identity; a row naming the old integer is refused.

The integer stays as the wire's name for a task: the interpreter mints it in one place, injective and monotone per ticket, so the execution row, its unique, the HTTP cursor and the page order are untouched. The execution summary carries `identity` beside it, and the console draws cycles, stages, generations and evaluators from the identity instead of reconstructing them from spawn counts, stage indices and an execution-id suffix. Configuration requirement keys by the decimal task id go; the stage key is the positive one.

**Migration 010.** Guard as 008 and 009: refuses while any journal row exists and names `deploy/rig/wipe-tickets.sql`. `execution_request_task` carries the identity in columns beside the integer, with a whole-identity CHECK per arm; the existing stage column becomes the positive key. `decision_event_is_valid` admits the structured `task` and refuses `tid`; `submit_task_completion` journals the identity read off the task row under the same lock, its signature unchanged.

No fabric or worker release: the worker never names a task and the wire task kinds stay.

Survey, decisions, task reports and reviews: `~/claude/chuggy-effort/ticket-language/pr6/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
