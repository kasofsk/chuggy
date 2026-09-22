# Review round 1, surface half — PR 6a "Work fan-out goes" (branch `model/work-fanout-goes`)

You did not write this change. Review it fresh in a detached worktree of your own at the tip named in `reviews/ledger.md`:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/fanout-review-surface <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/fanout-review-surface/node_modules

Never `npm ci` under `ui/`. Your half: `ui/chuggy-ui/app`, `ui/chuggy-ui/test`, `test/ui`, and `src/contract/{authoring,responses}.ts` as the console reads them. Diff: `git diff 0f94fe6b..<tip> -- ui test/ui src/contract`.

Read first: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md`, `pr6/tasks/{B,C}-report.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `.chug/tasks/review-change.md`, `CLAUDE.md`.

## What to check

1. The picker is gone and nothing else offers a work width: `git grep -n -i "workFanout\|work fan\|fan-out\|fanout" ui/chuggy-ui/app test/ui` — every hit left must be evaluation fan-out, and its copy must say so.
2. The ledger and provenance: a work set is one task. Does any grouping, count, heading or label still assume N (e.g. "tasks", "set of", a width column)? Does the evaluation stage's fan-out still draw correctly beside it? Load the fixtures in `ui/chuggy-ui/test/*Fixture.ts` and say what a reader sees on the ticket page for a two-cycle ticket.
3. Creation form: the advanced panel without the picker; the request body the console sends has no `workFanout` (the contract refuses one); the initialization read without `choices.workFanouts` renders.
4. Copy per the standard: nouns, one-word statuses, one short line, no internals.
5. Tests: mutate one removed-field site back in and one label, and confirm a test reddens.
6. Gates at the tip: `check-console`, `check-console-sheets`, `check-source`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/round1-surface.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~60 lines. Remove your worktree when done. Reply with the verdict and the findings only.
