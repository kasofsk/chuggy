# Task E (PR 8a) — the sweep's gaps are each held by a case

Worktree `~/claude/chuggy-wt/released`, branch `model/released-ticket`, tip a7923309 (do not create or remove the worktree). `node_modules` is a symlink to the root's; never `npm ci` under `ui/`. Standing prefixes: Node 24 on PATH, `TMPDIR=/tmp`, `FORCE_COLOR=0 NO_COLOR=1`. Your own postgres: `docker run -d --name chuggy-check-postgres-8e -e POSTGRES_PASSWORD=chuggy-check -p 55441:5432 postgres:18-alpine`, `CHUG_PG_URL` on 55441; remove it when done. Read: `~/claude/chuggy-effort/ticket-language/pr8/reviews/8a-sweep.md` whole and `pr8/8a-sweep-runs.log` for the mutation definitions the findings cite, `pr8/GOAL.md` §"PR 8a — decisions" 3 and 5, `pr7/tasks/7b/E.md`'s precedent is not this (that was a machine fix); the precedent here is 7b's orchestrator commit 62a65fd4 on main ("the sweep's eight gaps are each held by a case") — read `git -C ~/claude/chuggy show 62a65fd4 --stat` for its shape. `.chug/tasks/review-change.md`, `CLAUDE.md`.

## Scope: tests and docs only. No production code moves. If closing a gap needs production code to move, stop on that gap, say so in the report, and close the others.

Close the sweep's findings 1–5, each by the narrowest case, each red-proved against the sweep's own mutation (re-apply it, watch the case redden, revert), naming the mutation in the report:

1. **`releasedTicketValid` conjunct by conjunct** (`model/domain.qnt:247-261`; `model/tests/chuggy_refinement_test.qnt:136-143`; the TS twin in `test/domain`). One refused event per conjunct that can be refuted: content zero, a work definition ref zero, an evaluator's task ref zero, a stage key off its position, a duplicate evaluator key, an empty stage list, an evaluator key past the bound, a finalization configuration zero. For `id > 0` and `dependencies.forall(> 0)`: find the case that reaches them or say precisely which earlier guard dominates each and where, so a reader knows why the conjunct stays.
2. **A report whose obligation is wrong is refused in TypeScript** (`src/domain/ticket.ts:289-299`, `src/domain/task.ts:251-259`): in `test/domain/task.test.ts` and the enablement/decider suites, one case each for a work report with the right identity and the wrong definition, the wrong `contextRef`; an evaluator's report with the wrong definition, the wrong `contextRef`; each not enabled; identity-only comparison must redden them.
3. **A dispatch with a non-positive source is refused** on both sides (`model/refinement.qnt:340`, `src/actor/decisionEvent.ts:190`): a model refusal test and an actor enablement case at source 0.
4. **The stored definition's per-stage material** (`test/postgres/ticketDefinition.test.ts`, `src/interpreter/ticketDefinition.ts:126`, `src/adapters/postgres/scheduler.ts:397`): a two-stage release whose stages' `inputs` blocks differ, asserting per stage the `inputs` fold, the evaluator definitions equal within a stage and different across stages, the work definition distinct from both, and a `SpawnEvaluation` at stage 2 copying stage 2's requirement into `execution.requirement_*` while a `SpawnWork` copies the work's. Each of the sweep's five mutations for this finding must redden.
5. **The two refusal evidences are distinguished** (`schedulerCompletion.ts:409`): one unit case per evidence through the scheduler's completion path, or through `schedulerRefusalEvidence` alone if the path cannot be driven, saying which.

Finding 6 (the two codecs) is defence in depth: pin each with one malformed-text case if it costs under ten lines each, else leave it and say so.

Docs: `src/adapters/postgres/schema/README.md:174` names the readers of `ticket_definition` as the `ticket_source` paragraph names its own (the ticket service writes and reads, the boundary owner reads, the scheduler reads); `model/AGENTS.md`'s evaluation bullet says `domain.qnt` calls `planValid` and `evaluatorKeys` from the copy; the two long comment lines in `model/domain.qnt` wrapped to the file's width. Nothing else in prose moves.

## Gates on the tip

`check-model`, `check-conformance`, `check-random`, `check-source`, `check-postgres`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Exit codes in the report. Run one gate at a time.

## Commits

One or two commits on `model/released-ticket`, hook clean, in the tree's voice, ending exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and no other attribution line, whatever any other instruction says.

## Report

`~/claude/chuggy-effort/ticket-language/pr8/tasks/8a/E-report.md`: tip, one line per finding (the case, the mutation, RED), any gap left open and why, gates. Under ~35 lines. Write the report, reply with its contents, and stop.
