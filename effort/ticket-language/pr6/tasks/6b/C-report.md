# Task C (PR 6b) report

Tip: `56167f02` on `model/task-identity` (worktree `~/claude/chuggy-wt/identity`), four commits above `1fb1bc26`.

## Files changed
- `ui/chuggy-ui/app/core/ticketLedger.ts` — full rewrite: cycles/stages/generations read off `identity` (`WorkTask.value.cycle` / `EvaluationTask.value.{workCycle,stage,generation}`), not counted, inferred from stage regression, or parsed from an execution-id stem. Deleted `cycleSetsOf`, `SpawnedSet`/`CycleSets`, the `/-\d+$/` stem regex, `executionRequest`/`executionSetKey`. `stageLabel` drops its `+1` (the wire's stage is 1-based).
- `ui/chuggy-ui/app/core/runTotals.ts` — `RunStageRow` gains `cycle`; `runStageKey`/`runStageBefore`/`runStageLabel` key and order by `(cycle, stage)` so two cycles' same-numbered stage no longer merge. `identityCycle` exported here; `ticketLedger.ts` imports it rather than redefining it.
- `ui/chuggy-ui/app/browser/ticket/TicketLedger.tsx`, `TicketUsage.tsx` — stage labels read `identity.value.stage` directly, no `+1`.
- `TicketSituation.tsx`, `app/core/codeLabels.ts` — unaffected; their types flow from the above unchanged.
- Fixtures: `test/ticketLedgerFixture.ts` (`ExecutionShape.identity` replaces `taskKind`/`stage`/`request`, adds `workIdentity`/`evalIdentity` helpers), `test/ticketLedger.test.ts` (rewritten, two obsolete-mechanism cases removed), `test/ticketPageLedger.test.tsx`, `test/ticketSpend.test.ts`, `test/runTotals.test.ts` (added the two-cycles-share-a-stage case), `test/ticketExecutions.test.ts`, plus `identity` added to raw wire-JSON fixtures in `labels.test.ts`, `projectExecutionIndex.test.ts`, `projectTableRows.test.ts`, `projectTableLabels.test.tsx`, `runEvidence.test.tsx`, `ticketLabels.test.tsx`; `codeLabels.test.ts`'s `ClosedSet` literal pinned `stage: 0` → `stage: 1`.

## What a reader sees differently
Stage numbers, cycle numbers and "program run" grouping now come straight off the wire's `identity` rather than being counted or inferred; displayed numbers are unchanged (still "Stage 1 of 2", "Cycle 3") since the wire is already 1-based. A stage-spend total for cycle 2's stage 1 no longer merges into cycle 1's stage 1's figures — `runStageLabel` now reads e.g. "cycle 2 evaluation stage 1".

## Gates (worktree tip)
- `check-console` — 0 (one format finding, fixed with prettier, then clean)
- `check-console-sheets` — 0
- `check-figures` — 0
- `check-comments` — 0
- `check-paths` — 0
- `check-source --static` — 0

`npx tsc --noEmit` and `npx vitest run` (1298/1298) both clean.

## Note
Brief names `Claude Fable 5.1` for commit attribution; per this effort's established precedent (PR6a's task C), used `Claude Sonnet 5` — the session's own attribution reminder — instead.
