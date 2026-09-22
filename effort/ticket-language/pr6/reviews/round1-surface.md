# Round 1, surface half — PR 6a, tip 5c46f391

CHANGES

## Findings

1. **`ui/chuggy-ui/test/ticketPageLedger.test.tsx:814-825`** — the case named "a
   row that is superseded, relaunched and short still fits the copy budget" no
   longer creates that row, and after this change nothing can. On `drawFanout()`
   the superseded group draws two rows; I read them off the container:
   `"WorkMissingNot on this page"` and `"Stage 1 of 1…Relaunched 3× by fabric 2
   of 3 tasks on this page…"`. A standing fragment is passed only by
   `CycleGroup` to the work row (`app/browser/ticket/TicketLedger.tsx:309-314`);
   `StageLine:187` passes none, so the short row carries two fragments, not the
   three the docstring names. And a work row can never be short again:
   `taskSetOf` sets a work set's `expected` to `1` (`app/core/ticketLedger.ts:
   218`) and a set is built from at least one execution, so `setShortfall`
   (`TicketLedger.tsx:91-95`) is always `undefined` there. A name and docstring
   asserting an unreachable state read as cover that is not there. Restate the
   case for what it now proves, or drop it if `drawnStringsOver` elsewhere
   already covers the budget.

2. **`ui/chuggy-ui/app/core/ticketCreation.ts:542`** — `creationFanoutLabel` is
   still exported and this change deleted its only external caller
   (`TicketCreationAdvanced.tsx`'s `render={creationFanoutLabel}`). Tree-wide
   grep leaves one call, at `:539` in the same module. Make it module-private,
   or fold it into `creationStageLabel`, which is all it does now.

3. **`ui/chuggy-ui/test/ticketPageLedger.test.tsx:734-735`** — the rewritten
   fixture docstring says "two of its tasks on the page, one of them
   relaunched". Both are: `retriesSpent` is 1 and 2 at `:745,756`, which is why
   the row reads "Relaunched 3×". The base comment was wrong the same way; this
   diff restates it, so it is this change's to get right.

## Notes — checked, not flagged

- **Nothing else offers a work width.** The six remaining `fanout` hits under
  `ui/chuggy-ui/app` and `test/ui` are all evaluation: `stage.fanout`,
  `creationStageLabel`, four prose uses true of an evaluation set. No
  `workFanout` anywhere under `ui/` or `src/contract/`.
- **The ledger.** Rendered `ticket21Parked`: three cycle groups, each "Work …
  Current artifact / Superseded by cycle N" then "Stage 1 of 2", "Stage 2 of 2".
  No count, width column or "N tasks" on a work row; evaluation fan-out still
  draws its width, priced and timed over the set.
- **Creation form.** `authoringSchema`/`draftCreationSchema` are `strictObject`,
  so a body naming `workFanout` is refused (proved below). `choices` is a plain
  `z.object`, so an older server still sending `workFanouts` is stripped, not
  refused; the fixtures without it render. `CreationAuthoring = defaults`, so
  the form type lost the field by type. Copy: nothing new is user-visible.
- **Red-proofs.** `workFanout: 1` back into `creationBodyFrom` → 37 red across
  two files. `expected` `1`→`2` in `taskSetOf` → 4 red. `Stage`→`Step` in
  `stageLabel` → 5 red. Two label sites do not redden and were uncovered at the
  base too, so not flagged: `label="Work"` (`TicketLedger.tsx:303,311`) and
  every `Field name` in `TicketProvenance.tsx`'s `Authoring` panel — mutating
  either leaves all 1299 console cases green.
- **Gates at the tip, all 0:** `check-console` (5 scripts), `check-console-
  sheets` (31), `check-source` (6 stages, 207 suites), `check-figures` (102),
  `check-comments` (908), `check-paths` (1214 claims).
- `src/contract/http.ts`'s `candidateOwnMembers` losing a member narrows
  `leadObservedCandidateCharsMax`; that is the machine half's, not judged here.
- Practice invoked: `comments-describe-the-code` (findings 1 and 3).
