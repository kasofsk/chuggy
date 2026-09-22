# Task S (PR 7b) — migration 012: one completion event, and the absent-key hole closed

Worktree `~/claude/chuggy-wt/evinst-schema`, branch `schema/evaluation-instance` off `origin/main` (PR 7a merged; confirm `git log -1 origin/main` is f8d6c8fd "Merge pull request #730"). Create it yourself:

    git -C ~/claude/chuggy fetch -q origin && git -C ~/claude/chuggy worktree add -b schema/evaluation-instance ~/claude/chuggy-wt/evinst-schema origin/main
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evinst-schema/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7b — decisions" (6 is yours; 3 and 4 say what the row carries), `pr7/survey.md` §3, §5 and surprises 5–7, 11, the package's `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` lines 83–100 (`FailureKind`, `TaskTerminalReport`) and `evaluation.qnt` lines 20–35, `pr7/tasks/7a/S.md` and `S-report.md` (011's shape, its red-proofs, and the absent-`prog` hole you close), `pr7/reviews/7a-round1-machine.md` §"Correction to B's report" (the arm's only coverage is your table), `src/adapters/postgres/schema/migrations/{010-task-identity,011-evaluator-keys}.ts` whole, `deploy/rig/wipe-tickets.sql`, the memories `~/.claude/projects/-home-geoff-claude-chuggy/memory/migrations-render-literals.md` and `migrations-edited-in-place.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/adapters/postgres/schema/migrations/012-*.ts` and `index.ts`, `test/postgres/migration.test.ts`, `test/postgres/nativeReads.test.ts` (the fixture at :104 that omits `prog`/`deps` — give it both), the schema README if it describes the journal's events.

- Guard as 008–011: refuse while any `journal_entry` row exists, naming `deploy/rig/wipe-tickets.sql`; the header says why (`TaskDone` carries a report in place of a verdict; two event kinds leave the vocabulary).
- `decision_event_is_valid` replaced whole: the `TaskDone` arm admits `value->'report'` as the generated codec spells `TaskTerminalReport` (read A's report if landed; else the package's constructors — `EvaluationResultReport`, `TerminalFailureReport{kind: ProcessFailure | ExecutionUnavailableFailure}`, `WorkResultReport` — in the codec's `{"type","value"}` idiom, spelled in consts at the top so a rename lands in one place) and refuses `verdict`; the `EvalReduce` and `ExecutionBlocked` arms are deleted (a row of either kind is refused); the `CreateTicket` arm's `deps` and `prog` tests use `IS DISTINCT FROM 'array'` so an absent key is refused, everything else in that arm 011's byte for byte.
- `submit_task_completion` rewritten whole (010's precedent): the journaled `TaskDone` carries the report built from the row under the same lock — the manifest's `Pass`/`Fail` mapped as decision 3 says for an evaluation task and a work task, the explicit empty manifest as `ProcessFailure`, and the blocked path (`in_outcome` blocked) as `TerminalFailureReport{kind: ExecutionUnavailableFailure}` naming the task, never a ticket-level `ExecutionBlocked`. `AlreadySubmitted` and `BindingMismatch` unchanged. If the signature changes, DROP/CREATE/GRANT; if not, `CREATE OR REPLACE` and no grant change — say which.
- `execution_result.verdict` and its CHECK untouched (the manifest's attestation). No DDL expected; if a bound re-renders, follow 009/011's precedent and say so.
- Landed migrations are not edited. Render-diff of 001–011 main vs branch empty (say which script).
- `test/postgres/migration.test.ts`: fresh install records 012; the guard case; a table for the `TaskDone` arm with, per report constructor, one admitted row, one value-wrong row and one shape-wrong row (a report by text, a missing `kind`, a `verdict` still present); `EvalReduce` and `ExecutionBlocked` rows refused; a `CreateTicket` omitting `prog`, and one omitting `deps`, refused (red-proof: revert to `<> 'array'` and watch both admitted); `submit_task_completion` journals each report shape from a seeded row (pass, fail, empty-manifest fail, blocked), read back from the journal. Red-proof each new case; name the mutation in the report.

Single-suite recipe: `node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare postgres://postgres:chuggy-check@127.0.0.1:55432/postgres <db>`, then `CHUG_PG_URL=postgres://postgres:chuggy-check@127.0.0.1:55432/<db> node --experimental-strip-types --test --test-name-pattern='…' test/postgres/migration.test.ts`; drop the database after. Full `check-postgres` on your tip will be red where TypeScript still journals a verdict or an `EvalReduce` — B's; report which suites.

## Commits

On `schema/evaluation-instance`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7b/S-report.md`: tip, 012's shape, the report spelling the arm admits, the render-diff result, the red-proofs, which postgres suites are red and why they are B's, anything GOAL.md got wrong. Under ~45 lines. Write the report, reply with its contents, and stop.
