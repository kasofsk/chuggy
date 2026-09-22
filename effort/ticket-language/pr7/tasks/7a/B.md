# Task B (PR 7a) — the plan crosses the boundary; the integer is minted by position

Worktree `~/claude/chuggy-wt/evkeys`, branch `model/evaluator-keys`, which carries Task A (model, goldens, generated, domain, actor) merged with Task S (migration 011). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Read, in order: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7a — decisions" (4, 5 and 6 are yours), `pr7/survey.md` §2, §5, §6 and surprises 2, 4, 12, `pr7/tasks/7a/A-report.md` and `S-report.md` (what landed, by file:line, and the item spelling 011 admits), `pr6/tasks/6b/B.md` and `B-report.md` (this task's shape in 6b), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres writes and reads, scheduler, http contract), `src/contract/`, `test/contract/{representations.ts, contractDocument.json}`, and the tests of all of them under `test/`.

- `decisionPlan.ts requestTasks`: mints `spawnedBefore + <1-based position in the set ordered by evaluator key>` (decision 4); one test pins that a sparse stage `{1, 3}` mints two consecutive integers and that a second set never re-mints one (survey 2's failure, red-proved against the old arithmetic). `schedulerRows.ts` stays the one column→index site; its doc says the stage key is positional by the model's release rule (decision 2).
- `authoring.ts` (interpreter): defaults' program is one evaluator per configured block with positional keys; `choices.stages` goes, `choices.evaluatorsMax` arrives (decision 6); the refusal rule mirrors the model's `programsWellFormed` (the generated mirror carries it — call it, do not restate it). `dispatchView.ts` encodes/decodes the plan; `decision.ts`'s stored text follows.
- Contract: `programStageSchema` strict `{key, evaluators: [{key}]}`; `programStageResponseSchema`; `draftInitializationResponseSchema.choices`; `dispatchCandidateSchema.program`; `contractDocument.json` and representations follow; `httpContract`/`responses`/`httpOutcomes` tests follow.
- The stage's configured block is selected by stage as before (decision 5): one sentence where it is selected (`taskBriefing.ts` or `executionSchedulerRun.ts`, whichever names the block) says every evaluator of a stage runs the stage's block.
- Every stored-text reader (memory `stored-text-outside-the-journal.md`) parses the new `CreateTicket`/candidate program; old rows are wiped, no lift.
- Comments: nothing says a stage is a width.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it. If a live SQL function still validates `fanout`, add its replacement to 011 (unlanded) and a case to the migration suite; say so.

## Gates on the tip

`check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each exit.

## Commits

On `model/evaluator-keys`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7a/B-report.md`: tip, what changed per layer, the wire shape of a stage and of `choices` (C builds on it), what C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md or the A/S reports got wrong. Under ~50 lines. Write the report, reply with its contents, and stop.

## Addendum (orchestrator, after A and S)

The branch tip is the merge of A b8937233 and S d208b133. Corrections to GOAL.md you build on: A's `taskPositionInSet(tasks, identity)` in `src/domain/task.ts` is decision 4's position-in-set, uncalled until you call it from `requestTasks`; `taskOrdinal` is now `taskRetirementKey` and `tasksInOrdinalOrder` is `tasksInEvaluatorKeyOrder`; `stageChoices(config)` returns rosters (`readonly EvaluatorDefinition[][]`) and `everyEvaluator(config)` the full one; `spawnEvalStage(ticket, id, index)` and `stageGeneration(ticket, index)` take the index, `evaluationTaskOf` takes the stage key. A-report lists your typecheck reds by file:line. S's report: `check-postgres` was green on S's tip only because no suite releases a program through the new arm, so run it on yours and treat that green as unproved until a suite does. Opus was overloaded during A; if you are not opus, that is why.
