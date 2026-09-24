# Task F (PR 8c-1) — round 1 fixes

Branch `model/ticket-commands`, tip 4afc1244. Setup: `_setup.md` beside this file (part of this brief) — **except** the branch step: `git fetch origin && git checkout -b model/ticket-commands-8c-f origin/model/ticket-commands` and confirm the tip is 4afc1244. Own postgres: `docker run -d --name chuggy-check-postgres-8c-f -e POSTGRES_PASSWORD=chuggy-check -p 55443:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55443; remove it when done.

Read: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-1 — decisions" and every 8c-1 progress line (the two decisions on round 1 are there), `pr8/reviews/8c-1-round1-machine.md`, `pr8/reviews/8c-1-round1-boundary.md`, `pr8/tasks/8c-1/{A,S,B,C}-report.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

Fix, each red-proved (the test fails with the fix reverted; name the mutation in the report), in small commits in the tree's voice:

1. **Release room (machine 1).** The writer refuses a release outside the room — fleet at `nTickets`, or an id outside `ticketIdUniverse` — before `decide`, with the new boundary code `TicketCapacityReached`, no payload. The check reuses the domain's definition (`canReleaseIn` or whatever now holds the room; do not restate the expression). Add the code to `BoundaryRefusalCode`/`allRefusalCodes`, `operationRefusalCodes`, 015's code CHECK (015 is unlanded — edit it in place), and the console (label and sentence in the voice C used). Fix the false comments at `src/domain/enablement.ts:6-8` and `model/domain.qnt:451` (model comment only — no model semantics change). `test/actor/journal.test.ts:253` pins what the actor accepts; keep it if the actor is right to accept (the room is the writer's), and say so in the test name. A writer test: the release past the room is refused `TicketCapacityReached` and journals nothing.
2. **Replay legality (machine 2).** `storedJournalLegalOn` refuses a row whose report's `ticket` differs from the event's, for the five report-bearing arms, beside `eventTicketStands`, reusing `reportTicket`/`eventTicket`.
3. **Finalization pins (boundary 1).** Assert `workCycle`/`generation` on the materialized finalization request at first mint (1,1) and after a finalization resume (1,2), in `dispatchWriter` or `i3`; one postgres case reading the minted row's `work_cycle`/`finalization_generation` back.
4. **Closed finalization request (boundary 2).** When `decide` accepts but the request is closed (superseded epoch, Invalidated), refuse with the new boundary code `FinalizationRequestClosed`, no payload, through every layer as in 1; `FinalizationNotCurrent` only when `decide` returned it. A test for each branch.
5. **Wire (boundary note).** `TicketRevisionStale`'s `expected`/`current` positive on the wire, matching the database.
6. **Comment (boundary 3).** `src/interpreter/commandMap.ts:5-10`: narrow to envelopes that name rows; the public revoke/resume are built by the actor's constructors in `http/contract.ts`.

Gates on the tip: `check-source` (test/rig playwright = environment), `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-random`, `check-model` only if a `.qnt` changed (comment-only still runs `check-model`'s typecheck; say which), `check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. One at a time; report each exit.

Report: tip and commits; per item what changed, the test and its red-proof mutation; gates. Under ~40 lines.
