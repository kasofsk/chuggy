# Task B — the finalizer reports Unavailable (report)

Tip `8a4cd92d` on `model/finalization-unavailable`, five commits off `1f281d9c`.
Not pushed.

## Per layer

- **`src/contract/`** — `finalizationUnavailableKinds` (the thirteen, in 007's
  order) and `FinalizationUnavailableKind` beside `blockedReasons`; the five
  left out are named in its doc with the reason each stays a hold. The wire
  owns the list outright as `notificationKinds` is owned there, and the
  interpreter imports it, so contract never reaches into the interpreter.
  `ticketResponseSchema` gains `finalizationBlockedBy` optional.
  `escalationReasons` already had the reason from A.
- **`src/interpreter/finalizer.ts`** — `FinalizationConclusion` gains the third
  arm carrying an unavailable kind; `FinalizationHoldRecord`/`FinalizationHeld`
  and `FinalizerStore.recordHold`; `FinalizerConfig.holdPassesMax` with its
  default. `FinalizationHoldKind` still the eighteen.
- **`src/interpreter/finalizerRun.ts`** — `finalizerHold` also writes the
  reason of the request in flight onto the tally; `finalizerAdvance` clears it
  per request, delegates the switch to a new `finalizerAdvanceDecided`, and
  ends by recording. `finalizerSubmit` is the shared submission (telemetry +
  tally), `finalizerConclude` builds the offer from a view, and
  `finalizerRecordHold` does the record and the dwell. The pass report is now
  built field by field so the reason cannot ride out on it, and
  `finalizerCeilingReached` takes `FinalizerCeiling` (the tally's keys less the
  reason).
- **`src/interpreter/finalizerSettings.ts`** — `CHUG_FINALIZER_HOLD_PASSES_MAX`
  beside its siblings; `finalizerSettingsProposals` split out for the length
  cap.
- **`src/adapters/postgres/finalizer.ts`** — `finalizerRecordHold` over S's
  function; `finalizerFailureKindOf`, an exhaustive switch, replaces the single
  `=== "FinalizationNeedsWork"` equality for the door's one evidence slot.
- **`src/adapters/postgres/readiness.ts`** — no code change: the NeedsWork gate
  already answers `undefined` for the new outcome, which is right. **Evidence is
  nothing, not the hold kind** — `FinalizationEvidence` is the attempt and its
  bundle, an unavailable result prepared no attempt, and the kind is on the
  request where the desk reads it, so nothing a decision carries needs it. The
  doc said "the only submission that names no attempt"; there are now two.
- **`src/adapters/postgres/nativeReads.ts`** — `finalizationBlockedBy`
  narrowing beside `executionBlockedBy`; `readTicket` split so the query lives
  in `readTicketRow` (length cap).
- **`src/interpreter/nativeWeb.ts`** — `TicketResource.finalizationBlockedBy`.
- **Telemetry** — untouched. `conclusion(outcome, …)` is typed by the roster,
  so the third outcome is counted already; holds count as before.

## The dwell

Every pass over one claimed request ends by calling `recordHold` with the kind
where it ended at one of the thirteen, with no kind where it moved, and not at
all where it ended at a hold off the roster (neither counting nor clearing) or
where it reached a result (the request is answered and its columns are the
evidence). When the returned count reaches `holdPassesMax` the same advance
submits `FinalizationResultUnavailable` at that kind, naming no attempt.

`holdPassesMax` default **10**, settable as
`CHUG_FINALIZER_HOLD_PASSES_MAX`. It is passes, not time: nothing in the
finalizer reads a clock, and a held request is redrawn once its claim lease
lapses, so `requestClaimLeaseSecs` (30) is what the dwell is as long as.

## The query

```sql
(SELECT f.hold_kind FROM finalization_request f
  WHERE f.tenant=t.tenant AND f.project=t.project AND f.ticket=t.ticket
    AND t.reason='FinalizationUnavailableEscalated'
  ORDER BY f.authorizing_seq DESC LIMIT 1) AS finalization_blocked_by
```

Inside the single ticket read, `check-queries` clean; the `chuggy_api` grant S
wrote covers every column it touches.

## The port method

`recordHold(record: FinalizationHoldRecord): Promise<FinalizationHeld>` —
`{ claim, kind? }` in, `{ held: "Recorded", passes } | { held:
"UnknownRequest" } | { held: "BindingMismatch" }` out. In the postgres adapter
and in `test/interpreter/finalizerRun.test.ts`'s recorder, which keeps the
count the durable authority keeps.

## Tests

`test/interpreter/finalizerRun.test.ts` — four cases: the dwell reached and
submitted, a moving pass clearing the count, a hold off the roster never
recorded, and a hold off the roster leaving another kind's count alone.
`test/contract/rosters.test.ts` — subset and complement.
`test/contract/responses.test.ts` — the fullest ticket carries both walls.
`test/postgres/finalizerUnavailable.test.ts` (new) — counting and clearing, the
claim fence (a successor takes the claim; the previous generation records
nothing), the door admitting only the recorded kind, and the escalated ticket
read back under `chuggy_api` with reason, `finalizationBlockedBy` and
`resumeAt`. `test/postgres/migration.test.ts` — the roster tie-back S left me,
inside its own roster case.

## Outside my layers

None. No edit to `model/`, `src/domain/`, `src/actor/`, migrations or `ui/`.

## Gates on the tip

| gate | exit |
|---|---|
| `check-source` | 0 — 6 stages, unit 208 suites |
| `check-boundaries` | 0 — 1058 modules |
| `check-queries` | 0 |
| `check-conformance` | 0 — 10 goldens, 226 steps |
| `check-figures` | 0 |
| `check-comments` | 0 |
| `check-paths` | 0 |
| `check-postgres` | 0 — 76 suites |

`check-console` is still red on Task C's arms (A's report lists them).

## Notes on GOAL.md

- **"`finalizerHold` calls it with the kind"** is not where it landed. That
  function is synchronous, holds no claim, and is called from thirty sites
  including ones with no request in hand. The record is written at the end of
  `finalizerAdvance`, which is the only place that holds a claim and knows the
  pass is over; `finalizerHold` carries the reason up to it.
- GOAL says "every non-held conclusion of a pass calls it with null". A pass
  that **reached a result** calls nothing: clearing after an unavailable
  submission would wipe the evidence GOAL itself says the fulfilled request
  keeps, and the door fences on that column being set.
- The wire needed no edit (survey §5 was right). The command JSON's `kind` is
  not on `FinalizationSubmission`: nothing downstream reads it, the actor's
  event carries the outcome alone, and the desk reads the kind off the request.
- Two headers were saying a finalizer's report is always conclusive —
  `finalizer.ts`'s own and `ticketCommand.ts`'s envelope doc. Both corrected in
  their own commit.
