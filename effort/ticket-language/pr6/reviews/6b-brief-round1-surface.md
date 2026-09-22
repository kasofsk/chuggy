# Review round 1, surface half — PR 6b "Structured task identity" (branch `model/task-identity`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/6b-ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/identity-review-surface <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-review-surface/node_modules
    ln -s ~/claude/chuggy/ui/chuggy-ui/node_modules ~/claude/chuggy-wt/identity-review-surface/ui/chuggy-ui/node_modules

Never `npm ci` under `ui/`. Your half: `ui/chuggy-ui/app`, `ui/chuggy-ui/test`, `test/ui`, and `src/contract/responses.ts` as the console reads it. Diff: `git diff 1e986583..<tip> -- ui test/ui src/contract`.

Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md` §"PR 6b — decisions" (7), `pr6/survey.md` §5 and surprises 11–12, `pr6/tasks/6b/{B,C}-report.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check

1. Inference gone: `git grep -n "cycleSetsOf\|executionTaskSuffix\|/-\\\\d+\$/\|programRun" ui/chuggy-ui/app` — anything left must be justified; cycles, stages, generations and evaluators drawn off `identity`; `runTotals` keys by `(cycle, stage)`.
2. The stage label: the identity's stage is already positive; no `+1` remains, and no label is off by one against a fixture that names stage 1.
3. Two cycles sharing a stage number: totals, ledger rows and the situation card keep them apart (C's case; mutate its key and confirm it reddens).
4. Sorting and paging still by the wire integer; the cursor unchanged.
5. Copy per the standard: nouns, one short line, no internals; no "task 7".
6. Tests pin each arm; mutate two labels and one grouping key and confirm a test reddens.
7. Gates at the tip: `check-console`, `check-console-sheets`, `check-source --static`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/6b-round1-surface.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~60 lines. Remove your worktree. Write the verdict, reply with it, and stop.
