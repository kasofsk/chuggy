# Task C — the rename in the console

Worktree `~/claude/chuggy-wt/rename`, branch `model/rename`, which carries A, S and B. `cd ui/chuggy-ui && npm ci` if stale. Read: `~/claude/chuggy-effort/ticket-language/pr3/GOAL.md` (Console paragraph and the rename table), `pr3/survey.md` (§1 console sites, §8 reason sites, surprise 9), `pr3/tasks/B-report.md` (the wire you now read: three `escalationReasons`, `executionBlockedBy`), `CLAUDE.md`, `.chug/tasks/review-change.md`, and the memory rule that console copy is nouns and one-word statuses.

## Scope

`ui/chuggy-ui/app/**` and `ui/chuggy-ui/test/**` only.

- Phase switch arms and labels follow the new names: `tones.ts`, `ticketSections.ts`, `codeLabels.ts`, `resumePoint.ts`, `ticketActions.ts`, `ticketPageFacts.ts`, `inboxUnion.ts`. The human-facing phase words stay whatever they are today unless they named the old constructor (a label "Working" for phase `Work` is a product choice already made; keep it).
- Task kinds in `codeLabels.ts:83-85` stay on the fabric-facing `Work`/`Evaluation` the wire still sends.
- Reason labels and sentences (`codeLabels.ts`, `codeSentences.ts`, `resumePoint.ts`, `ticketSections.ts`, `ticketActions.ts`) become the three reasons; the five wall labels move to `executionBlockedBy` and render beside the escalation only when the field is present.
- `ConversationWorkCard.tsx:140` returns the word "Working" as copy; it stays. `Stage` table headers and `Stage ${n}` copy stay.
- Fixtures and tests follow. `check-console` clean (format, typecheck, lint, test, build).

## Report

`~/claude/chuggy-effort/ticket-language/pr3/tasks/C-report.md`: tip, files, judgment calls on copy, `check-console` result. Under ~30 lines. Commits on `model/rename` ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
