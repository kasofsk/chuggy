# Task S — migration 004 retires the accounts from the schema

Worktree: `~/claude/chuggy-wt/no-accounts-schema` (branch
`schema/no-accounts`, based on main 81e8093a). Run `npm ci` there first.
Scratchpad: `~/claude/chuggy-effort/ticket-language/scratch/S/`.
Read `~/claude/chuggy-effort/ticket-language/GOAL.md` first, then the repo's
CLAUDE.md and `.chug/tasks/review-change.md` — the author is bound by it.
Invoke `comments-describe-the-code:comments-describe-the-code` with the
Skill tool before writing. Read migration 003
(`src/adapters/postgres/schema/migrations/003-no-handoff.ts`) and its tests
in `test/postgres/migration.test.ts` as the pattern: guard first, CREATE OR
REPLACE whole bodies, drop-then-add CHECKs.

Schema only: `src/adapters/postgres/schema/migrations/004-no-accounts.ts`,
its registration in `index.ts`, and `test/postgres/migration.test.ts`. No
other TypeScript. **Never edit the landed baseline or 002/003.**

## What 004 does

1. Guard (`DO $$ … RAISE EXCEPTION $$`): refuse if any `ticket_projection`
   or `native_action` row has reason in ('GasExhausted',
   'FinalizationBudgetExhausted'), or any `journal_entry` row's stored
   record names either removed wall (look at how `entry` stores `rec` and
   its labels: the labels are "ticket-escalated gas_exhausted" and
   "ticket-escalated finalization_budget_exhausted"; match on the label,
   not a substring of the whole row). The header states why: a history
   that reached a wall the machine no longer has cannot be replayed.
2. `ticket_projection`: drop `gas_left`, `rework_left`, `finalization_left`
   and the CHECKs `ticket_projection_accounts_are_not_negative`,
   `ticket_projection_accounts_are_whole`; column grants go with the
   columns (verify nothing else names them in privileges.ts).
3. `dispatch_candidate`: drop `rework_policy`, `finalization_pricing`,
   `resume_pricing`.
4. Narrow `ticket_projection_reason_is_known` and
   `native_action_reason_check` by the two literals; keep every other
   literal exactly as 003/baseline has it (003 may have replaced some of
   these — read 003 first and take the CURRENT list).
5. Replace the release command admit (baseline functions.ts ~800–830) so
   it neither requires nor rejects reworkPolicy/finalizationPricing/
   resumePricing: it no longer reads them at all, and its reason list
   (~808) loses the two literals. Copy the body whole and remove only
   those lines; a reviewer will diff.
6. `deployment_authoring_policy.domain_configuration` (text, a JSON
   document): rewrite the singleton row to drop the keys reworkPolicy, gas,
   finalizationPricing (`jsonb - 'key'`), if a row exists.
7. Any other function or view reading the dropped columns: `grep -n
   'gas_left\|rework_left\|finalization_left\|rework_policy\|finalization_pricing\|resume_pricing'`
   across baseline/*.ts and 002/003, and replace each whole. Report each.

## Tests

Following the existing cases: fresh install reaches version 4; the ledger
records 004; each narrowed CHECK refuses a removed literal at version 4 (by
constraint name); the guard refuses when a projection row sits at a removed
reason AND when a journal row's record names a removed wall, leaving the
ledger at 3 each time; the six columns are absent after 004; the
authoring-policy JSON is rewritten. Note `test/postgres/workerPlanePostgres.test.ts`'s
definition matcher cannot see CREATE OR REPLACE bodies (recorded at the
handoff removal); do not rely on it.

Run `.chug/tasks/check-postgres.sh` and `.chug/tasks/check-queries.sh`
(docker is running); both exit 0. Exit 2 is could-not-run, never a pass.
check-queries WILL find tagged queries in `src/adapters/postgres/*.ts` that
still SELECT the dropped columns — that is Task B's, on another branch.
Report exactly which queries it names; do not fix them here.

## Render-diff

Render every migration's statements from main and from your branch (a
script under scratch importing `migrations` from `index.ts`) and diff: the
only difference may be 004. Put both renders and the diff under scratch and
name them in the report.

## Commit and report

One commit, message carries the why (house rule 12): the accounts left the
model (Geoff 2026-09-20, ticket convergence PR 1) so the schema stops
holding them. End with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
Do not push. Report to `~/claude/chuggy-effort/ticket-language/tasks/S-report.md`:
gate results verbatim (including the check-queries findings that are B's),
the render-diff result, anything unsure.
