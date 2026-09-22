# Review round 1, surface half — PR 6b at 71c13aae

CHANGES

## 1. Program runs are grouped by a generation the model counts per stage, so a
stage whose first run falls in a later pass lands in the wrong run

`ui/chuggy-ui/app/core/ticketLedger.ts:204-208,286-297` buckets a cycle's
evaluation rows by `identity.value.generation` and calls one bucket one program
run. `model/ticket.qnt:401-409 stageGeneration` counts *per stage* ("WHICH RUN
OF STAGE s THIS IS", `e.stage == s + 1 and e.evaluator == 1`), so the stages of
one pass share a generation only while every stage ran in every earlier pass.

Input, all reachable: work passes; stage 1 spawns at generation 1 and comes back
`Blocked`; `EvaluationBlockedEscalated` parks (`model/ticket.qnt:185-193` — the
one wall whose resume re-enters evaluation); the resume re-spawns the *lowest*
stage (`model/domain.qnt:580-582`) as stage 1 generation 2, which passes; stage 2
then runs for the first time in the cycle, so `stageGeneration` gives it
generation **1**. Run against this tip, `program: [{fanout:1},{fanout:1}]`:

    run 1 Superseded ["1 Blocked t2","2 Passed t4"]
    run 2 Current    ["1 Passed t3","2 Queued"]

Both rows are false: the superseded run shows stage 2 running after a blocked
stage 1, and the current run shows stage 2 "Queued" when it has passed, which
`cycleLastSet` then turns into a `cycleSummary` saying the cycle stopped at
stage 1 (`complete` is still true). The old heuristic (`runSetsOf`, base
`1e986583`) got this page right — `[[s1 blocked], [s1 passed, s2 passed]]` — so
it is a regression, and no case in `test/ticketLedger.test.ts` has two
generations that disagree (`ticket21Resumed` resumes a one-stage-deep cycle).

Instead: every run begins at the lowest stage — both spawn sites enter at stage
0 — so cut the cycle's evaluation sets in `task` order at each set whose stage is
the lowest, and take that opening set's generation as the run's `ordinal`. That
uses only `task` order, which this module already relies on. Land the case above
as a test.

## 2. `cycleArtifactNote` names the next cycle by counting cycles

`ui/chuggy-ui/app/browser/ticket/TicketLedger.tsx:237`:
`cycleLabel(Math.min(cycle.ordinal + 1, cycles))`. The clamp was sound while
`ordinal` was `index + 1`; it is now `identity.value.cycle`, equal to the count
only on a page whose cycles start at 1. Input: a page without cycle 1 — e.g. a
delete frame for its only row (`ticketExecutions.ts:29-38`) — leaves ordinals
`[2,3]` with `cycles === 2`, and cycle 2 reads "Superseded by cycle 2", naming
itself. Name the next cycle's own ordinal instead. Below 1 in severity: I could
not reach it from a page this machine writes.

## Notes

Clean: no `cycleSetsOf`, `executionTaskSuffix`, `/-\d+$/` or program-run
reconstruction left in `app/`; the only `+ 1` left is finding 2's. Stage labels
are the identity's own number throughout (`stageLabel`, `ungroupedLabel`,
`stageRowLabel` with `stageOrdinalWork = 0`, `walledStageLabel`), and
`stageExpected` indexes `program[stage - 1]`. `runTotals` keys and orders by
`(cycle, kind, stage)`; ledger buckets and the situation card are per cycle.
Sorting and paging stay the wire integer (`cycleBucketsOf` sorts by `task`,
`http.ts` untouched), `responses.ts` keeps `task` beside `identity`, and no raw
task number reaches a label.

Mutations at the tip, all red: `stageLabel` → `stage + 1` (4 tests);
`stageRowLabel` → `stage + 1` (2); `runStageKey` with the cycle dropped (1).
Baseline 1298/1298 green; mutations reverted, worktree removed. Gates all exit
0: `check-console`, `check-console-sheets`, `check-source --static`,
`check-figures`, `check-comments`, `check-paths`.

Not flagged: `runStageLabel`'s "cycle 2 evaluation stage 1" is lowercase prose
against the copy standard, but nothing renders `runStageRows` today and the
voice predates this change. `stageSpendRows` still merges a stage across cycles,
which reads as deliberate for a page-level total and is outside decision 7. Two
work rows in one cycle now merge into one `expected: 1` set rather than opening
two cycles — that follows the identity and matches `spawnWork`.

Practices: none invoked; both findings are correctness, cited against `model/`.
