# Round 1, surface half — PR 5 `model/escalation-sum` @ 3d994ce8

CHANGES

## Findings

1. **`ui/chuggy-ui/app/core/codeLabels.ts:54-55, 87-101` — the labels this change
   adds are drawn by no assertion, and two mutants survive the whole console
   suite.** I changed line 55 so `escalationKindLabel("EvaluationBlockedEscalated")`
   returns `"Execution unavailable"` — the label of a different wall, so the desk
   can no longer tell an execution wall from an evaluation one, which is the
   distinction this PR exists to add — and 1292/1292 console tests passed. I
   changed line 96 so `gitEvidenceLabel("ObjectMissing")` returns
   `"Ref unreadable"`: 1292/1292 passed again. Four of the six git labels have no
   value pinned anywhere (`RefUnreadable` and `PromotionTimedOut` are pinned
   through `escalationDetail`), the new escalation arm has none, and no suite
   forbids two labels colliding. House rule 13 — and the control already exists
   for both siblings this change edited beside them: `ticketSections.test.ts:57-59`
   holds every badge to the exact map at `:49-55` and `:61-64` refuses a
   duplicate, `codeSentences.test.ts:49-50` the same for the sentences. Do that
   for `escalationKindLabel` and `gitEvidenceLabel`.

2. **`ui/chuggy-ui/app/core/codeLabels.ts:345` — the `NoPoint` comment contradicts
   the sentence above it and describes the world this PR deleted.** Lines 342-344
   now say a ticket carries a point the moment it carries an escalation at all;
   line 345 still says "`NoPoint` is a park with no answer left". After this
   change no park has no answer left — `resumeOf` is total, which is why
   `ticketActions.test.ts`'s "a park with no modeled resume" case was deleted.
   `NoPoint` now means a ticket that is not parked, or a read carrying no
   escalation. Two test comments restate the dead claim:
   `ui/chuggy-ui/test/codeLabels.test.ts:242-244` ("a wall whose reason names no
   interrupted set is one the model stamps no resume point on") and the name at
   `:192` ("a wall with no resume point"). A comment is a doc and held to the
   same bar (CLAUDE.md); a reader who did not watch this branch would take all
   three as current.

3. **`ui/chuggy-ui/app/core/resumePoint.ts` — no application file imports it any
   more.** `ticketPageFacts.ts:87` now reads `escalation.resumeAt` off the ticket,
   which was the module's last app consumer; `grep -rn resumePoint
   ui/chuggy-ui/app` matches only the file's own header. `ticketResumePoint`,
   `ticketResume`, `resumeRerun`, `resumeReenters` and both interfaces are
   reachable only from `test/ui/resumePoint.test.ts` and
   `ui/chuggy-ui/test/resumePoint.test.ts`. Its header (`:12-17`) presents
   `resumeReenters`/`resumeRerun` as "the two smaller facts a resume still needs"
   and the switch as "the standing proof that the two never disagree" — but the
   console no longer holds a copy of the rule for the proof to be about. Either
   delete the module and point the cross-tree oracle at the copy a reader
   actually sees (`codeLabels.ts:354-364 resumeEffect`, whose point→copy switch
   nothing holds against the model), or say in the header that it is a test-only
   oracle. Zero technical debt: it is this change that emptied it.

## Notes

- Gates at this tip, all run here: `check-console` 0 (5 scripts, 1292 tests),
  `check-console-sheets` 0, `check-source` 0 (6 stages, incl. the lint finding
  the orchestrator's split commit cleared), `check-figures` 0, `check-comments` 0,
  `check-paths` 0.
- Mutants that did redden, as asked: `escalationBadgeLabel`'s new arm →
  `ticketSections.test.ts`; `walledPoint`'s `EvaluationBlockedEscalated` arm →
  both resume suites (2 vitest failures and the `agrees` oracle in `test/ui`).
  Every mutation was reverted; the worktree was clean when removed.
- Checked and not flagged: `escalationKinds` is the model's declaration order
  (`model/ticket.qnt:171-174`) and `walledPoint` matches `resumeOf` arm for arm;
  the three evidence rosters are genuinely disjoint today, so
  `escalationEvidenceLabel`'s two guards are total; the `git grep` for `reason`,
  `resumeAt`, `executionBlockedBy`, `finalizationBlockedBy` and `lastSet` over
  `ui/chuggy-ui/app` and `test/ui` leaves only unrelated failure reasons and
  `WallFacts.lastSet`, which the rework stage line still needs; dropping
  `ResumeOffer.NotRead` is safe because `TicketActions.tsx:485` draws the Resume
  control inside a `DataPanel` gated on the ticket read, so the unread state
  never reached it.
- Unsure, left as opinion: nothing asserts the three evidence rosters stay
  disjoint, and `escalationEvidenceLabel` would mislabel silently if
  `finalizationUnavailableKinds` ever gained a name the git roster holds
  (`test/adapters/sessionBearer.test.ts:159` is the precedent for pinning it).
  Also, `escalationDetailLine` now answers "Work cancelled" unconditionally, so a
  ticket parked by the continuation path before any work set spawned says a run
  was cancelled when none started — still strictly better than the `lastSet`
  derivation it replaces, which named the wrong phase outright.
- Practice invoked: `comments-describe-the-code` (its test — a reader with no
  knowledge of how the code came to exist finds the comment intelligible — is
  what finding 2 fails).
