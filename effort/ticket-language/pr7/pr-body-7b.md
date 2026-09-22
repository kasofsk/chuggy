Step 7b of the ticket-language convergence (`chug-ticket-domain` at 76c95a9): **the evaluation instance.**

The package's evaluation module arrives at its own path, `model/ticket-domain/evaluation/evaluation.qnt`, importing 6b's task module; it diverges from the package in six hunks, each PR 8's and each listed in `model/AGENTS.md`. A ticket holds one evaluation instance per work cycle that entered evaluation, in place of the retained record and the live evaluation tasks; the instance's plan is the program 7a keyed, its runs count their own generations, and the ticket's spawn counter is the slot sum over those runs. One completion event, `TaskDone`, names the task, its terminal report (a work result, an evaluator's verdict, or a failure of either kind) and the disposition a failed stage takes; the separate reduce and blocked events are gone. A stopped evaluator, whether its process died or its execution was unavailable, parks the ticket at the blocked wall; a resume re-asks that evaluator alone at the next generation and keeps every pass beside it. A work task's wall stays its own escalation.

The worker's manifest keeps `Pass | Fail`; the door maps it to the evaluator's verdict, and an exhausted retry budget submits its own outcome, `ProcessFailed`, which the execution row records and the console draws as the stop it is. A durable unreadable source at a rework spawn parks the ticket on the desk carrying the git evidence, where the branch's first shape deferred it and would have starved the project's writer.

**Migration 012.** Guard as 008–011: refuses while any journal row exists and names `deploy/rig/wipe-tickets.sql`. `decision_event_is_valid` admits the completion as the codec spells it and refuses a verdict or a disposition on it; the blocked and reduce arms go; an absent program or dependency list is refused. `submit_task_completion` is rewritten whole, journalling the report read off the locked task row; its signature is unchanged. `execution_outcome_is_known` gains `ProcessFailed`, the migration's one DDL.

The console draws a cycle as its stages, a stage as its generations and a generation as its evaluators by key; a superseded generation stays a row, dimmed, so the rows sum to the cycle. No fabric or worker release: the manifest and the wire task kinds are untouched.

Survey, decisions, task reports and reviews: `~/claude/chuggy-effort/ticket-language/pr7/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
