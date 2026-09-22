# Task B — work fan-out leaves the interpreter, the adapters and the contract

Worktree `~/claude/chuggy-wt/fanout`, branch `model/work-fanout-goes`, which carries Task A (model, goldens, generated, domain, actor) merged with Task S (migration 009). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Read, in order: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md`, `pr6/survey.md` surprise 1 and §2, `pr6/tasks/A-report.md` and `pr6/tasks/S-report.md` (what landed and what each left you, by file:line — A's list is exact), `pr5/tasks/B.md` and `pr5/tasks/B-report.md` (this task's shape last time), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/` (postgres reads and writes, http contract and outcomes, dispatch views, selector), `src/contract/` (authoring, responses, http cursor), `test/contract/{representations.ts, contractDocument.json}` and the tests of all of them under `test/`.

- `workFanout` leaves `authoringSchema`, `ReleaseAuthoring`'s wire, `draftInitializationResponseSchema.choices.workFanouts`, the dispatch view and its candidate row, the HTTP cursor field, the postgres decision/dispatch-view/selector writers and readers (S dropped `dispatch_candidate.work_fanout`; see S-report for every column and function that changed), `outcomes.ts`, `http/contract.ts`. The contract document and representations follow.
- Every stored-text reader of a release event (`draft_revision.authoring`, `operation.command`, `selector_proposal_delivery.command` — see the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/stored-text-outside-the-journal.md`) parses the new shape; old rows are wiped, no lift.
- Comments: nothing left says a ticket chooses a work width.

NOT yours: `model/`, `src/domain/`, `src/actor/`, migrations, `ui/`. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-source` (unit + static), `check-boundaries`, `check-queries`, `check-postgres` (the migrated schema is what your queries run on), `check-conformance`, `check-figures`, `check-comments`, `check-paths`. Report each gate's exit.

## Commits

On `model/work-fanout-goes`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/B-report.md`: tip, what changed per layer, what C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md or S-report got wrong. Under ~50 lines. Reply with its contents.
