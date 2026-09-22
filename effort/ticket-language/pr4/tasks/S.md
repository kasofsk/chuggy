# Task S — migration 007

Worktree `~/claude/chuggy-wt/finunavail-schema`, branch `schema/finalization-unavailable` off main e5f7b3d3. Run `npm ci` at the root. Read, in order: `~/claude/chuggy-effort/ticket-language/pr4/GOAL.md` (decisions are settled; **When a hold becomes the result**, **The evidence reaches the reader** and **Migration 007** are your specification), `pr4/survey.md` §5, §6, §10.3, §10.4, `CLAUDE.md`, `.chug/tasks/review-change.md`, then `src/adapters/postgres/schema/migrations/006-rename.ts` end to end (007 is written in its shape) and `005-three-deletions.ts`'s header (what a guard is for and when there is none by argument), and `submit_finalization_result` as 006 leaves it (`006-rename.ts:244-350`).

## Scope

`src/adapters/postgres/schema/migrations/007-finalization-unavailable.ts`, its registration in `migrations/index.ts`, `src/adapters/postgres/schema/README.md` where it enumerates, `test/postgres/migration.test.ts`, and nothing else. Task A renames nothing this time; Task B will call your function from TypeScript after you land, so your tests speak SQL.

007 does, in this order: the two reason CHECKs (`ticket_projection_reason_is_known`, `native_action_reason_check`) admit `FinalizationUnavailableEscalated`; the three outcome IN lists (`decision_event_is_valid` FinalizationResult, `ticket_command_is_valid` SubmitFinalizationResult, `submit_finalization_result` in_outcome) admit `FinalizationResultUnavailable`; `finalization_request` gains `hold_kind`, `hold_passes`, `held_since` with the CHECKs GOAL.md states (the thirteen kinds as a literal list — the roster's one SQL home; name the TypeScript roster it mirrors in the header); `record_finalization_hold` with the semantics GOAL.md states, fenced by the same claim arguments `submit_finalization_result` takes and refusing a caller that does not hold the claim, `SECURITY DEFINER` owned as its siblings are, executable by the finalizer role only; the third binding arm in `submit_finalization_result` (fences on the recorded hold; no attempt; the kind carried in the command JSON — decide the narrowest widening of `in_failure_kind` that leaves `finalization_attempt_failure_kind_is_known` as it is, and say why in the header); `chuggy_api` SELECT on the three new columns. Whether 007 needs a guard is argued in its header either way.

Tests, each red-proved by mutating the migration once: a case per CHECK admitting the new value and still refusing nonsense; `record_finalization_hold` same-kind increments / different-kind resets / null clears / a kind outside the thirteen refused / a caller without the claim refused; the third arm admits a submission whose kind matches the recorded hold, refuses one with no recorded hold, refuses a mismatched kind, refuses one that names an attempt-shaped failure kind; the api role can read the columns and the finalizer role can call the function while the api role cannot; every earlier case still green.

Render-diff every earlier migration main vs your branch with `~/claude/chuggy-effort/ticket-language/scratch/B-fix0/render.mjs` (read its header for usage) and state that the diff is empty.

## Gates

`check-postgres`, `check-queries`, `check-figures`, `check-comments`, `check-paths`, `check-source --static`. Report each exit on the tip.

## Commits

On `schema/finalization-unavailable`, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.

## Report

`~/claude/chuggy-effort/ticket-language/pr4/tasks/S-report.md`: tip, every constraint/function/column touched, the function's exact signature and refusals (B calls it), the widening chosen for the failure kind, the render-diff result, gates, anything GOAL.md the schema refuted and what you did instead. Under ~50 lines.
