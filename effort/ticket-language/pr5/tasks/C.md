# Task C — the console reads one escalation

Worktree `~/claude/chuggy-wt/escsum`, branch `model/escalation-sum` (A, S and B landed; the server is green). Root `node_modules` is linked; **never run `npm ci` inside `ui/chuggy-ui/`** (it wipes the root install) — the console's own deps are already there. Read, in order: `~/claude/chuggy-effort/ticket-language/pr5/GOAL.md` ("The wire folds", "Console"), `pr5/survey.md` §4 (every console file and test that draws reason/resume/blocked-by, with line numbers) and surprise 3, `pr5/tasks/B-report.md` ("The wire" — the exact object and its example), `src/contract/responses.ts` (`ticketEscalationSchema`) and `src/contract/rosters.ts` (`escalationKinds`, `blockedReasons`, `finalizationUnavailableKinds`, `gitEvidences`, `resumePoints`), `~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`, `CLAUDE.md`, `.chug/tasks/review-change.md`.

## Scope

`ui/chuggy-ui/app/**` and `ui/chuggy-ui/test/**`, `test/ui/**`:

- The ticket read's `reason`, `resumeAt`, `executionBlockedBy`, `finalizationBlockedBy` are gone; `escalation?: { kind, evidence?, resumeAt }` is present exactly on an Escalated ticket. Every surface survey §4 lists switches on `escalation.kind` for label, sentence, badge and tone; draws the wall line from `escalation.evidence` (a name from `blockedReasons`, `gitEvidences` or `finalizationUnavailableKinds` — label each roster; the finalization labels from PR 4 and the wall labels from PR 3 already exist, `gitEvidences` needs six new nouns); offers resume from `escalation.resumeAt`.
- `resumePoint.ts` shrinks to that switch: `walledPoint` becomes the module, `interruptedPoint` and the `resumeAt` override go, `ResumeSituation` loses `lastSet` and `resumeAt`; `ResumeOffer`'s `NotRead` arm goes with its only producer (`ticketPageFacts.ts:85-89`).
- `EvaluationBlockedEscalated` is new: label, sentence, tone and the resume sentence ("re-runs the evaluation" in whatever voice the siblings use). Copy per the standard: nouns, one-word statuses, one short line.
- `codeLabels.ts escalationDetailLine`: the wall's cancelled-set line now comes from the kind (`WorkExecutionUnavailableEscalated` → work cancelled, `EvaluationBlockedEscalated` → evaluation cancelled), no `lastSet` needed; keep the stage line for `EvaluationFailureEscalated`.
- Tests in `ui/chuggy-ui/test/` and `test/ui/` follow; each renamed or new arm has a case; `test/ui/resumePoint.test.ts` pins that `resumeAt` is read from the object and not recomputed.
- Comments in the console naming the old fields.

NOT yours: anything outside those directories. If a compile forces an edit elsewhere, make the smallest one and list it.

## Gates

From the repo root: `.chug/tasks/check-console.sh`, `.chug/tasks/check-console-sheets.sh`, `.chug/tasks/check-source.sh` (unit + static; must be 0 now), `check-figures`, `check-comments`, `check-paths`. Report each exit on the tip.

## Commits

On `model/escalation-sum`, small, in the tree's voice, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Report

`~/claude/chuggy-effort/ticket-language/pr5/tasks/C-report.md`: tip, files changed, the new labels (every new string, verbatim), what was deleted, gates on the tip. Under ~40 lines.
