# Task M — main into model/rename, and the stored finalization outcome lifts

Worktree `~/claude/chuggy-wt/rename`, branch `model/rename`, tip 14048917 (A, S, B, C landed). Run `npm ci` at the root and in `ui/chuggy-ui/` if stale. Read, in order: `~/claude/chuggy-effort/ticket-language/pr3/GOAL.md` (decisions settled; the **Journal rows are immutable; the reader translates** paragraph is the one this task lives in), `pr3/tasks/A-report.md`, `pr3/tasks/B-report.md` (item 3 under its findings is the second half of this task), `~/claude/chuggy-effort/ticket-language/pr2-fix/GOAL.md` (what main gained since the branch forked: the cascade correction), `CLAUDE.md`, `.chug/tasks/review-change.md`, then `src/actor/decisionSemantics.ts` whole on both sides.

## Part 1 — merge `origin/main` (55de9de6) into `model/rename`

`git fetch origin` then `git merge origin/main`. Two files conflict: `src/actor/decisionSemantics.ts` and `test/actor/decisionSemantics.test.ts`. Main's side (PR #722) removed `revokedMoreThanItsOwnTicket` and added `decisionAtRevokeCascadedToDependents`, a semantics ≤3 correction: a stored `Revoke` row whose record parks Pending dependents (`Pending→Escalated` transitions, one `OpenHumanTask` per dependent) replays to its own stored record and to a post-state with each named dependent `Escalated{reason: NoReason, resumeAt: NoResume}`, the parked set restricted to dependents Pending in the decider's own post and deduplicated; `replayableDecision` no longer refuses the cascade; `recordEquals` in `storedJournalLegalOn` is what refuses a semantics-4 row of that shape; 005's guard lost its cascade arm (already on both sides via the branch's own merge-base — check, and if not, main's 005 wins since it was never applied before 55de9de6 and the rig is on it now at ledger 5). The branch's side (Task A) rewrote the file for semantics 5 with the normalising decoder `rowAtCurrentVocabulary` and every correction reading normalised rows in the new spellings.

The resolution: the cascade correction survives, applied at semantics 1–3, written against **normalised** rows (new spellings: the dependents' transitions read `from: "Pending", to: "Escalated"`, unchanged by the rename; the decider's phases are the new words), sitting beside A's other corrections in whatever order the file composes them; `decisionSemanticsVersionCurrent` stays 5. Both sides' tests survive: main's rig-shaped cascade history (legal at 1–3, refused at 4 — and refused at 5, add that arm) and its `forgedParks` table, in the branch's spellings where a phase name appears; A's semantics-5 tests untouched. `test/actor/journalAtSemanticsOne*.json` are not rewritten. Also check `test/postgres/migration.test.ts` and `ui/chuggy-ui/test/projectTableLabels.test.tsx`, which auto-merged: read the result, do not trust it.

Then the replay probe: copy `~/claude/chuggy-effort/ticket-language/pr2-fix/replay-rig.ts` beside its journal dump `pr2-fix/rig-journal/vteng.jsonl` (rows through seq ~640 of vteng/chuggy; still the rig's shape), run it against the branch's `src` and report the result. It must find every row legal under `storedJournalLegalOn` after the merge. If it does not, the merge is wrong, not the rig.

## Part 2 — B-fix1: the stored finalization outcome lifts

`checkedFinalizationSubmission` in `src/interpreter/wire.ts` compares a stored `SubmitFinalizationResult`'s `in_outcome` against `finalizationOutcomeTags` alone, so a submission written before the deploy at `FinalizationFailed` and decided after it is admitted by 006 and refused by the writer. Lift it through the word map in `decisionSemantics.ts` (the same map `rowAtCurrentVocabulary` uses; export the narrowest thing that serves — a one-word lift, not the whole row lift — and say in its doc comment that the writer is its second caller), so the submission decodes as `FinalizationNeedsWork`. A test in `test/interpreter/` that a stored submission at the old spelling decodes and one at an unknown spelling is still refused.

## Gates

`check-source` (unit + static), `check-boundaries`, `check-conformance`, `check-postgres`, `check-queries`, `check-figures`, `check-comments`, `check-paths`, `check-console`. Report each exit on the tip. `check-model` is not yours (the reviewer's full ci runs it).

## Commits

The merge commit, then small commits on `model/rename` in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `git push`.

## Report

`~/claude/chuggy-effort/ticket-language/pr3/tasks/M-report.md`: tip, how the conflict resolved (which correction runs where), replay probe result, the exported lift's name and both callers, gates on the tip, anything the brief got wrong. Under ~40 lines.
