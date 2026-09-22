# Task C: the console draws a cycle as its stages and their generations

Tip: `4185edb9` on `console/evaluation-instance` (base `0d2e1639`), two commits.

## Files changed
- `ui/chuggy-ui/app/core/ticketLedger.ts` — rewritten: `Cycle.stages` (was
  `programRuns`); `RanStage.evaluators: EvaluatorRow[]`, each holding its own
  `{key, generation, set}` at its highest generation. `ProgramRun`,
  `runsCutOf`, `programRunsOf` deleted.
- `ui/chuggy-ui/app/core/runTotals.ts` — rows keyed `(cycle, stage,
  generation)`; new `generationLabel` ("again" / "generation N").
- `ui/chuggy-ui/app/core/tones.ts` — `stageArm` reads the stage's own verdict.
- `ui/chuggy-ui/app/browser/ticket/TicketSituation.tsx` — `resumedFrom` finds
  the stage with an evaluator past generation 1 and says "Resumed at stage N
  · cycle M" only for it.
- `ui/chuggy-ui/app/browser/ticket/TicketLedger.tsx` — one row per evaluator
  (`EvaluatorLine`), labelled by key only when a stage holds more than one;
  `ProgramRunBlock`/eyebrow-by-run deleted, replaced by a single "Evaluation"
  block per cycle.
- `TicketUsage.tsx`, `codeLabels.ts` — no changes needed; confirmed by grep
  and a clean whole-project `tsc`.
- Fixtures and suites follow: `test/ticketLedgerFixture.ts`,
  `test/ticketLedger.test.ts`, `test/runTotals.test.ts`, `test/tones.test.ts`,
  `test/ticketSpend.test.ts`, `test/ticketPageLedger.test.tsx`. Added: a
  blocked-then-resumed evaluator beside the pass it kept, two cycles sharing
  stage numbers, a sparse stage drawing both evaluators (core fold and
  rendered page).

## What a reader sees differently
A stage with more than one evaluator now draws a row per evaluator (e.g.
"Stage 1 of 1 · 1" / "· 2"), priced and timed independently, instead of one
merged fan-out row. A blocked evaluator's resume redraws only that
evaluator's row, running, noted "again" — the evaluator that already passed
keeps its own earlier row untouched. The old per-run eyebrow ("Evaluation ·
run 2 · after resume") is gone; the block is just "Evaluation". The wall
notice reads "Resumed at stage N · cycle M".

## Gates
- `check-console`: 0
- `check-console-sheets`: 0
- `check-figures`: 0
- `check-comments`: 0
- `check-paths`: 0
- `check-source --static`: 1 — pre-existing on base tip `0d2e1639` (verified
  identical failure list with my changes stashed); all findings are in
  `src/interpreter/`, `test/interpreter/`, `test/postgres/`, none in `ui/`
  — Task B's territory, not this task's.

`npx vitest run` (whole `ui/chuggy-ui`): 117 files, 1305 tests, all passing.
`npx tsc --noEmit`: clean.
