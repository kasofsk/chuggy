# Task S (PR 6b) — migration 010: the task identity in columns

Worktree `~/claude/chuggy-wt/identity-schema`, branch `schema/task-identity` off `origin/main` (PR 6a merged; confirm `git log -1 origin/main` names "Work fan-out goes"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b schema/task-identity ~/claude/chuggy-wt/identity-schema origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-schema/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" (decision 4 is yours; 3 and 5 say what the columns carry), `pr6/survey.md` §3, surprises 6–8, the package's `~/claude/chuggy-effort/ticket-language/package/model/task-contract/task.qnt` (the identity's fields and `taskIdentityValid`: your CHECKs restate it), `pr6/tasks/S.md` and `S-report.md` (009's shape and red-proofs), `src/adapters/postgres/schema/migrations/{008-escalation-sum,009-work-fanout}.ts` whole, `deploy/rig/wipe-tickets.sql`, the memories `~/.claude/projects/-home-geoff-claude-chuggy/memory/migrations-render-literals.md` and `migrations-edited-in-place.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/adapters/postgres/schema/migrations/010-*.ts` and `index.ts`, `test/postgres/migration.test.ts`, `deploy/rig/wipe-tickets.sql` if a relation is added (probably not), the schema README if it describes `execution_request_task`.

- Guard as 008/009: refuse while any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`; header says why (`TaskDone` loses `tid` for a structured `task`, so a stored row no longer replays).
- `execution_request_task`: `cycle`, `stage`, `generation`, `evaluator` columns; per arm a whole-identity CHECK in the idiom of the existing multi-column CHECK (`Work`: cycle > 0 and the three null; `Evaluation`: all four > 0); `task` (the wire integer) and its PK, unique, FK and trigger untouched; `GRANT SELECT(col)` per column as `privileges.ts` grants the rest, column by column. If the existing `stage` (a 0-based index) becomes the package's positive key, restate its CHECK and say so; if you keep the index and add the key under another name, say why.
- `decision_event_is_valid`'s `TaskDone` arm: admits `value->'task'` as `{"type":"WorkTask","value":{ticket,cycle}}` / `{"type":"EvaluationTask","value":{…}}` in exactly the generated codec's spelling (read `src/generated/` on origin/main to match it, and note that A may rename; keep the arm's spelling in one place so B can move it), refuses `tid` and a half identity.
- `submit_task_completion` rewritten whole (008's precedent, its header explains why the whole function is the unit): the journalled `TaskDone` carries the identity read off `execution_request_task` in the same locked transaction; `AlreadySubmitted` and `BindingMismatch` stay as they are. If the signature changes, DROP/CREATE/GRANT; if not, `CREATE OR REPLACE` and no grant change — say which.
- Landed migrations are not edited. Render-diff of 001–009 main vs branch empty (say which script).
- `test/postgres/migration.test.ts`: fresh install records 010; the guard case; the four columns exist with their CHECKs (a half identity is refused per arm); the grant per column; `decision_event_is_valid` admits the structured event and refuses `tid`; `submit_task_completion` journals the identity (seed a request task row with an identity, submit, read the journal row back). Red-proof each new case; name the mutation in the report.

Single-suite recipe: `node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare postgres://postgres:chuggy-check@127.0.0.1:55432/postgres <db>`, then `CHUG_PG_URL=postgres://postgres:chuggy-check@127.0.0.1:55432/<db> node --experimental-strip-types --test --test-name-pattern='…' test/postgres/migration.test.ts`; drop the database after. Full `check-postgres` on your tip will be red where TypeScript does not yet write the columns — B's; report which suites.

## Commits

On `schema/task-identity`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/S-report.md`: tip, 010's shape (columns, CHECKs, functions, grants), the event spelling the arm admits, the render-diff result, the red-proofs, which postgres suites are red and why they are B's, anything GOAL.md got wrong. Under ~40 lines. Write the report, reply with its contents, and stop.
