# Mutation sweep — PR 5 "Escalated is a sum", tip d7691240 (branch `model/escalation-sum`)

You did not write this change. Whole-branch mutation sweep, the second review. Detached worktree of your own:

    git -C ~/claude/chuggy worktree add --detach ~/claude/chuggy-wt/escsum-sweep d7691240
    ln -s ~/claude/chuggy/node_modules ~/claude/chuggy-wt/escsum-sweep/node_modules

Never `npm ci` under `ui/`. Read first: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md`, `pr5/reviews/{round1-machine,round1-surface,ledger}.md` (what round 1 already probed — do not repeat those mutants), `pr4/reviews/sweep.md` (the shape and depth wanted), `.chug/tasks/review-change.md`, `~/.claude/projects/-home-geoff-claude-chuggy/memory/guards-fail-open.md`.

Diff: `git diff bd63df14..d7691240`. For every behaviour the diff adds or changes — the model's `resumeOf` and `decideExecutionBlocked` arms, `deskConsistent`, the actor's semantics-6 refusal, 008's guard, CHECKs, functions and grants, the wipe's table list and counter reset, the projection writer's evidence sources and its IntegrityContradiction, the upsert, the reads' narrowing, the wire schema and rosters, `ticketEscalationResource`, the console's switches, labels and offers — make one plausible single mutation and run the suite that should catch it (scoped: the unit suite, the postgres suite alone via `CHUG_PG_URL=postgres://postgres:chuggy-check@127.0.0.1:55432/<your db>` against the running `chuggy-check-postgres` container after `docker exec chuggy-check-postgres psql -U postgres -c 'CREATE DATABASE <your db>'`, vitest in `ui/chuggy-ui`, `check-conformance`; `check-model` only for a model mutation you cannot catch otherwise). Aim for forty to sixty mutations. Revert every one; the worktree ends byte-clean.

Then the docs pass: every comment and header the diff touches, held to CLAUDE.md's bar and `check-figures`/`check-comments`/`check-paths`. Then fabric alignment: does anything under `.chug/configurations/`, `images/`, `deploy/` or `~/claude/chuggy-fabric-wt/*` name `reason`, `resumeAt`, `executionBlockedBy`, `finalizationBlockedBy`, `escalationReasons` or an old spelling, such that the rig or a worker would break when this lands?

Verdict to `~/claude/chuggy-effort/ticket-language/pr5/reviews/sweep.md`: APPROVE or CHANGES; the mutation table (mutation → suite → RED/survived); every survivor classed as behaviour defect, unpinned-but-right, or unobservable, with the failure a defect would cause; findings with file:line. A sweep round ships unless it finds a behaviour defect, so say plainly which class each survivor is. Under ~120 lines. Remove your worktree and drop your database when done.
