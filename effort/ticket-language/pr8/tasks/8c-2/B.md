# Task B (PR 8c-2) — the boundary updates a pending ticket from its reopened draft

Branch `model/ticket-update`, tip `ae1da0d9` (A merged with S). Setup: `_setup.md` beside this file (part of this brief) — **except** the branch step: `git fetch origin && git checkout -b model/ticket-update-8c2-b origin/model/ticket-update`, confirm the tip is `ae1da0d9`. Own postgres: `docker run -d --name chuggy-check-postgres-8c2-b -e POSTGRES_PASSWORD=chuggy-check -p 55446:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55446; remove it when done.

Read: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-2 — decisions" and every 8c-2 progress line (**decision 11** is in the progress lines), `pr8/tasks/8c-2/{A,S}-report.md`, `pr8/tasks/8c-1/{B,F}-report.md` (this layer's shape), `pr8/tasks/8a/B.md` (how the release resolves and stores `ticket_definition`), `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`src/interpreter/`, `src/adapters/`, `src/contract/`, `test/contract/`, and their tests; 016 (unlanded, S's) only where an alignment needs it.

- **The envelope and the map (decision 4).** A `ProjectCommand` arm for S's `UpdateTicket` envelope; `ticketCommandOf` resolves it through the same release path the first release uses, to `UpdateTicket { ticket, expectedRevision, definition }`; the writer fences it with `update_draft_fenced`, decides, and on `TicketUpdated` upserts `ticket_definition` and writes `ticket_projection.revision` in the same transaction.
- **What a ticket runs is what was released (decision 11).** Each release snapshots the brief material the briefing composes from into the released material; dispatch, the briefing, retries and the finalizer read only the snapshot, never `draft_brief`. Restate `authoring.test.ts`'s "a released ticket's brief no longer moves…" to: an unreleased revision of a pending ticket's draft moves nothing a dispatch or retry reads; add the case where a released update does move it. Grep every reader of `draft_brief` and say which remain and why each is not on the dispatch path.
- **The draft door (decision 5).** `revise_draft`'s `DependenciesLocked` and the reopened `Released` state through the TypeScript result types, the HTTP answer, and the draft read (the released authoring version beside the current one).
- **The wire (decision 6).** The public `UpdateTicket` mutation; `ticketResponseSchema` carries `revision`; the draft read carries `releasedAuthoringVersion`; the contract document and `representations.ts` regenerated.
- Tests: update then dispatch runs the updated definition end to end (`i3`/`ticketServiceRun`); each of the four refusals and the three boundary codes answered on the wire; `DependenciesLocked` from the draft door; a stale update after another update refused `TicketRevisionStale` with both numbers.

NOT yours: `model/`, `src/domain/`, `src/actor/`, `src/generated/`, `ui/` (list `ui/` sites for C by file:line).

## Gates on the tip

`check-source`, `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-random`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`, and the shell suites of any gate you touch. One at a time; report each exit.

## Report

Tip; per layer what changed; the wire additions quoted; the snapshot's shape and every remaining `draft_brief` reader; `ui/` sites for C; gates; anything GOAL.md or the A/S reports got wrong. Under ~50 lines.
