# Task S — migration 009: work fan-out leaves the schema

Worktree `~/claude/chuggy-wt/fanout-schema`, branch `schema/work-fanout-goes` off `origin/main` (0f94fe6b). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b schema/work-fanout-goes ~/claude/chuggy-wt/fanout-schema origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/fanout-schema/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` (you are PR 6a's schema half), `pr6/survey.md` surprise 1 and §3, `pr5/tasks/S.md` and `pr5/tasks/S-report.md` (008's shape: the wipe guard, functions replaced whole, grants restated), `src/adapters/postgres/schema/migrations/008-escalation-sum.ts` whole, `deploy/rig/wipe-tickets.sql`, the memory files `~/.claude/projects/-home-geoff-claude-chuggy/memory/migrations-render-literals.md` and `migrations-edited-in-place.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/adapters/postgres/schema/migrations/009-*.ts` and `index.ts`, `test/postgres/migration.test.ts`, `deploy/rig/wipe-tickets.sql` if a relation changes (probably not), `src/adapters/postgres/schema/README.md` if it names the field.

- Guard as 008: refuse while any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`; header says why (the `CreateTicket` payload loses `workFanout`, so a stored row no longer replays).
- Every column that stores `workFanout`/`work_fanout` (grep `relations.ts`; `ticket_projection`? `draft_revision`? the dispatch-view tables?) dropped, with its CHECKs and any index; every function that reads or validates it replaced whole (`decision_event_is_valid`'s `CreateTicket` arm; the `command_integer(value->'workFanout')` arms in the draft/admit functions; `request_*`/`submit_*` that select it; the dispatch-view functions), grants restated as 008 restates them (`privileges.ts` spells signatures: DROP/CREATE/GRANT where a signature changes).
- Landed migrations are not edited. Render-diff of 001–008 main vs branch empty (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs` or your own; say which).
- `test/postgres/migration.test.ts`: fresh install records 009; the guard case seeds the journal row alone (as 008's does after PR 5's sweep); the dropped columns are gone; `decision_event_is_valid` admits `CreateTicket` without the field and refuses it with the field (both pinned); every replaced function's grant is proved as 008's grants are. Red-proof each new case (name the mutation in the report).

The single-suite recipe: `node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare postgres://postgres:chuggy-check@127.0.0.1:55432/postgres <db>` then `CHUG_PG_URL=postgres://postgres:chuggy-check@127.0.0.1:55432/<db> node --experimental-strip-types --test --test-name-pattern='…' test/postgres/migration.test.ts`; drop the database after. The full `check-postgres` on your tip will be red where TypeScript still writes the field into a column you dropped — that is B's; report which suites.

## Commits

On `schema/work-fanout-goes`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/S-report.md`: tip, 009's shape (columns, functions, grants), the render-diff result, the red-proofs, which postgres suites are red and why they are B's, anything GOAL.md got wrong. Under ~40 lines. Reply with its contents.
