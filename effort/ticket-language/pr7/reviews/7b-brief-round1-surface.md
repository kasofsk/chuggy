# Review round 1, surface half — PR 7b "The evaluation instance" (branch `model/evaluation-instance`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/7b-ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/evinst-review-surface <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evinst-review-surface/node_modules

Never `npm ci` under `ui/` (`cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Your half: `ui/chuggy-ui/app`, `ui/chuggy-ui/test`, `test/ui`, and `src/contract/responses.ts` as the console reads it. Diff: `git diff f8d6c8fd..<tip> -- ui test/ui src/contract`.

Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7b — decisions" (7 and 8), `pr7/survey.md` §4, §6 and surprise 10, `pr7/tasks/7b/{B,C}-report.md`, `pr6/reviews/6b-round1-surface.md` finding 1 and `pr6/tasks/6b/E-report.md` (the run cut this branch deletes), `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The shape: build, through `ticketLedger`, the reviewer's page from 6b (stage 1 gen 1 Blocked → stage 1 gen 2 Passed → stage 2 gen 1 Passed) and two of your own (two resumes of the same stage; two cycles whose stages share numbers). Each cycle draws its stages in order, each stage its generations, each generation its evaluators by key; totals are kept apart per `(cycle, stage, generation)`; "Resumed at stage N" names the stage whose highest generation is above one and nothing else.
2. A blocked evaluator draws as blocked inside a stage still running; the kept pass draws beside the generation-2 row, not under it. No raw shape or status enum leaks into copy; nothing says "run".
3. Fixtures: `git grep -n 'ProgramRun\|runsCutOf\|programRunsOf' ui test/ui` is empty.
4. Tests: mutate the generation key (merge generations), the resumed-stage read (lowest stage instead of highest generation) and the totals key (drop the cycle), and confirm a test reddens for each.
5. Gates at the tip: `check-console`, `check-console-sheets`, `check-source --static`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr7/reviews/7b-round1-surface.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~60 lines. Remove your worktree when done. Write the verdict, reply with it, and stop.
