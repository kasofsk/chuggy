# Task F (PR 8c-2) — leftover reds and the ticket read

Branch `model/ticket-update`, tip 5a30137c. Setup: `_setup.md` beside this file (part of this brief) — **except** the branch step: `git fetch origin && git checkout -b model/ticket-update-8c2-f 5a30137c`. Own postgres on 55447 (`docker run -d --name chuggy-check-postgres-8c2-f -e POSTGRES_PASSWORD=chuggy-check -p 55447:5432 postgres:18-alpine`); remove it when done. Another builder (C) is editing `ui/` and `test/ui/` in parallel: do not touch those.

Read: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-2 — decisions" and every 8c-2 progress line, `pr8/tasks/8c-2/{A,S}-report.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

1. `check-paths`: `test/actor/storedBeforeUpdate.test.ts:7` names a path without its extension — make the claim resolve.
2. `check-duplication`: the clones in `016-ticket-update.ts` restating 014/015's constants and validator body. 016 is unlanded; reduce the restatement the way 014/015 share with their predecessors (read how they do it; the note `migrations-render-literals.md` in `_setup.md`'s handoff branch). Render-diff 001–015 must stay empty; the migration suite stays green.
3. Lint `max-lines-per-function` in `test/postgres/migration.test.ts` (around the 016 cases, `updatePopulated`): split into helpers, as 8c-1's B did.
4. **Ticket reads show what was released.** `src/adapters/postgres/nativeReads.ts` reads the title and brief for a ticket from `draft_brief`; read them from the released snapshot (`ticket_definition.brief`) so a reopened Pending ticket's page shows what it will run, not unreleased edits. A test: revise a Pending released draft without releasing; the ticket read is unchanged; release the update; it moves.

Gates on the tip, one at a time: `check-source` (test/rig playwright = environment), `check-paths`, `check-duplication`, `check-postgres`, `check-queries`, `check-boundaries`. Report each exit, the commits, and each fix's test. Under ~25 lines.
