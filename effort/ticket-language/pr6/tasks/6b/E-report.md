# Task E (PR 6b) report

Tip: `0e80a7df` on `model/task-identity` (worktree `~/claude/chuggy-wt/identity`), two commits above `71c13aae`.

## Finding 1 — `ui/chuggy-ui/app/core/ticketLedger.ts`
A cycle's evaluation rows are now gathered as sets keyed `(stage, generation)` in task order (`EvaluationSet`, insertion-ordered map), and `runsCutOf` cuts them into runs at each set whose stage is the lowest the cycle holds — the stage both spawn sites enter at — with the opening set's generation as the run's `ordinal`. The first set opens a run whatever its stage, so a page beginning above the lowest stage is still total. `taskSetMapOf` takes a run's sets and merges any two of one stage. The module header states the cut and why the generation cannot group a run; `0ca4db83` carries the why.

Test (`test/ticketLedger.test.ts`): the reviewer's page — work passed, stage 1 gen 1 Blocked, stage 1 gen 2 Passed, stage 2 gen 1 Passed — pins runs `[1 Superseded, 2 Current]`, run 1 `["1 Blocked 2", "2 Skipped"]`, run 2 `["1 Passed 3", "2 Passed 4"]`, `cycleLastSet` at stage 2 Passed, `complete` true.

## Finding 2 — `ui/chuggy-ui/app/browser/ticket/TicketLedger.tsx`
`cycleArtifactNote` takes `supersededBy: number | undefined` instead of the cycle count; `TicketCycles` passes the next cycle on the page (`cycles[index - 1]?.ordinal` over the reversed list), and a cycle with none after it reads "Superseded". Test (`test/ticketPageLedger.test.tsx`): a page of cycles 2 and 3 draws "Superseded by cycle 3" on cycle 2.

## Red-proof
- Grouping on generation again (`runsCutOf` bucketing by `set.generation`): the new case fails with run 1 as `["1 Blocked 2", "2 Passed 4"]` — the defect the review described.
- Restoring `Math.min(cycle.ordinal + 1, cycles)`: the new page case fails with "Superseded by cycle 2".

Both mutations reverted. `npx tsc --noEmit` clean; `npx vitest run` 1300/1300 (1298 plus the two above).

## Gates (tip)
`check-console` 0 · `check-console-sheets` 0 · `check-figures` 0 · `check-comments` 0 · `check-paths` 0 · `check-source --static` 0.

## Note
Brief names `Claude Fable 5.1` for attribution; used this session's own reminder (`Claude Opus 5 (1M context)`), as task C did.
