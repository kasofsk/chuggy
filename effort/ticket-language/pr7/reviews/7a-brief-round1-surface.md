# Review round 1, surface half — PR 7a "The program is a plan" (branch `model/evaluator-keys`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/7a-ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/evkeys-review-surface <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/evkeys-review-surface/node_modules

Never `npm ci` under `ui/` (`cd ui/chuggy-ui && npx vitest run` and `npx tsc --noEmit` work as they are). Your half: `ui/chuggy-ui/app`, `ui/chuggy-ui/test`, `test/ui`, and `src/contract/{authoring,responses}.ts` as the console reads them. Diff: `git diff e9a6136e..<tip> -- ui test/ui src/contract`.

Read first: `~/claude/chuggy-effort/ticket-language/pr7/GOAL.md` §"PR 7a — decisions" (6 and 8), `pr7/survey.md` §6 and surprise 12, `pr7/tasks/7a/{B,C}-report.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check, each with a failure that actually happens

1. The body sent: for a two-stage pick of counts 2 and 1 the console sends `{key: 1, evaluators: [{key: 1}, {key: 2}]}, {key: 2, evaluators: [{key: 1}]}` and nothing else; the count is bounded by `choices.evaluatorsMax`, and a draft initialization without it (an older fixture) does not crash the form.
2. What is drawn: `TicketProvenance` and the creation label draw the evaluator count; the ledger's expected width for a sparse stage `[{key: 1}, {key: 3}]` is 2, and a page whose executions carry evaluator keys 1 and 3 draws both under one stage with the right identity per row. No key is drawn (decision 8) and no raw shape leaks into copy.
3. Fixtures: every `{fanout}` fixture is gone; `git grep -n fanout ui test/ui` is empty or every hit is justified.
4. Tests: mutate the key minting (start at 0), the width read (count the executions instead) and the provenance label, and confirm a test reddens for each.
5. Gates at the tip: `check-console`, `check-console-sheets`, `check-source --static`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr7/reviews/7a-round1-surface.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~60 lines. Remove your worktree when done. Write the verdict, reply with it, and stop.
