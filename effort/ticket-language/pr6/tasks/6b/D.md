# Task D (PR 6b) — the explicit-task requirement leaves the model too; two model docs

Round 1 machine review (`pr6/reviews/6b-round1-machine.md`) found three things. Fix all three on a branch of your own, off the current tip of `model/task-identity` (1fb1bc26 or later; C is committing console work there in `~/claude/chuggy-wt/identity`, so do not use that worktree):

    git -C ~/claude/chuggy worktree add -b fix/identity-explicit-task ~/claude/chuggy-wt/identity-fix model/task-identity
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-fix/node_modules

Never `npm ci` under `ui/`. Read first: the review's finding 3 and its "What I verified clean", `pr6/GOAL.md` §"PR 6b — decisions" (6), `pr6/tasks/6b/B-report.md` (B deleted `taskDefaults` and the `ExplicitTask` lookup from `src/interpreter/executionRequirement.ts`; `test/interpreter/executionRequirement.test.ts:200` refuses such a configuration), `CLAUDE.md` (the model leads), `.chug/tasks/review-change.md`.

## Finding 3 — the model leads, so the model loses it

A requirement keyed by a task's integer has no meaning once a task is named by identity, and B deleted the lookup; the model still selects by it, so the next author would reinstate what this PR removed.

- `model/execution_requirement.qnt`: `ExplicitTask` leaves `RequirementSource`; `explicitTasks` leaves `RequirementDefaults`; `selectedRequirement` loses its first arm and its `task: int` parameter if nothing else reads it; the module doc follows. `model/tests/execution_requirement_test.qnt` follows (a case that exercised the explicit arm becomes one proving the kind default is the first source). `check-model.sh` proves that suite; run it.
- Generated mirror regenerated if the module is exported through `api.qnt` (check; `check-model-api`).
- `src/interpreter/executionRequirement.ts:36,46`, `src/contract/rosters.ts:166` (`requirementSources`), `src/adapters/postgres/schedulerRows.ts:172`, `test/contract/rosters.test.ts`, `test/interpreter/executionSchedulerRun.test.ts`: `ExplicitTask` goes; the roster test holding the roster to the model's is what proves the two agree.
- The baseline CHECK `execution_requirement_source_known` (`baseline/relations.ts:233`) admits `ExplicitTask`; 010 is unlanded, so add its restatement without that member to `010-task-identity.ts` (DROP CONSTRAINT / ADD CONSTRAINT, in the idiom 009 used for `dispatch_candidate`), with a `migration.test.ts` case that an `ExplicitTask` row is refused after 010 and red-proof it. Render-diff 001–009 stays empty. `contractDocument.json` if it publishes the roster.
- Comments: nothing left says a task can name its own requirement.

## Findings 1 and 2 — two model docs

- `model/AGENTS.md:13-14`: `taskIdentityValid`'s caller is `domain.qnt` (`taskIdentitiesValid`), as is `taskOwner`'s; `ticket.qnt` imports the module for `TaskIdentity`. Say what is true.
- `model/domain.qnt:348`: "ids sequential within the ticket" goes; the property the stale-completion argument at `:373-380` rests on is history-unique identity, bought by the cycle counter and `stageGeneration`. One sentence.

## Gates on the tip

`check-model` (once, at the end), `check-model-api`, `check-conformance`, `check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-figures`, `check-comments`, `check-paths`. Exit codes in the report.

## Commits

On `fix/identity-explicit-task`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/D-report.md`: tip, what changed per layer, the red-proof, gates, anything the review or this brief got wrong. Under ~40 lines. Write the report, reply with its contents, and stop.
