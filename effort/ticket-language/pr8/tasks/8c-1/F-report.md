# F report (8c-1 round 1 fixes) — filed by the orchestrator from the builder's hand-back

Tip 07abd55b (off 4afc1244; pushed by the orchestrator): cefeed63 release room, a838b744 replay report ticket, 8a3a091e finalization pins, 3bdd07a7 closed request boundary code, 6db3b07e stale revision positive on wire, 07abd55b commandMap comment. Hook clean; two type-error fixups autosquashed.

1. `projectWriterDecision` refuses `TicketCapacityReached` before decide when the id is not held and `!canReleaseIn(...)` (a held id stays decide's TicketAlreadyExists). Code through BoundaryRefusalCode, operationBoundaryRefusalCodes, 015 CHECK (in place), migration.test, rosters, console ("Ticket capacity reached"). Comments enablement.ts:6-8, domain.qnt:451 fixed. journal.test case renamed "the actor takes a release outside the id universe, because the release room is the writer's to refuse". Test dispatchWriter "a release outside the room is refused TicketCapacityReached and journals nothing"; red with `false && !canReleaseIn` and without the `tickets.has` conjunct.
2. `eventReportTicketAgrees` in src/actor/journal.ts, in storedJournalLegalOn. Test journal.test over five arms; red without the conjunct.
3. i3 first mint (1,1), rework pass (2,1); dispatchWriter finalization resume (1,2); postgres finalizerQueue reads work_cycle/finalization_generation for 0 and 1 reworks. Red: generation:1, workCycle:2, workCycle:1 (rework case only), decision.ts generation→work_cycle.
4. `projectWriterClosedRefusal`: decide's refusal else FinalizationRequestClosed (result) / TicketChanged (answer); through every layer ("Finalization request closed"). Tests dispatchWriter both branches; postgres "request has moved" expects FinalizationRequestClosed, null refusal. Red: ternary → TicketChanged; TicketRefused early return removed.
5. TicketRevisionStale expected/current ticketNumberSchema; responses.test; red with countSchema.
6. commandMap.ts header narrowed (comment only).
Gates at 07abd55b: check-source 1 (test/rig baseline), boundaries 0, queries 0, postgres 0 (78), conformance 0 (14/343), random 0, model 0 (124), console 0, console-sheets 0, figures 0, comments 0, paths 0, duplication 0.
