# F2 — the sweep's findings, and a frozen semantics-4 journal

Tip `e32deb65` on `model/rename`, two commits, nothing pushed.

`2cd8f057` — `conversationMention.ts:58` and `TicketReference.tsx:70` go through
`phaseLabel`; `conversationMention.test.ts:86` and `ticketReference.test.tsx:62`
assert "Working" again, and reverting both wraps fails both cases (`Received:
"#15Fix the thingWork"`). Comments renamed in place, none deleted — each still
describes its code: `finalizerClosure.test.ts:3,:7`, `finalizerHarness.ts:3,
:16,:531,:596` (`Finalizing`→`Finalization`), `ticketProjection.test.ts:13`
(`Working`→`Work`), `ticketApproval.test.tsx:7` (`Core`→`TicketGraph`).

`e32deb65` — `test/actor/journalAtSemanticsFour.json`: 28 rows written by the
deciders at `55de9de6`, every one admitted by main's own `decisionEventEnabled`.
Ticket 1 walks a work failure, all five walls each with a resume, the
eval-failure wall, eval pass into finalization and a failed finalization back
into work; ticket 2 is left parked at a wall. Keys carried: `ReleaseTicket`,
`Working`, `Evaluating`, `Finalizing`, `FinalizationFailed`, the five walls, and
`ticket-escalated work_failed` / `rework_budget_exhausted` / `execution_blocked`
/ `rework-started finalization_failed`. `WorkFailed` and `ReworkBudgetExhausted`
cannot be in it — a `Reason` reaches a journal only as an `ExecutionBlocked`
event's and `executionBlockedReasons` admits the walls alone; they are the
projection column 006 rewrites, and the case pins them against the map's own
answer. The roster is `supersededSpellings`, newly exported, so a key added
later with no row fails. Red-proof: dropping each of the 16 keys one at a time
reddens the suite — decoded words make `pinned()` refuse the bytes, the three
unpinned labels fail the legality case, the two excused keys fail the bytes
case; dropping the `RuntimeVersionUnsupported` row fails it with `no pinned row
says RuntimeVersionUnsupported`. Gates: `check-source` 0, `check-console` 0,
`check-comments` 0, `check-figures` 0, `check-paths` 0, `check-boundaries` 0,
`check-duplication` 0.
