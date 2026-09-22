# Task A (PR 7b) — the evaluation instance replaces the record and the live evaluation set

Worktree `~/claude/chuggy-wt/evinst`, branch `model/evaluation-instance` off `origin/main` (PR 7a merged; confirm `git log -1 origin/main` is f8d6c8fd "Merge pull request #730"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b model/evaluation-instance ~/claude/chuggy-wt/evinst origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evinst/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"The split" and §"PR 7b — decisions" (1–5 are yours to build; do not reopen them, but say in the report where one cannot be built as written and what you built instead), `pr7/survey.md` §1, §3, §4 and surprises 1, 5–11, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/evaluation/evaluation.qnt` whole and `ticket.qnt`'s `applyEvaluationReport`, `reportAdmissible`, `liveTaskList`, `decideEvaluationTerminal`, `decideResume` (how the package drives the instance; you drive it from chuggy's deciders the same way), `pr7/tasks/7a/A-report.md` (what the tree holds now), `pr6/tasks/6b/A.md` and `A-report.md` (the copy precedent and `model/AGENTS.md`), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, `test/random/`, and every test of those.

- First commit: the copy at `model/ticket-domain/evaluation/evaluation.qnt` with exactly decision 1's four divergences (`diff` against the package in the report, and the four lines listed in `model/AGENTS.md`). `ticket.qnt` imports it and drops its own `EvaluatorDefinition`/`StageDefinition`.
- `Ticket.evaluations`, `tasks` work-only, `record` gone, `idsAccounted` restated (decision 2). `Verdict` gone; the completion event `TaskDone{ticket, task, report: TaskTerminalReport}` with the disposition riding on a stage-concluding failure; `EvalReduce` and `ExecutionBlocked` gone (decisions 3, 4). The deciders drive the instance with the package's `applyProduced`/`applyFailure`/`concludeStage`/`resumeBlocked`/`currentTaskObligations` — never a chuggy re-statement of them. `stageGeneration` gone (decision 5). `decideExecutionBlocked` becomes the failure arm of the completion decider: an evaluator's wall marks it and the stage runs on; a work task's wall parks as today.
- Invariants: the package's `invariant(instance)` holds of every instance on every ticket; `tasksWellFormed` holds `tasks` to the work task; the evaluation obligation is derived, so its well-formedness is the instance's. `refinement.qnt`, `api.qnt`, tests, mc follow. `check-model` clean (slow; once at the end, log under `pr7/check-model-7b-A.log`).
- Goldens re-emitted; the corpus must carry: a stage passing at generation 1; a blocked evaluator parking the ticket and a resume that re-asks only it at generation 2 while the passes keep their status; an evaluation failure reworking; a sparse stage. Extend `test/golden/corpus.ts` scenarios if the existing ones cannot, and say which. `check-conformance`, `check-random` clean (re-pin the seed if draws moved, and say so).
- Generated mirror; `src/domain/{ticket,task,invariants,deciders,enablement}.ts`, `src/actor/{decisionEvent,equality,…}.ts` follow; the rework count reads the instances (decision 5) — the cap itself (`src/interpreter/reworkCap.ts`) is B's, but the domain function it calls is yours.
- Unit reds outside your layers that are exactly B's sites (`src/interpreter`, `src/adapters`, `src/contract`) are B's — list them by file.
- Comments: nothing says a task record, `EvalReduce`, `ExecutionBlocked` or a verdict called `Pass`; the instance's doc in `ticket.qnt` says what the list holds and when the last is current, in two sentences.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`. Exit codes in the report.

## Commits

On `model/evaluation-instance`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7b/A-report.md`: tip, the copy's diff against the package, what changed per layer, the shape of `TaskDone.report` and of `Ticket.evaluations` in the generated mirror (S, B and C build on them), what B and C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~60 lines. Write the report, reply with its contents, and stop.
