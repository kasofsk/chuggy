# Task C report — the rename in the console

Tip `14048917` on `model/rename`, one commit off B's `23a3f93e`.

## Files

`ui/chuggy-ui/app/core/{tones,ticketSections,codeLabels,codeSentences,
resumePoint,ticketActions}.ts`, `ui/chuggy-ui/app/browser/ticket/
{ticketPageFacts,TicketSituation}.tsx`, and the fixtures across
`ui/chuggy-ui/test/` that construct a `TicketResponse`/`ClosedSet`/
`ResumePoint` at the old spellings — 33 test files in all, found by
grepping every literal the model's table renamed, not only the ones
`tsc` flagged (a fixture typed loosely enough to dodge the compiler
still fails at runtime, `ticketResponseSchema` refusing an unknown
enum member). `inboxUnion.ts` named in the brief carried none of the
renamed literals; left untouched.

## Judgment calls

- **`phaseLabel` stops being an identity function.** The three
  in-progress phases are `Work`/`Evaluation`/`Finalization` now, but
  the brief is explicit that "Working" for phase `Work` is a product
  choice already made and not reopened. Since `phaseLabel` previously
  returned the phase string verbatim, it now has an explicit three-arm
  mapping back to the old gerunds, everything else still identity.
  Confirmed against `test/ticketPageLedger.test.tsx`'s and
  `test/projectTableLabels.test.tsx`'s existing `getByText("Working"/
  "Evaluating")` assertions, which needed no change once the fixture's
  `phase` field became the new spelling.
- **The five wall reasons collapse to one `escalationReasonLabel`/
  `escalationReasonSentence`/`escalationBadgeLabel` arm** each
  (`WorkExecutionUnavailableEscalated` → "Execution unavailable" /
  "the platform could not run this ticket's contract" / "execution
  unavailable"), and the wall's own word moves to a new
  `blockedReasonLabel(BlockedReason)` in `codeLabels.ts`, reusing the
  five old label strings verbatim. `TicketSituation.tsx`'s notice now
  draws `escalationDetail(reason, ticket.executionBlockedBy)` — the
  wall's own label when the field is present, the reason's generic
  word otherwise (the continuation-parked path B filed with no
  execution row to read it off). This is the one file outside the
  brief's named list I touched, because it is where "beside the
  escalation" has to render.
- Raw, untranslated `phase`/`reason` fields shown as accessibility text
  or `@mention` descriptions (`TicketReference.tsx`, `conversationMention.ts`)
  were left as identity — they draw the wire's own word, not a copy
  label — so their fixtures/assertions moved from "Working" to "Work"
  rather than staying "Working".
- `ConversationWorkCard.tsx:140` and `shellNav.test.ts`'s `leadStanding`
  word are unrelated "Working" copy (session/lead state, not
  `TicketPhase`); left alone per the brief and confirmed by reading
  both call sites.

## Gates

`npm ci` needed at both `ui/chuggy-ui/` (stale) and the repo root
(prettier binary missing, package-lock unchanged — a pre-existing
could-not-run, not caused by this change). After that:

- `check-console.sh`: clean, 5/5 scripts (format, typecheck, lint,
  test, build).
- `check-source.sh`: clean, 6/6 stages; `typecheck` and `unit` — the
  two B left red — are green.
- Root bridge suites `test/ui/resumePoint.test.ts` and
  `test/ui/ticketActions.test.ts`: 9/9 pass, no name maps left (B had
  already deleted them and pointed the fixtures at the new spellings).
- `ui/chuggy-ui`'s own vitest: 118 files, 1290 tests, all pass.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
