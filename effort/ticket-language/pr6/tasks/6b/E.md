# Task E (PR 6b) — program runs are cut at the lowest stage, not grouped by generation

Round 1 surface review (`pr6/reviews/6b-round1-surface.md`) found a behaviour defect in C's console work. Fix both findings on `model/task-identity` in `~/claude/chuggy-wt/identity` (tip 71c13aae or later; `node_modules` symlinked; never `npm ci` under `ui/`; `cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work). Read the review first, then `model/ticket.qnt` around `stageGeneration` (generations are counted per stage, so the stages of one pass share a generation only when every stage ran in every earlier pass), `pr6/tasks/6b/C-report.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`.

## Finding 1 (blocking)

`ui/chuggy-ui/app/core/ticketLedger.ts` groups a cycle's evaluation sets into program runs by `identity.value.generation`. Every run begins at the lowest stage (both spawn sites enter at stage 0 → wire stage 1), so: order the cycle's evaluation sets by the wire task integer, cut a new run at each set whose stage is the lowest in the cycle, and take the opening set's generation as the run ordinal. Add the reviewer's page as a test (stage 1 Blocked → resume → stage 1 gen 2 Passed → stage 2 gen 1 Passed) and pin: run 1 superseded `["1 Blocked"]`, run 2 current `["1 Passed", "2 Passed"]`, the cycle summary complete at stage 2. Red-proof it by grouping on generation again.

## Finding 2

`ui/chuggy-ui/app/browser/ticket/TicketLedger.tsx:237` clamps `cycle.ordinal + 1` to the cycle count; `ordinal` is now the identity's cycle number, so on a page not opening at cycle 1 the label names the cycle itself. Name the superseding cycle from the data (the next cycle's ordinal on the page) or drop the number; one test.

## Gates on the tip

`check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`. Report each exit.

## Commits

On `model/task-identity`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/E-report.md`: tip, what changed, the red-proof, gates. Under ~25 lines. Write the report, reply with its contents, and stop.
