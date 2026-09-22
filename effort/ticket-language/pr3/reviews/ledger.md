| round | scope | reviewer verdict | findings | fixed by |
|---|---|---|---|---|
| 1 | surface (interpreter, adapters, contract, console) at 64e5abb5 | CHANGES | (1) wall labels and `escalationDetail` untested; (2) four comments naming old phases, one PR-bound clause in codeLabels.ts | fix task F1 |
| 1 | machine (model, actor, 006, goldens) at 64e5abb5 | APPROVE | none; notes: ExecutionTaskKind now overlaps Phase; 006 CHECK vs old writer at release (zero active tickets before merge); schedulerStore end-to-end wall read | — |
| 1 fix | F1 at a704946c | — | both findings fixed (wall labels + escalationDetail tests, five comments) | — |
| ci | full roster at a704946c | 2 shell suites red (conformance suite golden name; random suite mutant `core` and seed 0x3) | fixed by the orchestrator in the next commit; gates themselves green; sweep to re-check | — |
| 2 | mutation sweep at a704946c (63 mutations, 52 red) | CHANGES | (1) raw `ticket.phase` drawn in conversationMention.ts and TicketReference.tsx; (2) four comments naming old constructors in touched files; (3) four in finalizerHarness.ts; unpinned: six vocabulary keys redden nothing (frozen fixtures lack them) | fix task F2 (+ frozen semantics-4 fixture) |
| 2 fix | F2 at e32deb65 | — | console phaseLabel wraps, eight comments, frozen semantics-4 journal (14 of 16 keys in bytes; WorkFailed/ReworkBudgetExhausted pinned via the map since no row carries a Reason but a wall) | — |
| 3 | F2 diff at e32deb65 | APPROVE | none; note taken: Inbox.tsx raw phase wrapped (orchestrator commit) | — |
