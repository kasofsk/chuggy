# Task B (PR 6b) — the identity crosses the boundary; the integer stays the wire's

Worktree `~/claude/chuggy-wt/identity`, branch `model/task-identity`, which carries Task A (copy, model, goldens, generated, domain, actor) merged with Task S (migration 010). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Read, in order: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" (5 and 6 are yours), `pr6/survey.md` §2, §5, surprises 7–9, 12, `pr6/tasks/6b/A-report.md` and `S-report.md` (what landed, by file:line, and the event spelling 010 admits), `pr6/tasks/B.md` and `B-report.md` (this task's shape in 6a, including the mailbox-bound trap it found), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres writes and reads, scheduler, http contract, worker pod document), `src/contract/`, `test/contract/{representations.ts, contractDocument.json}`, and the tests of all of them under `test/`.

- `decisionPlan.ts requestTasks`: mints the wire integer from `spawned` as decision 5 says and carries the identity beside it; `decision.ts` writes the identity columns S added; `scheduler.ts` reads them onto `LogicalExecution` and the pod document (`CHUG_WORKER_TASK` gains nothing the worker reads; the golden `test/adapters/kubernetesWorkerPodDocument.golden.json` changes only if you add a field — prefer not to); `wire.ts storedSchedulerCompletion` reads the structured `TaskDone`; `projectWriter.ts`'s continuation fence unchanged; `executionRequirement.ts`: `taskDefaults` by decimal id goes, `taskKindDefaults["Evaluation:<stage>"]` keys by the package's positive stage (decision 6), fixtures follow.
- Contract: `executionSummarySchema` gains `identity` (the sum, as the generated codec spells it) beside `task`; `operationalReads.ts` fills it from the columns; the page order and the cursor stay on the integer; `rosters.ts executionTaskKinds` unchanged (release coupling). The contract document and representations follow.
- Every stored-text reader (memory `stored-text-outside-the-journal.md`) parses the new `TaskDone`; old rows are wiped, no lift.
- The several-commit branch in `executionSourceObservation.ts` that 6a's reviewer left: delete it if the identity makes it provably unreachable, else leave it and say why.
- Comments: nothing says the integer is the task's identity; it is the wire's name for one.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each exit.

## Commits

On `model/task-identity`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/B-report.md`: tip, what changed per layer, the wire shape of `identity` (C builds on it), what C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md or S-report got wrong. Under ~50 lines. Write the report, reply with its contents, and stop.

## Addendum (orchestrator, after A and S)

The branch tip is the merge 405063aa (A 223a986c + S cfcc4f83). Two corrections to GOAL.md you build on: `generation` is derived (`stageGeneration` in `src/domain`, A-report), not the constant 1, and 010 made the existing `execution_request_task.stage` the package's positive key (S-report: send `stageIndex + 1` from `requestTasks`; every reader of that column moves with it, S lists them). The postgres fixtures A's report lists under "C" (`privileges.test.ts`, `migration.test.ts:1227`, `scheduler.test.ts:1133`, `finalizerHarness.ts`, …) are yours; the `value->'tid'` readers in the baseline and 004–009 are frozen bodies that 010 already replaced. 010 is unlanded, so if a live function you find still reads `tid`, add its replacement to 010 and its case to the migration suite rather than a new migration; say so.
