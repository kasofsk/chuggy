# Task S (PR 7a) — migration 011: the program is a plan

Worktree `~/claude/chuggy-wt/evkeys-schema`, branch `schema/evaluator-keys` off `origin/main` (PR 6b merged; confirm `git log -1 origin/main` is e9a6136e "Merge pull request #729"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b schema/evaluator-keys ~/claude/chuggy-wt/evkeys-schema origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evkeys-schema/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7a — decisions" (decision 7 is yours; 1, 2 and 6 say what the row carries), `pr7/survey.md` §5 and surprise 11, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/evaluation/evaluation.qnt` `planValid` (your arm restates it minus `taskDefinitionValid`, plus positional stage keys), `pr6/tasks/6b/S.md` and `S-report.md` (010's shape and red-proofs), `src/adapters/postgres/schema/migrations/{009-work-fanout,010-task-identity}.ts` whole, `deploy/rig/wipe-tickets.sql`, the memories `~/.claude/projects/-home-geoff-claude-chuggy/memory/migrations-render-literals.md` and `migrations-edited-in-place.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/adapters/postgres/schema/migrations/011-*.ts` and `index.ts`, `test/postgres/migration.test.ts`, the schema README if it describes `execution_request_task.evaluator` or the `CreateTicket` payload.

- Guard as 008–010: refuse while any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`; the header says why (`CreateTicket`'s `prog` changes shape, so a stored row no longer replays).
- `decision_event_is_valid`'s `CreateTicket` arm, `prog` items: an object with `key` a command integer equal to the item's 1-based position, `evaluators` a non-empty array of objects each with `key` a positive command integer, unique within the stage; `fanout` refused; `combinator` carried exactly as 010's arm carries it. Spell the item in the generated codec's spelling for `StageDefinition` (read `src/generated/` on origin/main for how a record of a list of records is encoded — A may rename nothing, but confirm the field names `key`/`evaluators` against A's report if it has landed by the time you write the arm). One place holds the spelling so B can move it.
- No DDL: `execution_request_task.evaluator` keeps its column and CHECK, and its meaning (an authored key) is a doc change in the schema README if the README states it, else nowhere. `dispatch_candidate.program` is text the wipe truncates; its encoding is B's.
- Landed migrations are not edited. Render-diff of 001–010 main vs branch empty (say which script).
- `test/postgres/migration.test.ts`: fresh install records 011; the guard case; the arm admits a well-formed `prog` with a sparse stage (`evaluators: [{key: 1}, {key: 3}]`) and refuses each of: `fanout` present, a non-positional stage key, an empty evaluator list, a duplicate evaluator key, a non-positive evaluator key. Red-proof each new case; name the mutation in the report.

Single-suite recipe: `node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare postgres://postgres:chuggy-check@127.0.0.1:55432/postgres <db>`, then `CHUG_PG_URL=postgres://postgres:chuggy-check@127.0.0.1:55432/<db> node --experimental-strip-types --test --test-name-pattern='…' test/postgres/migration.test.ts`; drop the database after. Full `check-postgres` on your tip will be red where TypeScript still writes `fanout` — B's; report which suites.

## Commits

On `schema/evaluator-keys`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7a/S-report.md`: tip, 011's shape, the item spelling the arm admits, the render-diff result, the red-proofs, which postgres suites are red and why they are B's, anything GOAL.md got wrong. Under ~40 lines. Write the report, reply with its contents, and stop.
