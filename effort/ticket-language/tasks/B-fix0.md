# Task B-fix0 — the observation bound moves out of the landed baseline

Worktree: `~/claude/chuggy-wt/no-accounts-fixb`, branch
`model/no-accounts-fixb` (Task B's tip eb7f1fdb; `node_modules` linked).
Task C is committing on `model/no-accounts` in another worktree: do not
touch that worktree or branch. Your commit is merged later.

Read the repo's CLAUDE.md, `.chug/tasks/review-change.md`, the header of
`.chug/tasks/check-postgres.sh`, and commit `8c7cfcfd` on this branch
(`git show 8c7cfcfd`). Invoke `comments-describe-the-code:comments-describe-the-code`
with the Skill tool before writing.

## The defect

`8c7cfcfd` edited two literals inside the LANDED baseline migration
(`baseline/relations.ts` `session_turn_text_is_bounded`, and
`baseline/seed.ts` `leadObservationTokensPerDecision`). The tree's rule is
that a landed migration body is never edited: the ledger cannot see a
rewritten body, so an installation at version 1 (the rig) keeps the old
figure while a fresh install gets the new one, and the two schemas differ
with the same ledger. The commit message's "permissive rather than wrong"
is true of the value and beside the point about the ledger.

## The fix

1. Revert both baseline literals to exactly what main has
   (`git show main:src/adapters/postgres/schema/migrations/baseline/relations.ts`,
   same for seed.ts). The baseline renders the figure it rendered when it
   landed.
2. Migration `004-no-accounts.ts` (unlanded, this PR's) carries the move:
   `ALTER TABLE session_turn DROP CONSTRAINT session_turn_text_is_bounded`
   then `ADD CONSTRAINT` with the new figure rendered as a literal (copy
   the whole CHECK from the baseline and change only the bound), and an
   UPDATE of wherever `baselineControls.limits.tokensPerDecision` was
   seeded (read seed.ts and find the table and row) to the new figure.
   The migration's header gains one sentence saying why: a ticket and a
   dispatch candidate got smaller when the accounts left, so the widest
   observation a lead turn can be handed did too.
3. The constant: `leadObservationTokensPerDecision` in `baseline/seed.ts`
   keeps the baseline's literal. Export the current rendering from the
   004 module (the same name, or `leadObservationTokensPerDecisionAt004`
   — pick the one whose readers read well) and point
   `test/adapters/leadTokenBudget.test.ts` and
   `test/postgres/migration.test.ts` (~1021) at the migration that
   currently renders it, so the test still asserts rendering == derivation
   and would go red the next time the derivation moves without a
   migration. The installed-constraint case (~527) must pass on a fresh
   install through 004.
4. Render-diff: render every migration from main and from this branch
   (script under `~/claude/chuggy-effort/ticket-language/scratch/B-fix0/`);
   the only differences may be inside 004. Put both renders and the diff
   there.

Run `.chug/tasks/check-postgres.sh`, `check-queries.sh`, `check-comments.sh`,
`check-figures.sh`, `check-paths.sh`, and `node --test --test-reporter=spec test/adapters/leadTokenBudget.test.ts test/postgres/migration.test.ts`;
all exit 0. Exit 2 is could-not-run.

One commit, message carrying the why (house rule 12), ending with
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; `--no-verify`
is expected (the console is red until Task C) — say so in the last
paragraph. Do not push. Report to
`~/claude/chuggy-effort/ticket-language/tasks/B-fix0-report.md`: what
moved, the render-diff result, gate output verbatim.
