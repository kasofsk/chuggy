# Task C — report

Tip `8c72995a` on `model/escalation-sum`, two commits over `dc111b8b` (A+S+B).

## Files changed
`ui/chuggy-ui/app/{core/codeLabels,core/codeSentences,core/ticketSections,
core/resumePoint,core/ticketActions,core/projectTableRows,browser/Inbox,
browser/ticket/TicketSituation,browser/ticket/ticketPageFacts}.ts(x)`; 15
tests under `ui/chuggy-ui/test/` and `test/ui/{resumePoint,ticketActions}.test.ts`.

## New labels (verbatim)
- `escalationKindLabel`/badge/sentence for `EvaluationBlockedEscalated`:
  `"Evaluation blocked"`, `"evaluation blocked"`,
  `"the platform could not run this ticket's evaluation"`
- `escalationDetailLine("EvaluationBlockedEscalated", …)` → `"Evaluation cancelled"`
- `gitEvidenceLabel`: `RemoteUnreachable`→`"Remote unreachable"`,
  `RemoteDenied`→`"Remote denied"`, `RefUnreadable`→`"Ref unreadable"`,
  `ObjectMissing`→`"Object missing"`, `IntegrationFailed`→`"Integration failed"`,
  `PromotionTimedOut`→`"Promotion timed out"`

## Changed / deleted
One switch on `escalation.kind` draws label/sentence/badge everywhere;
`escalation.evidence` draws the wall line via new `escalationEvidenceLabel`
(tells the three evidence rosters apart like the interpreter does);
`escalation.resumeAt` read straight off the ticket. `resumePoint.ts` shrinks
to the `walledPoint` switch alone. Deleted: `EscalationReason`/
`escalationReasons` (now `EscalationKind`/`escalationKinds`); `interruptedPoint`,
the `resumeAt` override, `ResumeSituation.lastSet`/`.resumeAt`; `ResumeOffer`'s
`NotRead` arm, its producer `resumeBeforeDraft`, `resumeNotReadReason`; two
`NotRead` cases in `ticketPageLedger.test.tsx`; the domain-oracle case for "a
park with no modeled resume," unconstructible now that `retryableIn` is
`hasOpenHumanTask` and every variant resumes somewhere.

## Outside my layers
None forced.

## Gates on the tip
`check-console` **0** (5 scripts, 1292 unit tests); `check-console-sheets`
**0**; `check-source` **1** — typecheck/browser/format/unit clean, sole lint
finding is `test/postgres/nativeReads.test.ts:376` (function-length cap),
present unmodified at B's tip already, outside this task's scope;
`check-figures` **0**; `check-comments` **0**; `check-paths` **0**.
