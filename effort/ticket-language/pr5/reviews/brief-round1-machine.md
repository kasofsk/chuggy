# Review round 1, machine half — PR 5 "Escalated is a sum" (branch `model/escalation-sum`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/escsum-review-machine <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/escsum-review-machine/node_modules

Never `npm ci` under `ui/`. Your half: `model/`, `test/golden`, `src/domain`, `src/actor`, `src/interpreter`, `src/adapters`, `src/contract`, `src/adapters/postgres/schema/migrations/008-escalation-sum.ts`, `deploy/rig/wipe-tickets.sql`, and their tests. The surface half (`ui/`, `test/ui`) is another reviewer's. Diff: `git diff bd63df14..<tip> -- <your paths>`.

Read first: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` (the decisions, including the one above all others: the rig's tickets are wiped, so nothing older than semantics 6 replays and no lift exists), `pr5/survey.md`, `pr5/tasks/{A,S,B}-report.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The model against the package: `~/claude/chuggy-effort/ticket-language/package/model/ticket-domain/ticket.qnt` lines 30–70, 580–625, 925–970. Are the six constructor names and the resume derivation the package's? Is `EvaluationBlockedEscalated` stamped exactly where an evaluation set was interrupted and nowhere else? Is `deskConsistent` still an invariant the goldens walk?
2. Semantics 6 alone: is anything left that reads a pre-6 spelling or a `reason`/`resumeAt` field (`git grep -n "resumeAt\|resume_at\|NoReason\|ReleaseTicket\|FinalizationFailed\|wordAtCurrentVocabulary\|rowAtCurrentVocabulary" -- model src test`)? Does `storedJournalLegalOn` refuse a row stamped 5? B notes a row with a retired *field* parses because zod strips unknown keys — is that a failure anywhere, or only harmless under the wipe?
3. 008: guard first; render-diff of 001–007 main vs branch empty (`~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs`); `submit_task_completion` byte-identical but for the envelope; the two GRANTs B added are the least the writer needs; every function reading `reason`/`resume_at` replaced. Migration test red-proofs: pick three of S's assertions and re-prove them by mutation.
4. Evidence: trace each of the three sources (B-report "Where each evidence value comes from") to the projection and the read; construct a case where the evidence would be wrong or stale (e.g. two executions for one ticket; a continuation park after an execution park; a resume then a second finalization hold) and say whether the read answers the right one.
5. The wire: `ticketEscalationSchema`; `resumeAt` derived at read from the kind — is there any path where the read and the model's `resumeOf` could disagree?
6. The wipe: `deploy/rig/wipe-tickets.sql` against `baseline/relations.ts` and every later migration: a ticket-bearing table it misses, a kept table it truncates, an FK from a kept table to a wiped one. Run the migration test's wipe case with one table removed from the file to prove the case sees it.
7. Comments and docs: true, in the tree's voice, no quantities (`check-figures`), no stale path claims (`check-paths`). Run `check-figures`, `check-comments`, `check-paths`, `check-boundaries`, `check-queries`, `check-postgres` at the tip.

Verdict to `~/claude/chuggy-effort/ticket-language/pr5/reviews/round1-machine.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~80 lines. Remove your worktree when done.
