# Task C — the new reason in the console

Worktree `~/claude/chuggy-wt/finunavail`, branch `model/finalization-unavailable`, which carries A, S and B, tip 8a4cd92d. A left a placeholder sentence in `codeSentences.ts` and a `walledPoint` arm in `resumePoint.ts`; both are yours to finish. Root `npm ci` only if stale (never inside `ui/chuggy-ui/`). Read: `~/claude/chuggy-effort/ticket-language/pr4/GOAL.md` (**Console** paragraph), `pr4/survey.md` §8, `pr4/tasks/B-report.md` (the wire you now read: the fourth `escalationReasons` member and `finalizationBlockedBy`), `CLAUDE.md`, `.chug/tasks/review-change.md`, and the memory rule that console copy is nouns and one-word statuses (`~/.claude/projects/-home-geoff-claude-chuggy/memory/chuggy-ui-copy-standard.md`). Then how PR 3 added `executionBlockedBy`: `ui/chuggy-ui/app/core/codeLabels.ts` (`blockedReasonLabel`, `escalationDetail`), `ui/chuggy-ui/app/browser/ticket/TicketSituation.tsx`, `ui/chuggy-ui/test/codeLabels.test.ts`.

## Scope

`ui/chuggy-ui/app/**` and `ui/chuggy-ui/test/**` only.

- The reason `FinalizationUnavailableEscalated` gets a label, sentence, tone, section, resume point and action exactly as the three existing reasons have them (survey §8 lists the files and the silent fallback at `ticketActions.ts:145-149`, which gets an arm, not a wider fallback).
- The wall label beside Parked comes off `finalizationBlockedBy` as `escalationDetail` already does for `executionBlockedBy`: one short label per unavailable kind (thirteen), in the same function family, drawn only when the field is present.
- Tests: the copy-budget case maps the thirteen labels; `escalationDetail` with the finalization wall present and absent; the roster tests that enumerate reasons (one compile-time, one runtime literal array per survey §8) follow.
- `check-console` clean.

## Report

`~/claude/chuggy-effort/ticket-language/pr4/tasks/C-report.md`: tip, files, judgment calls on copy, `check-console` result. Under ~30 lines. Commits on `model/finalization-unavailable` ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.
