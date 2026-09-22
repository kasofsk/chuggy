# Review round 1, surface half — PR 7b at 64a95abe

CHANGES

The collapse itself is right. Built through `ticketLedger`, the 6b reviewer's
page reads `["1 Passed k1 g2 t3", "2 Passed k1 g1 t4"]`; two resumes of one
stage read `["1 Running k1 g3 t4", "2 Queued"]`; two cycles sharing stage
numbers keep their stages and their totals apart. No `ProgramRun`, `runsCutOf`
or `programRunsOf` in `ui` or `test/ui`; no status enum in copy; no "run" in
the program-run sense. Gates at the tip: `check-console`, `check-console-sheets`,
`check-source --static`, `check-figures`, `check-comments`, `check-paths` all 0.
`npx vitest run` 1305/1305.

## 1. A superseded generation leaves the ledger but stays in every sum beside it

`ui/chuggy-ui/app/core/ticketLedger.ts:252-285` keeps one row per evaluator at
its highest generation; `:365-372` still spans and spends over *every* row the
cycle holds. Input, the ordinary page after one resume — work $1.00 passed,
stage 1 gen 1 $0.50 Blocked, stage 1 gen 2 $0.70 Passed: the ledger draws two
rows worth $1.70, the cycle rollup reads $2.20, the page head reads "3 runs"
over 2 rows, and `complete` is `true`, so nothing says the rows are short of
their own rollup. The blocked attempt is gone from the one surface a reader
reconciles spend on; its only trace is the word "again". 6b drew it, as run 1,
Superseded. Draw the superseded generation as its own dimmed row, or say on the
cycle what its rows do not account for.

## 2. `resumedStage` names the first stage ever resumed, not the one resumed now

`ui/chuggy-ui/app/browser/ticket/TicketSituation.tsx:44-52` takes the *first*
`Ran` stage holding any generation past 1. A cycle can hold two: stage 1 blocks,
resume, stage 1 gen 2 passes, stage 2 runs and blocks, resume, stage 2 gen 2
runs. Rendered, that page's notice reads "Resumed at stage 1 · cycle 1" while
the ledger beside it draws stage 1 settled and stage 2 running. Take the last
such stage instead.

Nothing pins this: replacing the whole predicate with `row.kind === "Ran"` —
the lowest stage that ran, resumed or not — leaves 1305/1305 green, because the
only page-level case resumes stage 1 and every other case reaches the escalation
arm. Wanted: a case for a stage above 1, and one for a ticket never resumed.

## 3. "Evaluation cancelled" is no longer true of an evaluation block

`ui/chuggy-ui/app/core/codeLabels.ts:196,211`. This branch deleted the
draining-siblings arrangement (`src/interpreter/executionScheduler.ts:86-90`):
a block now retires one execution and says nothing about its siblings, and the
resume keeps every pass. So the only line under "Evaluation blocked" tells the
reader the phase was interrupted and its work thrown away, when neither
happened. `codeLabels.ts` was not touched by this change.

## 4. A blocked stage dims the stages after it as short-circuited

`ui/chuggy-ui/app/core/ticketLedger.ts:287-292` counts `Blocked` as a stop, so
the parked page (stage 1 Blocked, its evaluators all terminal) draws "Stage 2
of 2 Skipped" in the retired tone; after the resume the same row reads
"Queued". In 6b that word belonged to a superseded run that truly never reached
stage 2; with the run layer gone it is a claim about this cycle's remaining
plan, and a blocked stage parks the plan rather than ending it.
`ticketLedger.test.ts:251` pins the old reading.

## Notes, not blocking

- `runTotals.ts:267-270` spells one axis two ways — "again" at generation 2,
  "generation 3" above it, both reachable on one page — and "generation" is the
  model's word, not the product's.
- `tones.ts:110 standingTone` lost its last caller with `ProgramRunBlock`; only
  `tones.test.ts` keeps it alive.
- `ticketLedgerFixture.ts:6` still says the fixture holds "a resume that re-ran
  the program from its lowest stage", the rule this branch removed.
- Other mutations asked for: merging an evaluator's generations reddens 6,
  keeping the lowest generation reddens 6, dropping the cycle from the totals
  key reddens "two cycles sharing a stage number keep their totals apart",
  dropping the generation reddens "two generations of one stage keep their
  totals apart".
