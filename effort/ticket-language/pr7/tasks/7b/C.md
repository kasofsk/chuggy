# Task C (PR 7b) — the console draws a cycle as its stages and their generations

Worktree `~/claude/chuggy-wt/evinst-console`, branch `console/evaluation-instance` off 0d2e1639 (A and S landed; B runs beside you on the model branch and never touches `ui/`, so the two merge cleanly). `node_modules` is a symlink to the root's; never `npm ci` under `ui/` (`cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Read: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7b — decisions" (7 is yours), `pr7/survey.md` §4, §6 and surprise 10, `pr7/tasks/7b/A-report.md` (the wire is unchanged: an execution summary carries its identity as on main, and the console imports no domain type), `pr6/tasks/6b/E.md` and `E-report.md` (the run cut this task deletes, and why it was cut that way), the memory `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`ui/chuggy-ui/` only.

- `app/core/ticketLedger.ts`: the run layer goes (`runsCutOf`, `programRunsOf`, `ProgramRun`); a cycle holds its stages in order, a stage its generations in order, a generation its evaluators by key. `runTotals.ts` keys `(cycle, stage, generation)`. `TicketSituation.tsx`'s `resumedFrom` reads the stage whose highest generation is above one, and says "Resumed at stage N" only for it; a blocked evaluator draws as blocked inside a stage still running; a stage at generation 2 draws beside the passes it kept. `TicketLedger.tsx`, `TicketUsage.tsx`, `codeLabels.ts` follow.
- Fixtures under `test/` follow; every case that pinned a program run now pins the stage/generation shape; add: a stage blocked at generation 1 then passed at generation 2 with the other evaluator's pass kept (one row per evaluator, the resumed one at generation 2); two cycles sharing stage numbers with totals kept apart; a sparse stage drawing both evaluators.
- Copy per the standard: nouns, one short line; a generation is drawn as "again" or "generation 2", never "run".

## Gates on the tip

`check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`. Report each exit.

## Commits

On `console/evaluation-instance`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr7/tasks/7b/C-report.md`: tip, files changed, what a reader sees differently, gates. Under ~30 lines. Write the report, reply with its contents, and stop.
