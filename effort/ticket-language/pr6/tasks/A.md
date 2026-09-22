# Task A — work fan-out leaves the model, the domain and the actor

Worktree `~/claude/chuggy-wt/fanout`, branch `model/work-fanout-goes` off `origin/main` (0f94fe6b). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b model/work-fanout-goes ~/claude/chuggy-wt/fanout origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/fanout/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` (the split is decided; you are PR 6a), `pr6/survey.md` §1 and surprise 1, `pr5/tasks/A.md` and `pr5/tasks/A-report.md` (the shape of this task last time, and the gates it ran), the package's `~/claude/chuggy-effort/ticket-language/package/model/task-contract/task.qnt` (`WorkTask{ticket, cycle}`: the reason there is no fan-out), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`model/`, `test/golden/`, `src/generated/`, `src/domain/`, `src/actor/`, `test/conformance/`, `test/itf/`, `test/actor/`, `test/domain/`, `test/generated/`, and every test of those.

- `Ticket.workFanout` goes; `freshTicket`/`decideReleaseTicket`/`CreateTicket` lose the parameter and the payload field; the nondet pick and `workFanoutChoices` go; every `spawnOn(…, WorkTask, x.workFanout)` spawns one task; the invariant at `domain.qnt:941-943` says one; `N_TASKS` goes if nothing else reads it (say if something does). The refinement and `api.qnt` follow. `check-model` clean (`.chug/tasks/check-model.sh`; slow, run once at the end and log it under `pr6/`).
- Goldens re-emitted (`.chug/tasks/emit-goldens.sh`); `test/golden/manifest.json` invariants follow; `check-conformance` and `check-random` clean.
- Generated mirror regenerated; `src/domain` and `src/actor` follow (the `CreateTicket` event value, equality, decision events, the actor harness). Unit reds outside your layers that are exactly B's contract/interpreter sites are B's — list them by file.
- Comments: nothing left says a ticket chooses how many work tasks it runs.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, `ui/`, migrations. If a compile forces an edit there, make the smallest one and list it.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-model-api`, `check-source` (report the unit reds that are B's by file), `check-figures`, `check-comments`, `check-paths`. Exit codes in the report.

## Commits

On `model/work-fanout-goes`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/A-report.md`: tip, what changed per layer, what B and C must change (by file:line), files outside your layers touched, gates on the tip, anything GOAL.md got wrong. Under ~50 lines. Reply with its contents.
