# Task C report — the console loses the accounts

Branch `model/no-accounts`, worktree `~/claude/chuggy-wt/no-accounts`, commit
`ba75bdab`. Not pushed.

## What changed

**Deleted outright** (nothing they drew exists any more):
- `ui/chuggy-ui/app/browser/ui/BudgetMeter.tsx` + `.css`, `test/budgetMeter.test.tsx`
- `ui/chuggy-ui/app/core/ticketAccounts.ts` + `test/ticketAccounts.test.ts`

**Rewritten**:
- `app/core/resumePoint.ts` — `ResumeSituation`/`ResumeConsequence` lose
  `reworkBudget`, `resumePricing`, `refillsReworkTo`, `cost`; `resumeGasCharge`
  and `finalizationWalled` are gone; `walledPoint`'s `ReworkBudgetExhausted`
  case unconditionally returns `ResumeReworking` (no budget check), and the
  `FinalizationBudgetExhausted`/`GasExhausted` cases are gone because those
  reasons no longer exist on the wire roster.
- `app/core/codeLabels.ts` — `WallFacts` drops `reworkMax`/`finalizationMax`;
  `ResumeOffer` drops `NoGas` and carries a bare `point` instead of a `drawn`
  record; `resumeActionEffect`/`ticketActionEffect` lose their rework-standing
  parameter and every resume/action cost is now `"free"` unconditionally
  (there is nothing left to price).
- `app/browser/ticket/TicketSituation.tsx` — `SituationBudgets` and the
  "Budgets" `<Panel>` are deleted from the JSX entirely; `TicketSituation`
  and `SituationNotice` drop their `accounts` prop.
- `app/browser/ticket/ticketPageFacts.ts` — `TicketPageFacts` loses `accounts`;
  `MachineAccounts`/`resumeChargeKnown`/`resumeAfforded`/`resumeDrawnOf`/
  `resumeDrawnRead` are gone, replaced by `resumeOfferOf`/`resumeBeforeDraft`/
  `resumePointRead`.
- `app/browser/TicketCreationAdvanced.tsx` — the `Pricing` component (three
  `ChoiceRow`s: rework, finalization, resume) is deleted; the remaining
  work-fanout/finalizer picker is renamed `WorkAndFinalizer` since it no
  longer prices anything.
- `app/core/ticketCreation.ts`, `TicketProvenance.tsx`, `TicketPage.tsx`,
  `TicketActions.tsx`, `codeSentences.ts`, `ticketActions.ts`,
  `ticketSections.ts` — all pricing/budget fields, labels and prop plumbing
  removed per the brief's known-sites list.
- `app/styles/tokens.css` — `--col-meter-name`/`--width-meter` (dead,
  BudgetMeter was their only consumer) deleted; three other tokens' comments
  ("meters"/"meter cells") trimmed since nothing draws a meter any more —
  the tokens themselves (`--surface-2`, `--wash`, `--radius-1`) stay, still
  used elsewhere.
- `ui/chuggy-ui/README.md` — "The situation column holds exactly the wall,
  the actions with their costs, the three budgets and a list of anchors"
  was a stale factual claim (the Budgets panel is gone); fixed to describe
  what the column now holds.
- Every test file the brief listed, plus every test file `tsc` or a
  content grep turned up with account-shaped fixtures: `codeLabels.test.ts`,
  `resumePoint.test.ts`, `ticketActions.test.ts`, `ticketSections.test.ts`,
  `projectTableRows.test.ts`, `ticketBrief.test.tsx`, `repositoryPage.test.tsx`,
  `ticketAttempt.test.tsx`, `inboxList.test.ts`, `ticketLabels.test.tsx`,
  `ticketCreationFixture.ts`, `ticketPageFixture.ts`, `ticketLedgerFixture.ts`,
  `ticketPageLedger.test.tsx`. Deleted account-only tests rather than
  weakening them (the BudgetMeter tests, the gas/pricing/refill assertions in
  `codeLabels.test.ts` and `resumePoint.test.ts`, eight account-dependent
  cases in `ticketPageLedger.test.tsx`); trimmed fixtures and comments that
  merely carried pricing fields as noise.
- `test/panel.test.tsx`, `test/inputs.test.tsx` — two generic `Panel`
  component tests used "Budgets"/"Rework" as illustrative example content;
  since that panel no longer exists as a real feature, renamed the examples
  to neutral content (`"Ledger"`/`"Provenance"`) so a reader doesn't mistake
  a generic-component fixture for a still-live panel.

**Repo-root oracle tests** (`test/ui/`, confirmed by B-report as left for me):
- `test/ui/resumePoint.test.ts` — full rewrite. The domain model changed far
  more than the wire/UI diff implied: `Ticket` no longer carries
  `reworkPolicy`/`finalizationPricing`/`resumePricing`/`reworkLeft`/
  `gasLeft`/`finalizationLeft` at all, `Config` lost the same fields, and
  `decideEvalStageReduce` now takes an explicit `onFailure:
  EvaluationFailureDisposition` argument instead of deciding internally from
  a budget. `decideFinalizationResult` on failure always reworks
  (`finalizerFailure`) and never escalates, so finalization has no wall left
  to hold the console's copy against — I deleted the two tests that drove it
  ("the two finalization walls..." and the finalization half of "a program of
  one stage..."), rewrote the evaluation-wall test to drive both dispositions
  explicitly, and rewrote "each point re-enters the phase" to check only
  phase re-entry (no charge/refill — there is none). Also deleted "the rework
  wall of a ticket authored no budget parks for good": a ticket no longer
  authors a rework budget at all, so the premise is gone, not just the
  account.
- `test/ui/ticketActions.test.ts` — `ticketIn()` fixture stripped of the same
  removed `Ticket` fields; deleted "a park with no gas for its resume is
  offered one the actor refuses" per B-report's explicit note (`retryableIn`
  in `src/domain/enablement.ts` no longer checks gas at all — it is now
  `phase === "Escalated" && resumeAt !== "NoResume"`, so the console and the
  model fully agree on resumability and there is nothing left for that test
  to demonstrate). Reworded the header doc's second paragraph, which had
  claimed the console under-offers because it can't see "gas to pay for it".

Invoked `comments-describe-the-code:comments-describe-the-code` before the
final pass; audited every touched diff for provenance/history-bound comments
("used to", "previously", "no longer", "per the brief") — none found.

## Final grep sweep

`grep -rn -i 'gas\|rework\|pricing\|budget\|afford' ui/chuggy-ui` (excluding
gitignored `dist/` and `node_modules/`) still returns ~150 hits. Every one is
either legitimate current vocabulary or an unrelated use of an ordinary
English word:

- **`ReworkBudgetExhausted`** (roster member, still real — rework caps exist,
  just not as a per-ticket account) and **`ResumeReworking`** — kept exactly
  as instructed.
- **`rework` as a verb** — "not the cycle's rework" (`TicketLedger.tsx`),
  "reworks · new artifact" — describes what a resume *does*, unrelated to any
  account.
- **"budget" meaning a retry/attempt/page bound**, not a ticket account:
  `operationFollow.ts`'s attempt budget, `projectExecutionIndex.ts`/
  `projectTicketPages.ts`/`repositoryConfigurations.ts`/`RepositoryConfigurations.tsx`/
  `apiRoutes.ts`/`executionIndex.ts`/`stream.tsx`/`ProjectTable.tsx`/`Inbox.tsx`'s
  page-read budgets, `session.ts`/`sessionHolder.ts`'s token-renewal budget,
  `ticketCreationRun.ts`'s follow budget, `codeLabels.test.ts`/
  `ticketPageLedger.test.tsx`'s "copy budget" (the 60-char §1.1 rule 7 cap).
  All pre-existing, none touched by this effort.
- **`test/conversation.test.ts`**'s `AgentBudgetExhausted` — a distinct,
  still-live roster member on `session_turn.failure` (agent turn budget,
  `src/contract/rosters.ts`), unrelated to ticket gas/rework/pricing.
- **`test/actionWithCost.test.tsx`** uses `"costs 1 gas"`/`"Add rework"` as
  illustrative strings for the generic `ActionWithCost` button primitive,
  which takes an arbitrary `cost`/`action` string and computes nothing about
  gas or rework itself; left as an example fixture for a generic component,
  same as any other placeholder text would be.
- **`what the machine charged for it`** in `ticketPageLedger.test.tsx`'s
  header doc — refers to dollar run cost (`costUsdMicros`/`runTotals`), a
  concept this effort did not touch; left unchanged.

## Gates

`.chug/tasks/check-source.sh`: clean (residue, typecheck, browser typecheck,
lint, format, unit all clean; 208 unit suites run here, 153 left to the
suites `check-source` itself defers to `check-console`/`check-postgres`/etc).

`CHUG_CI_FULL=1 .chug/tasks/ci.sh`: **all gates clean**, full run including
`check-model` (116 model tests), `check-postgres` (75 suites),
`check-queries`, `check-keto` (4 suites), `check-conformance`,
`check-random`, `check-boundaries`, `check-comments`, `check-paths`,
`check-figures`, `check-console-sheets`, `check-console`, `check-roster`,
`check-knowledge`, `check-gates`, `check-duplication`, `check-shell-quoting`,
doc-lint, and every shell-suite. No gate exited 2 (could-not-run); no gate
found anything.

`npm run test` (vitest) inside `ui/chuggy-ui`: 117 files, 1286 tests, all
pass. `npm run lint`: clean.

## Decisions made without asking

- Simplified `ResumeOffer` from four variants to three (dropped `NoGas`), and
  made every offered resume's cost unconditionally `"free"` — gas
  affordability is not a concept anywhere in the model any more.
- Renamed `TicketCreationAdvanced.tsx`'s `Pricing` component to
  `WorkAndFinalizer` since it draws no pricing after the three `ChoiceRow`s
  are removed; kept the identifier honest rather than leaving a stale name.
- Kept `resumePoint.ts`'s `fromStage`/`ofStages` (stage-position facts) —
  they are not gas/rework/pricing/budget facts, just adjacent to the fields
  that were.
- In `test/ui/resumePoint.test.ts`, deleted rather than adapted the two tests
  whose premise (a per-ticket-authored finalization/rework budget) no longer
  exists in the domain at all, rather than trying to preserve some weakened
  form of them; the suite's stated purpose is to hold the console's resume-
  point copy against the model's deciders, and there is no wall left on
  those edges to hold anything against.
- Renamed the illustrative "Budgets"/"Rework" strings in two generic
  `Panel`-component tests (`panel.test.tsx`, `inputs.test.tsx`) to neutral
  content, since the real "Budgets" panel they evoked is now gone and a
  reader could otherwise mistake the fixture for a still-live feature.
- Fixed a stale factual claim in `ui/chuggy-ui/README.md` ("the three
  budgets" panel) that the grep sweep and doc-checking convention both flag
  as a claim the tree must back up.

## Nothing left unsure

Everything above was verified directly against the current worktree state
(domain types, contract rosters, decider signatures) rather than assumed from
the brief's description; the full test suite and full `ci.sh` both pass
clean.
