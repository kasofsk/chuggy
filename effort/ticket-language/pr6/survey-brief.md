# PR 6 survey — Import task_contract

Read-only. Detached worktree of your own at `origin/main` (62574ae8, PR 5 merged and released):

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/pr6-survey origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/pr6-survey/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/SPIKE.md` (the plan table's PR 6 row, "Tasks and evaluation", "Decisions"), `pr5/survey.md` and `pr5/GOAL.md` (the shape and depth wanted, and what PR 5 deferred), `pr3/GOAL.md` (the fabric-facing boundary it deliberately did not move: `executionTaskKinds`, `execution_request_task.kind`, `CHUG_WORKER_TASK.taskKind`), the package's `~/claude/chuggy-effort/ticket-language/package/model/task-contract/task.qnt` whole (it is 92 lines) and every use of it in `package/model/ticket-domain/ticket.qnt` (obligation derivation, `TaskNotCurrent`, `reportAdmissible`), `CLAUDE.md`, `.chug/tasks/review-change.md`. The fabric is at `~/claude/chuggy-fabric` (read-only; its worker plane and the worker image under chuggy's `images/worker/` are what report a task back).

## Standing decisions

- The rig's tickets are disposable (Geoff, 2026-09-21): a migration may again refuse a non-empty journal and name `deploy/rig/wipe-tickets.sql`; no lift for old rows. Say whether 009 needs that or is additive.
- Package pinned at 76c95a9; no package changes. Evaluator keys, generations and per-evaluator status are PR 7's; say how much of `EvaluationTask{ticket, workCycle, stage, generation, evaluator}` PR 6 can carry before PR 7 exists, and what placeholder is honest (stage index for key, generation 1, evaluator ordinal?).
- This is the first PR that changes what the worker sends back. The plan says it "needs the fabric to report the obligation back". Decide with evidence whether chuggy's adapter can map the new identity onto today's wire (as PR 3 kept `Work`/`Evaluation` at the boundary) so the fabric and worker change in a later release, or whether lockstep is forced, and by what.

## Questions to answer, each with file:line evidence

1. **The model.** Chuggy's `Task`, `TaskKind`, ticket-sequential `id` allocation, `tasks`/`record`, `SpawnWorkTasks`/`SpawnEvaluation` effects, `TaskDone`, duplicate absorption by id, every decider/enablement that reads a task. The package's target: `TaskIdentity`, `TaskDefinition` (four opaque refs), `TaskObligation`, `ValidatedTaskResult`, `TaskTerminal`, and how `ticket.qnt` derives the live obligation from state and refuses a report whose obligation is not current. List the diff against the package's `task.qnt` after this PR: can `model/` literally import the package file at the pin (how `check-model.sh`, `emit-goldens.sh` and the generated mirror resolve modules), or is it a verbatim copy until PR 9?
2. **Identity across the boundary.** Where a task id is generated, stored and echoed today: `decisionPlan.ts`'s request building, `execution_request_task`, `execution.task`, `CHUG_WORKER_TASK`, `images/worker/*` report, the fabric's worker plane, `submit_task_completion` (rewritten whole in 008), `execution_result*`, `storedSchedulerCompletion`, the readiness and completion accumulators. What the worker sends today and what "the whole obligation" means on the wire.
3. **Schema 009.** Every column, CHECK, function and index that carries a task id or kind. Propose 009's shape: structured identity columns vs one JSON column; how `submit_task_completion` refuses a non-current obligation (`TaskNotCurrent`) versus today's absorption; whether the journal's `TaskDone` shape changes (it will carry the identity) and so whether the wipe is needed.
4. **The four opaque refs.** For `workload`, `inputs`, `executionRequirements`, `resultContract`: where each fact lives today (image/workload digest, brief and configuration, `requirement_*` columns on `execution`, the manifest schema version) and what the domain sees of it after (opaque strings the domain compares for equality and never reads).
5. **Wire and console.** Which reads expose task ids or kinds (`ticketResponseSchema`, run/attempt reads, the console's task cards, `codeLabels`), and what the structured identity gives them.
6. **Surprises**: anything the SPIKE row got wrong, and anything PR 3/4/5 left for PR 6 (grep the three GOAL.md files and `pr5/survey.md` for "PR 6").

## Output

`~/claude/chuggy-effort/ticket-language/pr6/survey.md`, in the style and depth of `pr5/survey.md`, under ~220 lines, numbered surprises at the top, and a closing "Release coupling" section with the recommendation on fabric lockstep. Remove your worktree when done (`git -C ~/claude/chuggy worktree remove --force ~/claude/chuggy-wt/pr6-survey`). Reply with the surprises and the release-coupling sections only.
