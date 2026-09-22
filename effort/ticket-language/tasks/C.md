# Task C — the console loses the accounts

Worktree: `~/claude/chuggy-wt/no-accounts` (branch `model/no-accounts`).
Tasks A, S and B have landed: the wire's ticket view has no gasLeft,
gasMax, reworkLeft or finalizationLeft; the authoring options have no
reworkPolicies, finalizationPricings or resumePricings pages; the create
request has no reworkPolicy/finalizationPricing/resumePricing;
`escalationReasons` has no GasExhausted or FinalizationBudgetExhausted;
a parked ticket with a resume point is always retryable. Read
`~/claude/chuggy-effort/ticket-language/tasks/B-report.md` for the
`ui/chuggy-ui/` files check-source names. Scratchpad:
`~/claude/chuggy-effort/ticket-language/scratch/C/`.
Read `~/claude/chuggy-effort/ticket-language/GOAL.md` first, then the
repo's CLAUDE.md and `.chug/tasks/review-change.md` — the author is bound
by it. Invoke `comments-describe-the-code:comments-describe-the-code` with
the Skill tool before writing. The console's copy standard: nouns,
one-word statuses, one short line max.

Touch only `ui/chuggy-ui/` and `test/ui/` at the repo root if B left it
to you. The UI reaches the contract through `../../../../src/contract/*.ts`
imports; those are already changed.

## What goes

Chase the console's typecheck (however check-source runs it) plus the
exhaustive-switch lint. Known sites: `app/browser/ui/BudgetMeter.tsx` and
its test (delete: nothing it drew exists), `app/core/ticketAccounts.ts`
and its test (delete or reduce to what remains), `app/browser/ticket/
ticketPageFacts.ts` (the budget facts), `app/browser/TicketCreationAdvanced.tsx`
(the three pricing pickers), `app/core/ticketCreation.ts`,
`app/core/resumePoint.ts` (affordability: a resume point is now enough),
`app/core/codeLabels.ts` and `codeSentences.ts` (the two reasons),
`app/browser/TicketProvenance.tsx`, `app/core/ticketSections.ts`,
`app/browser/ticket/TicketSituation.tsx`, and their tests under
`ui/chuggy-ui/test/` (`ticketPageLedger`, `resumePoint`, `ticketAccounts`,
`ticketCreationFixture`, `repositoryPage`, `budgetMeter`,
`ticketPageFixture`, `ticketLedgerFixture`, `ticketLabels`, `ticketBrief`,
`ticketActions`, `codeLabels`, `inboxList`, `ticketSections`,
`ticketAttempt`, `projectTableRows`). Delete a test that existed only for
an account; never weaken one to keep it. A comment that explained the
accounts is rewritten to describe what the code now shows, not what was
removed.

Then `grep -rn -i 'gas\|rework\|pricing\|budget\|afford' ui/chuggy-ui`
and account for every remaining hit in your report (rework the verb and
the resume point `ResumeReworking` stay; list only account hits as
removed and say the rest are unrelated).

## Gates

Run `.chug/tasks/ci.sh` in full (docker is running). Everything green,
including check-source over the whole tree and the console suites. Exit 2
is could-not-run: fix the environment, never treat it as a pass.

## Commit and report

Commit on the branch, message carrying the why (house rule 12); end it
with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The hook
should pass now; if not, say why in the report rather than bypassing it.
Do not push. Report to `~/claude/chuggy-effort/ticket-language/tasks/C-report.md`:
what changed, ci.sh's result verbatim, remaining grep hits with their
meaning, anything unsure.
