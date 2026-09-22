# Mutation sweep — PR 6b "Structured task identity" (branch `model/task-identity`)

You did not write this change. Fresh detached worktree of your own at the tip named in `reviews/6b-ledger.md` under "Tip for sweep":

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/identity-sweep <tip>
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/identity-sweep/node_modules
    ln -s ~/claude/chuggy/ui/chuggy-ui/node_modules ~/claude/chuggy-wt/identity-sweep/ui/chuggy-ui/node_modules

Never `npm ci` under `ui/`. Read: `~/claude/chuggy-effort/ticket-language/pr6/GOAL.md`, `pr6/tasks/6b/{A,S,B,C}-report.md`, `pr6/reviews/6b-round1-{machine,surface}.md`, `pr6/reviews/sweep.md` (the shape and depth wanted, and the cwd trap it recorded), `~/.claude/projects/-home-geoff-claude-chuggy/memory/scoped-iteration-gates.md`, `.chug/tasks/review-change.md`.

Whole-branch mutation sweep over `git diff 1e986583..<tip>`: for every added or changed behaviour in the model, the domain, the actor, the interpreter, the adapters, 010, the contract and the console, apply one plausible mutation (a spawn naming the wrong cycle, `workCyclesStarted` not incremented, `stageGeneration` constant, the mint repeating a number, `stage` sent as the index, a CHECK arm loosened, a column grant dropped, the validator admitting `tid`, the door journalling the integer, a console key merging cycles, a label off by one) and run the narrowest gate or suite that should catch it; record RED or SURVIVED with the mutation, the file:line and the case. Goldens' step bodies are the model's output: mutate the manifest and the draws, not the traces. Survivors are findings only when they name a behaviour defect or a proof gap a cheap case closes. Docs pass: every comment the diff touches reads true against the code beside it; the copy is byte-identical to the package's. Fabric alignment: nothing under `.chug/`, `images/`, `deploy/` or in `~/claude/chuggy-fabric` names a task id, `tid`, or a stage index that this branch moved.

Verdict to `~/claude/chuggy-effort/ticket-language/pr6/reviews/6b-sweep.md`: APPROVE or CHANGES; the mutation table; findings with file:line; under ~120 lines. Remove your worktree and drop any database you made. Write the verdict, reply with the verdict, the counts and the findings only, and stop.

## Addendum (orchestrator)

Round 1 surface found a behaviour defect (`6b-round1-surface.md` finding 1) and task E fixed it (`pr6/tasks/6b/E-report.md`): program runs are cut at each set whose stage is the lowest in the cycle, not grouped by generation. You are the fresh eyes on that fix: rebuild the reviewer's page (stage 1 gen 1 Blocked → stage 1 gen 2 Passed → stage 2 gen 1 Passed) and one more of your own (two resumes: stage 1 gen 3 after a second block; and a resume that re-enters at stage 1 with stage 2 already passed once at gen 1, then passing again at gen 2) through `ticketLedger` and say whether each run and the cycle summary read true. Mutate the cut rule and confirm the case reddens. Round 2 machine's one finding (the sources case) was fixed by the orchestrator in the tip; include it in the table.
