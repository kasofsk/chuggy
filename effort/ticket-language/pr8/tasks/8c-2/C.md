# Task C (PR 8c-2) — the ticket page edits a pending ticket

Branch `model/ticket-update`, tip `5a30137c` (B's). Setup: `_setup.md` beside this file (part of this brief) — **except** the branch step: `git fetch origin && git checkout -b model/ticket-update-8c2-c origin/model/ticket-update`, confirm the tip.

Read: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-2 — decisions" (7 is yours) and every 8c-2 progress line, `pr8/tasks/8c-2/B-report.md` (the wire and the `ui/` sites), `pr8/tasks/8c-1/C-report.md` (the refusal sentences), `ui/chuggy-ui/app/browser/{TicketPage,TicketActions,TicketCreation,TicketCreationAdvanced,TicketProvenance}.tsx`, `ui/chuggy-ui/app/core/{ticketOffers,ticketActions,ticketCreationRun}.ts`, `CLAUDE.md`, `.chug/tasks/review-change.md`, and any console copy practice the roster names.

## Scope

`ui/chuggy-ui/` and `test/ui/`.

- An Edit offer on the ticket page while the ticket is `Pending`, opening the creation form in an edit mode prefilled from the draft's current revision, dependencies shown and not editable; submitting revises the draft and sends `UpdateTicket` with the ticket's `revision` as `expectedRevision`, then follows the operation as a release is followed. `DependenciesLocked` and the update's refusals answered in the voice 8c-1 set.
- `TicketProvenance.tsx` names the live revision and the draft authoring version it came from, and says when the draft holds unreleased changes.
- Tests for the offer's presence (Pending only), the prefill, the locked dependencies, the submit sequence, and the provenance states; follow the sheet and copy rules `check-console-sheets` holds.
- Nothing outside `ui/` and `test/ui/`; if the wire lacks what the page needs, stop and say so.

## Gates on the tip

`check-source`, `check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Report each exit.

## Report

Tip; what the edit flow does step by step; the provenance states as rendered; files; gates. Under ~40 lines.
