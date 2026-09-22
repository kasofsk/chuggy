# Task D (PR 7b) — round 1 surface fixes, report

Tip: `0b037997` on `model/evaluation-instance` (worktree `~/claude/chuggy-wt/evinst`), five commits above `64a95abe`.

## Findings

1. **Every generation is a row.** `ticketLedger.ts`'s `stageAggregatesOf` kept
   only the highest generation per evaluator; `evaluatorRowsOf` now keeps
   every generation, current first, the rest marked `Superseded`.
   `EvaluatorRow.standing` carries it; `verdict`/`expected` still read off the
   current generation only via new `stageEvaluatorsCurrent`. `TicketLedger.tsx`
   draws a superseded row dimmed (`LedgerRow`'s new `superseded` prop,
   `.ledger-row-superseded` in `Ledger.css`). Case: `ticketLedger.test.ts`'s
   "beside the pass it kept" test now pins all 3 rows (current, superseded,
   the other evaluator) and that their spend sums to the cycle's own rollup;
   reverting `stageAggregatesOf` to the old highest-only fold reddens it.
   `ticketPageLedger.test.tsx` pins the DOM class and the "Superseded" note.

2. **`resumedFrom` names the stage resumed now.** `TicketSituation.tsx`'s
   `resumedStage` took the first `Ran` stage past generation 1; it now takes
   the highest-numbered such stage whose verdict is `Running`, falling back to
   the highest-numbered one at all. Case (`ticketSituation.test.tsx`): a
   two-stage cycle, stage 1 resumed+settled and stage 2 resumed+running,
   reads "Resumed at stage 2 · cycle 1" — reddens under both `.find` and
   `row.kind === "Ran"` (verified by hand-reverting each and re-running); a
   second case pins no resume line on a ticket never resumed.

3. **`codeLabels.ts` "Evaluation blocked".** `escalationDetailLine`'s
   `EvaluationBlockedEscalated` arm said "Evaluation cancelled"; it now says
   "Resume asks it again". Case: `codeLabels.test.ts` split the old combined
   test so the evaluation-blocked arm is pinned on its own.

4. **A block parks the plan.** `stageStopped` no longer counts `Blocked` as a
   stop, so the stages after a blocked one draw `Queued`; `Failed`/`Cancelled`
   still draw `Skipped`. Case: `ticketLedger.test.ts:263` (moved, renamed)
   pins `Queued`; hand-reverting `stageStopped` to include `Blocked` reddens
   it.

5. **One spelling.** `generationLabel` always spells `generation N`, dropping
   "again"; `standingTone` deleted from `tones.ts` with its assertions in
   `tones.test.ts` (no caller left — `Pill`'s tone in `Ledger.tsx` was already
   inline); `ticketLedgerFixture.ts`'s header now describes the resume as
   what it is rather than the old run-layer language.

## Gates (tip)

`check-console` 0 · `check-console-sheets` 0 · `check-figures` 0 ·
`check-comments` 0 · `check-paths` 0 · `check-source --static` 0 ·
`check-duplication` 0. `npx tsc --noEmit` clean; `npx vitest run` 1308/1308.
