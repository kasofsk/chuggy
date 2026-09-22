# Review round 2, machine half — PR 6b (branch `model/task-identity`)

You did not write this change. Fresh detached worktree of your own at the tip named in `reviews/6b-ledger.md` under "Tip for round 2":

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/identity-review-machine2 <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-review-machine2/node_modules

Never `npm ci` under `ui/`. Round 1 (`6b-round1-machine.md`) approved the machine, the mint, 010 and the goldens and asked for three changes; task D made them (`pr6/tasks/6b/D-report.md`). Your scope is D's diff alone: `git diff 1fb1bc26..<tip> -- model src test .chug` (the console commits in that range are the surface reviewer's; skip `ui/`). Read `.chug/tasks/review-change.md` and `CLAUDE.md`.

Check, each with a failure that actually happens: the model's `selectedRequirement` and its suite prove kind → ticket → platform and nothing selects by task; the roster test holds `requirementSources` to the model's; 010's restated `execution_requirement_source_known` admits exactly the three members and the migration case reddens without the ALTER (re-prove it); render-diff 001–009 empty; no reader of `requirement_source` anywhere in `src/` still switches on `ExplicitTask` (a `switch` that lost an arm with no `assertNever` fails silently); the two model docs say what is true (`model/AGENTS.md`, `domain.qnt` near `decideDispatch`). Gates at the tip: `check-model`, `check-model-api`, `check-source`, `check-queries`, `check-postgres`, `check-figures`, `check-comments`, `check-paths`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/6b-round2-machine.md`: APPROVE or CHANGES; each finding names file:line, the input and what goes wrong; under ~40 lines. Remove your worktree and drop any database you made. Write the verdict, reply with it, and stop.
