# Task S — migration 006, the rename in the schema

Worktree `~/claude/chuggy-wt/rename-schema`, branch `schema/rename` (off `model/three-deletions` d3a66d0f). Run `npm ci` there first. Read, in order: `~/claude/chuggy-effort/ticket-language/pr3/GOAL.md` (the decisions are settled; the **Migration 006** paragraph is your specification), `pr3/survey.md` (§1, §2, §4, §8, §11 list every constraint, function and column), `CLAUDE.md`, `.chug/tasks/review-change.md`, then `src/adapters/postgres/schema/migrations/005-three-deletions.ts` end to end: 006 is written in its shape (guard first reading fields not text, restated CHECKs, replaced functions admitting old and new spellings, a header that states what the migration refuses and why).

## Scope

`src/adapters/postgres/schema/migrations/006-rename.ts`, its registration in `migrations/index.ts`, `test/postgres/migration.test.ts` (a case per guard arm, a case per rewritten column, a case that a journal row in the old spelling still passes `decision_event_is_valid` and one in the new spelling does, a case for the recreated partial index admitting both event types, a case that `submit_finalization_result` takes `in_outcome` at both spellings), and nothing else. Task A is renaming the TypeScript in parallel; you do not touch it, and your tests speak SQL to the migrated schema, not the domain types.

The data rewrite covers `ticket_projection.phase/.reason/.resume_at`, `native_action.reason` (every row; 005's settled-row `DependencyRevoked` arm stays), `project_continuation.expected_phase`. `execution.blocked_reason`, `execution_request_task.kind`, `execution_request.kind`, `execution_result.verdict`, `finalization_request.kind` and every journal/decision_input byte are untouched. Old spellings and new, exactly as GOAL.md's table gives them; the wall reasons collapse to `WorkExecutionUnavailableEscalated` in `ticket_projection.reason` and `native_action.reason` only.

Landed migrations are not edited. Before you report, render-diff every earlier migration main vs your branch with `~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs` (read its header for the usage) and state that the diff is empty.

Rig facts you may rely on: schema ledger is at 5 after PR 2 lands; `ticket_projection` holds rows in every old phase name and in reasons including the wall names; `native_action` holds settled rows at `DependencyRevoked` and open and settled rows at the other reasons; `project_continuation` may hold rows.

## Gates

`check-postgres`, `check-queries` (both need docker or `CHUG_PG_URL`), `check-figures`, `check-comments`, `check-paths`, `check-source --static`. The report states each gate's exit code on the tip.

## Commits

On `schema/rename`, in the tree's voice, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr3/tasks/S-report.md`: tip commit, the guard's arms, every constraint/function/index touched, the render-diff result, gate results, anything in GOAL.md the schema refuted and what you did instead. Under ~50 lines.
