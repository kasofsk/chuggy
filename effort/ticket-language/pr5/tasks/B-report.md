# Task B — report

Tip `dc111b8b` on `model/escalation-sum`, five commits over `d484bc3e` (A+S).

## What changed, by layer

- **`src/contract/`** — `escalationReasons` → `escalationKinds` (five); new
  `gitEvidences` roster (six, from the domain's `GitEvidence`), because the
  wire's evidence union needs it and nothing else named it;
  `ticketEscalationSchema = { kind, evidence?, resumeAt }` replaces `reason`,
  `resumeAt`, `executionBlockedBy` and `finalizationBlockedBy` on
  `ticketResponseSchema`.
- **`src/interpreter/`** — `TicketProjection` carries `escalation: Escalation`
  and `escalationEvidence?: string`; `NativeActionPlan.reason` →
  `escalation`; `projectionOf`/`projectionChanges`/`journaledPlan` take an
  optional `TicketEscalationEvidence` and refuse (`IntegrityContradiction`) a
  decision that carries evidence for a ticket it did not escalate;
  `decisionPlan.ts` offers both resolutions always; `nativeWeb.ts` gains
  `ticketEscalationResource(kind, evidence?)`, which derives `resumeAt` via
  `resumeOf` and throws on a kind that re-enters nowhere;
  `FinalizationSubmission` gains `kind?`, checked in `wire.ts:233` exactly when
  the outcome is `FinalizationResultUnavailable`.
- **`src/adapters/postgres/`** — the projection upsert writes the two columns
  and the desk insert writes `native_action.escalation`; `nativeReads.ts`
  selects `t.escalation, t.escalation_evidence` in all three reads and both
  correlated subqueries are gone, with `projectionEscalation` /
  `projectionEvidence` narrowing the two columns (an evidence value in none of
  the three rosters is a thrown read, there being no DB CHECK that could name
  one); `readiness.ts` joins the execution a completion settled.

## Where each evidence value comes from

- **Execution block** — `readiness.ts:538` LEFT JOINs `execution` on
  `completion_operation = decision_input.input_id` and hands the row's
  `blocked_reason` to the Operation source as `executionBlockedBy`
  (`readiness.ts:421-423`); `projectWriter.ts:570-575` puts it on the ticket the
  `ExecutionBlocked` event names.
- **Continuation path** — `projectWriter.ts:629`: a durable `GitEvidence` from
  `executionSources.observe` parks the continuation's ticket, and the same
  evidence is the escalation's.
- **Finalization unavailable** — `projectWriter.ts:580-585` reads the
  submission's `kind` off the accepted `SubmitFinalizationResult`
  (`ticketCommand.ts:185`).

## The wire

```json
{ "ticket": 5, "phase": "Escalated",
  "escalation": { "kind": "WorkExecutionUnavailableEscalated",
                  "evidence": "RefUnreadable", "resumeAt": "ResumeWork" } }
```
Absent on every non-Escalated ticket; `evidence` absent where the escalation
explains itself (a rework budget, a work failure).

## Outside my layers

- `008-escalation-sum.ts` — two GRANTs added
  (`SELECT(completion_operation)`, `SELECT(blocked_reason)` on `execution` to
  `chuggy_ticket_service`) plus a header paragraph for them, because the writer
  had no grant to read the wall it must put on the desk. Its sentence saying
  the *desk* reads the wall off the execution was corrected: the *writer* does.
- Nothing else. `src/domain/`, `src/actor/`, `model/`, `ui/` untouched.
- `schema/README.md` names none of the old fields; no edit needed.

## Reds left for C

`test/ui/resumePoint.test.ts`, `test/ui/ticketActions.test.ts`,
`ui/chuggy-ui/app/core/{resumePoint,ticketActions,codeSentences}.ts` — the only
typecheck, lint and unit failures on the tip. `check-console` not run.

## Gates on the tip

`check-source` **1** (typecheck, lint, unit — C's files only; the other three
stages pass); `check-boundaries` **0**; `check-queries` **0**;
`check-postgres` **0** (76 suites); `check-conformance` **0** (11 goldens, 235
steps); `check-figures` **0**; `check-comments` **0**; `check-paths` **0**.

The gate's non-termination was gone once the projection insert stopped failing;
the harness needed no fix. `workerCatalog.test.ts`'s "a republication moves
published_at forward" went red once and passed alone and in the clean full run
— a clock-resolution flake, not this branch's.

## What GOAL.md got wrong

- "the writer fills the evidence from what the interpreter already holds" — it
  did not hold the wall after 008 took it off the event, and had no grant to
  read it. The join and the two GRANTs above are the cost.
- Four `journal.test.ts` cases and one `readiness.test.ts` case stood on
  semantics 1–2 and on retired event tags, which A's deletion of the
  corrections and the vocabulary map made unreachable; the sequence listed no
  postgres work for A, so they surfaced here.
- A row with a retired *field* (`ExecutionBlocked{ticket,reason}`) now parses
  rather than being refused — zod strips unknown keys, and only a retired
  *tag* is unreadable. Harmless under the wipe, but it is not what the survey
  assumed.
