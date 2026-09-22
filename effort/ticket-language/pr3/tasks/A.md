# Task A — the rename in the model, the goldens, the generated mirror, the domain and the actor

Worktree `~/claude/chuggy-wt/rename`, branch `model/rename` (off `model/three-deletions` d3a66d0f, which carries origin/main). Run `npm ci` there first; the gates need it. Read, in order: `~/claude/chuggy-effort/ticket-language/pr3/GOAL.md` (the decisions; they are settled, do not reopen them), `pr3/survey.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`, and the header of `src/adapters/postgres/schema/migrations/005-three-deletions.ts` for the tree's precedent on admitting old spellings.

## Scope

Every rename in GOAL.md's table, in these layers only: `model/` (all `.qnt`, including `model/api.qnt`'s `ApiX` aliases, `model/tests/`, `model/mc/`), `test/golden/` (re-emit with `.chug/tasks/emit-goldens.sh`; rewrite `manifest.json`'s invariant expressions in the new names), `src/domain/` (`core.ts` becomes `ticketGraph.ts`; the `Core` type becomes `TicketGraph`; `core` parameters become `graph`), `src/domain/generated/` and `src/generated/` (regenerate with `scripts/generate-model-api.ts`), `src/actor/` (decision semantics 5 with the normalising stored-row decoder GOAL.md describes; every 1–4 correction compares against the new spellings because it reads a normalised row; the PR 1 removed-wall labels stay refused as they are), `src/domain/effect.ts` untouched (effects are deferred), the conformance harness under `test/conformance/`, and the tests of all of the above. The step labels derived from reasons change with the reasons (GOAL.md's last table row); `test/golden/coverage.test.ts` regenerates the roster from `domain.qnt`.

NOT yours: `src/interpreter/`, `src/adapters/`, `src/contract/`, migrations, `ui/`. Where a rename in your layers breaks a compile in those, make the smallest mechanical edit that keeps `check-source` green (an import path, a type name) and list every such file in your report; Task B owns their substance. Do not touch `test/actor/journalAtSemanticsOne*.json`: they are frozen old rows, and your semantics-5 tests must prove they still replay to the same events.

The TaskKind rename is `Work → WorkTask`, `Evaluation(n) → EvaluationTask(n)` in the model and the domain; the fabric-facing `executionTaskKinds` roster in `src/contract/rosters.ts` and `execution_request_task.kind` stay `Work`/`Evaluation`, mapped at the adapter (B's job; if the compile forces you to touch the mapping site, map, do not rename).

Model: `check-model.sh` must stay at its witness roster count or the count in `check-model.test.sh` is updated with the reason in the commit. No proved property leaves; no new prose restates one.

## Gates

`check-model-api`, `check-source` (unit + static), `check-conformance`, `check-random`, `check-model` (long; run it last, once), `check-figures`, `check-comments`, `check-paths`, `check-boundaries`. Scoped iteration is fine while working (skip gates your change cannot inform); the report states which gates ran on the final tip and their exit codes.

## Commits

Small, each one thing, on `model/rename`. Messages in the tree's voice (read `git log -20 --format=%s`). End each with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

Write `~/claude/chuggy-effort/ticket-language/pr3/tasks/A-report.md`: tip commit, what changed per layer, the files outside your layers you had to touch and why, the witness count, gate results on the tip, and any decision in GOAL.md that the tree refuted (say what you did instead and why). Under ~60 lines.
