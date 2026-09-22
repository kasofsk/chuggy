# Task S — migration 008, the boundary rewrite, and the wipe

Worktree `~/claude/chuggy-wt/escsum-schema`, branch `schema/escalation-sum` (off main bd63df14; `node_modules` is linked, never `npm ci` under `ui/`). Read, in order: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` (decisions are settled), `pr5/survey.md` (§3, §5 and surprises 4, 6, 7, 10, 12 are your map, with file:line), `src/adapters/postgres/schema/migrations/007-finalization-unavailable.ts` and `006-rename.ts` whole (the shape: header states the rule, guard first, functions replaced whole, grants), `pr3/tasks/S-report.md` and `pr4/tasks/S-report.md`, `src/adapters/postgres/schema/README.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`. Task A is renaming the model in a sibling worktree; the TypeScript that writes these columns is B's, after you. Your suites drive the SQL directly.

## Scope

1. **`008-escalation-sum.ts`** (registered in `migrations/index.ts`):
   - Guard: raise if any `journal_entry` row exists; the message names `deploy/rig/wipe-tickets.sql` as the remedy. State in the header why a migration that never rewrites a row has a guard at all (the actor at semantics 6 refuses every older row, so a journal with rows would come up with a ticket it cannot replay).
   - `ticket_projection`: add `escalation text NOT NULL DEFAULT 'NoEscalation'` CHECK over `NoEscalation, WorkFailureEscalated, WorkExecutionUnavailableEscalated, EvaluationFailureEscalated, EvaluationBlockedEscalated, FinalizationUnavailableEscalated`; drop `reason` and its CHECK; drop `resume_at` and its CHECK; add `escalation_evidence text` with CHECK `(escalation = 'NoEscalation') = (escalation_evidence IS NULL)` — no: evidence is optional on some kinds, so the CHECK is `escalation <> 'NoEscalation' OR escalation_evidence IS NULL`; grants for `chuggy_api` (read) and the writer role follow the ones `reason` had (`baseline/privileges.ts:807-808`).
   - `native_action`: `reason` → `escalation`, CHECK over the six plus the settled-row `DependencyRevoked` arm 005 kept; `request_finalization_approval` writes `'NoEscalation'`.
   - `decision_event_is_valid`: the `ExecutionBlocked` arm admits `{ticket}` alone (no `reason`); every other arm as 007 left it minus the old spellings 006 admitted (the wipe makes both-vintage admission pointless — say so in the header).
   - **`submit_task_completion` rewritten whole**: builds `ExecutionBlocked{ticket}` with no reason, keeps `in_reason` validated by `execution_blocked_reason_is_known` and written to `execution.blocked_reason` exactly as today; nothing else about it changes. This is the rewrite that lets the actor's vocabulary map die (survey 4).
   - Every function reading `reason`/`resume_at` on the projection or the action row follows (survey §3 lists them); `record_finalization_hold` and `submit_finalization_result` are untouched.
   - Render-diff of every earlier migration main vs branch must be empty (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`).
2. **`deploy/rig/wipe-tickets.sql`**: header says what it is for (a rehearsal rig whose tickets are disposable, before a migration whose guard requires an empty journal) and what it keeps; one `TRUNCATE ... ` naming every table in survey §3's wipe list (verify each against `baseline/relations.ts` and later migrations; name any table the survey missed or invented), then `UPDATE project SET head = 0, ingress_next = 1, ticket_next = 1, notification_next = 1, manifest_next = 1` (verify the column names at `baseline/relations.ts:684-705`). It must be runnable as `psql -f` by the owner role.
3. **Tests** in `test/postgres/migration.test.ts`: 008 applies on an empty journal; refuses with the wipe named when one row exists; the projection CHECKs (six kinds, evidence null when none); `submit_task_completion` on a block writes `blocked_reason` and journals an `ExecutionBlocked` event with no `reason`; the wipe: seed a project through the public functions (a released draft is enough), run the file, every truncated table empty, counters reset, `configuration_revision` and `project` still present. Red-proof each new assertion once (the harness's pattern from 007's cases).

## Gates

`check-postgres`, `check-queries` (will be red for B's TypeScript reading dropped columns — report which queries, do not edit `nativeReads.ts`), `check-figures`, `check-comments`, `check-paths`, `check-source` static. Report each exit on the tip.

## Commits

Small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr5/tasks/S-report.md`: tip, 008's statements in order, the `submit_task_completion` diff in one paragraph, the wipe's table list with any correction to the survey, tests and red-proofs, gates on the tip, what B must know (column names, the event shape, which queries are red). Under ~60 lines.
