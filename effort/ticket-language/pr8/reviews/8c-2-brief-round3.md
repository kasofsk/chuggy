# Review round 3 — PR 8c-2 "Update" (tip b4869932, branch `model/ticket-update`)

Setup: `_review-setup-8c-2.md` beside this file (part of this brief). Own postgres on 55451 if needed; remove it after. Ledger: `8c-2-ledger.md`. Diff under review: `git diff a173815d..b4869932` (fa1cdfed, b4869932).

Check, each with a failure that actually happens:
1. Round 2's finding is closed: point the ledger's program back at the draft's (one mutation, reverted) and confirm the new ticketPageLedger case goes red.
2. `readTicketRow`'s join at `released_authoring_version`: is that column moved only by a journaled release/update, in the same transaction? Could the read return a program the ticket doesn't run (e.g. a released draft with a null released version, a ticket released before 016's backfill)? Is the API's table-level SELECT on draft/draft_revision pre-existing (not widened here)?
3. The ledger with no program (ungrouped), and anywhere else on the page still reading draft content as what runs (the builder left provenance "dependencies", locked by `DependenciesLocked`).
4. Gates at the tip, one at a time: check-source (test/rig playwright = baseline), check-postgres, check-queries, check-console, check-console-sheets, check-paths, check-comments, check-duplication.

Verdict: APPROVE or CHANGES; findings with file:line, input, what goes wrong; under ~30 lines.
