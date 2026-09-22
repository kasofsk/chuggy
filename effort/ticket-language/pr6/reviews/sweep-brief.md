# Mutation sweep — PR 6a "Work fan-out goes" (branch `model/work-fanout-goes`)

You did not write this change. Fresh detached worktree of your own at the tip named in `reviews/ledger.md` under "Tip for sweep":

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/fanout-sweep <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/fanout-sweep/node_modules

Never `npm ci` under `ui/`. Read: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md`, `pr6/tasks/{A,S,B,C}-report.md`, `pr6/reviews/round1-{machine,surface}.md`, `pr5/reviews/sweep.md` (the shape and depth wanted), `~/.claude/projects/-home-geoff-claude-chuggy/memory/scoped-iteration-gates.md`, `.chug/tasks/review-change.md`.

Whole-branch mutation sweep over `git diff 0f94fe6b..<tip>`: for every added or changed behaviour in the model, the domain, the actor, the interpreter, the adapters, 009, the contract and the console, apply one plausible mutation (a spawn of two, a spawn site left on `spawnOn`, the CHECK not restated, the validator admitting `workFanout`, the mailbox bound not re-rendered, the re-seed skipped, the cursor member kept, a fixture width restored, a label restored) and run the narrowest gate or suite that should catch it; record RED or SURVIVED with the mutation, the file:line and the case. Goldens' step bodies are the model's output: mutate the manifest, not the traces. Survivors are findings only when they name a behaviour defect or a proof gap a cheap case closes. Docs pass: every comment the diff touches reads true against the code beside it. Fabric alignment: nothing under `.chug/`, `images/`, `deploy/` or in `~/claude/chuggy-fabric` names `workFanout`/`work_fanout`.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/sweep.md`: APPROVE or CHANGES; the mutation table; findings with file:line; under ~120 lines. Remove your worktree and drop any database you made. Reply with the verdict, the counts and the findings only.
