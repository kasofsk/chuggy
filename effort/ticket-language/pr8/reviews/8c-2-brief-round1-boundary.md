# Review round 1, boundary half — PR 8c-2 "Update" (tip a26bf034, branch `model/ticket-update`)

Setup: `_review-setup-8c-2.md` beside this file (part of this brief). Own postgres: `docker run -d --name chuggy-check-postgres-8c2-r -e POSTGRES_PASSWORD=chuggy-check -p 55448:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55448; remove it when done. Your half: `src/interpreter`, `src/adapters` (incl. `016-ticket-update.ts`), `src/contract`, `src/roots`, `ui/chuggy-ui`, `test/{contract,interpreter,postgres,adapters,roots,ui}`. Diff: `git diff b6e5b4fb..a26bf034 -- <your paths>`.

Read first: `pr8/GOAL.md` §"PR 8c-2 — decisions" and every 8c-2 progress line (decision 11 and the ticket-read decision are there), `pr8/tasks/8c-2/{A,S,C}-report.md` (B's and F's are summarized in the progress lines), the notes `stored-text-outside-the-journal`, `migrations-render-literals`, `guards-fail-open` (see setup), `.chug/tasks/review-change.md`, `CLAUDE.md`.

Check, each with a failure that actually happens:
1. **What a ticket runs is what was released.** Revise a Pending ticket's draft without releasing: nothing on the dispatch, retry, finalization or briefing path moves (grep every `draft_brief` reader and every `ticket_definition` reader); release the update: all of them move, in the same transaction as the journal row. The snapshot's digest check on read — what happens on mismatch (wedge?).
2. **The update path.** Fence (`update_draft_fenced`) vs the first release's; a concurrent dispatch and update (either order); an update that re-pins the configuration — does the next dispatch run the new pin, and does an in-flight proposal get `TicketChanged`? `ticket_projection.revision` always equals the model's.
3. **The draft door.** `revise_draft` reopening only while Pending; `DependenciesLocked` compares as a set against the released version's; a draft revised twice then released; a revision that races the dispatch.
4. **016 over a populated database** (no wipe): reproduce S's populated-upgrade test's claim on a database at 015 with rows; grants (API sees `ticket_definition.brief` only); render-diff 001–015 empty; four red-proofs re-proven.
5. **Wire and console.** `UpdateTicket` mutation, `revision`, `releasedAuthoringVersion`, `DependenciesLocked` 409; the edit flow's two-step (revise then update) — what the reader sees if step 2 is refused or fails, and whether a retry double-revises; the console's brief panel still reads the draft (C's note) — does the ticket page contradict what the ticket runs?
6. Run `check-source` (test/rig playwright = baseline), `check-boundaries`, `check-queries`, `check-postgres`, `check-conformance`, `check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-duplication` at the tip, one at a time.

Verdict: APPROVE or CHANGES; findings with file:line, input, what goes wrong; under ~70 lines.
