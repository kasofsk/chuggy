# Task C (PR 6b) — the console reads the identity instead of inferring it

Worktree `~/claude/chuggy-wt/identity`, branch `model/task-identity`, which carries A, S and B. `node_modules` is a symlink to the root's; never `npm ci` under `ui/` (`cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Read: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" (7 is yours), `pr6/survey.md` §5 and surprises 11–12, `pr6/tasks/6b/B-report.md` §"What C must change" and the wire shape of `identity`, `pr6/tasks/C.md` and `C-report.md`, the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`ui/chuggy-ui/` only.

- `app/core/ticketLedger.ts`: cycles, stages and evaluators come off `identity`; `cycleSetsOf`'s counting, the program-run reconstruction from stage indices, and the `/-\d+$/` grouping over the execution identity go. `runTotals.ts` keys a stage by `(cycle, stage)`, never merging across cycles. `TicketLedger.tsx`, `TicketSituation.tsx` (`resumedFrom`), `TicketUsage.tsx` and `codeLabels.ts` draw off the new output; the three `+1` stage labels become the identity's stage as it is. Sorting by the wire integer stays.
- Fixtures under `test/` follow; every case that pinned an inferred cycle or generation now pins the read one; add one case where two cycles share a stage number and the totals stay apart.
- Copy per the standard: nouns, one short line; no "task 7" — a task is named by cycle and stage, or by evaluator within a stage.

## Gates on the tip

`check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`. Report each exit.

## Commits

On `model/task-identity`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr6/tasks/6b/C-report.md`: tip, files changed, what a reader sees differently, gates. Under ~30 lines. Write the report, reply with its contents, and stop.
