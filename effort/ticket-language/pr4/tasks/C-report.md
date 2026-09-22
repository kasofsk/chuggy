# Task C — the new reason in the console (report)

Tip `344d443b` on `model/finalization-unavailable`, one commit off B's
`8a4cd92d`. Not pushed.

## Files

- `ui/chuggy-ui/app/core/codeLabels.ts` — `escalationReasonLabel` and
  `escalationDetailLine` each gain the fourth arm (both were still red on
  typecheck/lint, beyond the two survey §8 named); new
  `finalizationUnavailableKindLabel`, one noun per `finalizationUnavailableKinds`
  member, beside `blockedReasonLabel`; `escalationDetail` takes a third
  parameter, `finalizationBlockedBy`, and reads whichever wall the ticket read
  carries (`blockedBy` first, then `finalizationBlockedBy`, then the reason's
  own word — the two walls are never both present, so order does not matter in
  practice, but `blockedBy` was there first).
- `ui/chuggy-ui/app/core/ticketSections.ts` — `escalationBadgeLabel` gains the
  fourth arm, `"finalization unavailable"`.
- `ui/chuggy-ui/app/core/ticketActions.ts` — `resumeSentence`'s `===` fallback
  became an exhaustive switch: `FinalizationUnavailableEscalated` and
  `WorkFailureEscalated` get their own arm to the same sentence
  `EvaluationFailureEscalated`'s neighbor already returned, so a fifth reason
  breaks compilation here too (survey §8's silent-fallback finding).
- `ui/chuggy-ui/app/browser/ticket/TicketSituation.tsx` — passes
  `props.ticket.finalizationBlockedBy` as `escalationDetail`'s third argument.
- `ui/chuggy-ui/test/codeLabels.test.ts`, `test/ticketSections.test.ts`,
  `test/resumePoint.test.ts` — the copy-budget case, `escalationDetail`, the
  compile-time badge record and the runtime resume-point array each follow.

`codeSentences.ts`'s placeholder sentence and `resumePoint.ts`'s `walledPoint`
arm, both left by A, read correctly as they stood — no diff to either.

## Judgment calls

- **`finalizationUnavailableKindLabel` naming and the thirteen labels.** No
  name was specified; I paired it with `blockedReasonLabel` the way the type
  pairs with `BlockedReason`. The thirteen are close de-camelcasings of the
  hold kinds (`"Repository unbound"`, `"Proposal denied"`, …) — GOAL.md gives
  no product vocabulary for them beyond the kind names themselves, and a
  reader who hits one is already at an operational edge case; a truer label
  would need product copy nobody has written yet.
- **`escalationDetailLine`'s fourth arm returns `undefined`.** That function's
  `WallFacts` (`lastSet`, `stageCount`) is Work/Evaluation set data; a
  finalization hold has no such set, so there is no second line to draw from
  facts the page holds — consistent with the doc comment's "absent where
  those facts are not on the page rather than guessed at." This arm was not
  named in the brief's file list but was a second compile/lint red in
  `codeLabels.ts` beyond `escalationReasonLabel`.
- **Left `codeSentences.ts` and `resumePoint.ts` untouched.** Both already had
  correct arms from A's compile-fix commit (`fbdb7b6f`) — the resume point is
  `ResumeFinalization` unconditionally (matches GOAL.md), and the sentence
  "the platform could not finalize this ticket" already matches its siblings'
  voice and passes the distinctness/no-code-substring test. I treated "yours
  to finish" as "yours to judge," not "yours to necessarily change."
- **Kept `escalationDetail`'s fallback order `blockedBy` then
  `finalizationBlockedBy`** rather than branching on `reason` first — the two
  wall fields are mutually exclusive by construction (each present only for
  its own reason), so reading it as "whichever wall exists" is simpler and
  doesn't need the function to re-derive which reason implies which field.

## check-console

Clean: `check-console: 5 script(s) clean across 1 built console(s)` (format,
typecheck, lint, test, build), on `model/finalization-unavailable` at
`344d443b`. Also ran `check-comments.sh` (clean, 909 files) given the new
doc comments.
