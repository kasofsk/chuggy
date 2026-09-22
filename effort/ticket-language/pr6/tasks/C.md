# Task C — work fan-out leaves the console

Worktree `~/claude/chuggy-wt/fanout`, branch `model/work-fanout-goes`, which carries A, S and B. `node_modules` is a symlink to the root's; never `npm ci` under `ui/` (the console's dependencies are already installed; `cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Read: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md`, `pr6/tasks/A-report.md` §"What B and C must change", `pr6/tasks/B-report.md` §"What C must change", `pr5/tasks/C.md` and `pr5/tasks/C-report.md`, the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`ui/chuggy-ui/` only. The authoring picker for work fan-out goes (`TicketCreationAdvanced.tsx`), `ticketCreation.ts` stops carrying it, provenance and the ledger stop drawing a work width (a work set is one task; grouping that assumed N stays correct at 1 but any copy saying "fan-out" for work goes; evaluation fan-out stays), the eight test fixtures follow, and the contract types the console imports drive the rest. Copy follows the UI copy standard: nouns, one short line.

## Gates on the tip

`check-console` (`.chug/tasks/check-console.sh`), `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, and `check-source --static`. Report each exit.

## Commits

On `model/work-fanout-goes`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/C-report.md`: tip, files changed, what a reader sees differently, gates. Under ~30 lines. Reply with its contents.
