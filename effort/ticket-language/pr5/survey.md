# PR 5 survey — Escalated is a sum (chuggy main bd63df14, 2026-09-21)

Read-only, against the plan table's PR 5 row and the package's `ticket.qnt`.
PR 4 merged as #725 while this survey ran, so main **is** PR 4's tip
(`bd63df14` = `d4915f66`); paths below are under `/home/geoff/claude/chuggy`.

## Surprises

1. **There is nothing to put in the variants.** Every package payload names a
   type chuggy lacks: `WorkEscalation{resumeInput, source, evidence}` needs
   `WorkInput` (PR 6), `EvaluationFailureEscalation.evidence` needs
   `EvaluationReworkEntry` (PR 7), `FinalizationEscalation.finalization` needs
   `FinalizationOperation` (PR 7/8). chuggy's `Escalation` lands as four
   **nullary** constructors — today's `Reason` minus `NoReason` — so the field
   this PR deletes is `resumeAt` and `reason` is renamed, not removed. The plan
   row reads as if two columns collapse into a richer one.
2. **One resume is not a function of the variant.** `decideExecutionBlocked`
   (`model/domain.qnt:545-551`) stamps `ResumeWork` or `ResumeEvaluation` off
   the phase it interrupted; the package has no such case, an interrupted
   evaluation being `EvaluationBlockedEscalated(EvaluationInstance)` (PR 7).
   Deriving resume needs either a payload `WorkEscalation` does not carry or the
   retained record's last set kind — which is what the console already does
   (`ui/chuggy-ui/app/core/resumePoint.ts:54-61 interruptedPoint`) and is the
   honest derive-don't-store.
3. **The console already derives resume from the reason.**
   `resumePoint.ts:64-88` answers `walledPoint(reason)` and consults the wire's
   `resumeAt` only as an override. Dropping `Resume` from the wire deletes that
   override and two of `ResumeSituation`'s five fields; "the console asks the
   escalation what resume does" is true today.
4. **A wipe does not free `rowAtCurrentVocabulary`.**
   `src/interpreter/wire.ts:347-356 storedSchedulerCompletion` runs it on
   **every** block the boundary writes, live, because `submit_task_completion`
   (baseline `functions.ts:3827-3832`, never replaced by a migration) builds its
   `ExecutionBlocked` out of `execution.blocked_reason` and so names one of the
   five walls. `currentVocabulary:117-121` is a permanent translation, not a
   correction. Only rewriting `submit_task_completion` in 008 lets the map die.
5. **A kept correction writes a state the sum cannot hold.**
   `src/actor/decisionSemantics.ts:328-365` parks cascaded dependents at
   `phase: "Escalated", reason: "NoReason", resumeAt: "NoResume"` — Escalated
   with no escalation, already contradicting `deskConsistent`
   (`src/domain/invariants.ts:85-90`, conformance-only, never asserted on the
   actor's path). Under the wipe, delete corrections 1–5 rather than give
   `Escalation` a hole.
6. **The finalization submission already carries its hold kind and nobody reads
   it.** `007-finalization-unavailable.ts:334-336` puts `kind` in the command
   JSON and `:183-187` makes it whole; `wire.ts:300-320
   checkedFinalizationSubmission` spreads it through unread. PR 5 can fill the
   finalization escalation's evidence off it with no boundary change.
7. **The evidence with no home is the continuation's, and it is a different
   roster.** `src/interpreter/projectWriter.ts:510-530` escalates
   `WorkExecutionUnavailableEscalated` and drops the `GitEvidence`; with no
   `execution` row, `nativeReads.ts:561-566`'s correlated read answers null and
   the desk says "unavailable" with no wall. `blockedReasons` and `GitEvidence`
   are disjoint, so one evidence slot must admit both.
8. **`project_continuation.expected_phase` is not in scope.** It pins a *phase*,
   written from `ticketAt(post, …).phase` (`decisionPlan.ts:387,400`) and
   compared at `projectWriter.ts:257`. It names `Escalated` and carries no
   reason and no resume. The brief's list has it; the tree does not.
9. **`retryableIn` collapses to `hasOpenHumanTask`.** `model/domain.qnt:240-242`
   and `src/domain/enablement.ts:44` are `Escalated && resumeAt != NoResume`;
   with every variant carrying a resume the conjunct is free. That reaches
   `decisionPlan.ts:188-190`, where the native action's resolutions are
   `["Resume","Revoke"]` or `["Revoke"]` — after this PR always both.
10. **A jsonb column buys nothing unless the evidence moves in.** With
    payload-free variants, replacing `reason` + `resume_at` is one `text` column
    and one CHECK. Decide surprises 4/6/7 first; the column type follows.
11. **No new step label, but every golden is re-emitted.** The escalate labels
    are the reason names in snake case and none moves, so `corpus.ts
    declaredLabels`/`coverage.test.ts` need no new aimed trace — but all ten
    `test/golden/*.itf.json` carry `resumeAt` and `reason` per ticket
    (`src/generated/model-api.ts:311-344`).
12. **The stored-text memory names a column that does not exist.**
    `decision_input` has no `command` (`baseline/relations.ts:80-95`); it points
    at an `operation` or a continuation. The four are `journal_entry.entry`,
    `operation.command`, `draft_revision.authoring`,
    `selector_proposal_delivery.command`. And no index names `reason` or
    `resume_at` (`baseline/constraints.ts:334-336`), so 008 is CHECK, column and
    function work only.

## 1. The model

Today, `Resume` (`model/ticket.qnt:140-142`) and `Reason` (`:160-162`) are two
**fields of `Ticket`** (`:244`, `:248`), not payloads of `Phase` (`:50-51`,
flat, and the trace vocabulary via `Transition` `:281`). Sole writer `escalate`
`model/domain.qnt:344-348`, called at `:419`, `:475`, `:535`, `:551`; cleared at
release `:131-132`, revoke `:225`, resume `:569`. Read by `retryableIn`
`:240-242`, `decideResumeTicket`'s match `:573-582`, `deskConsistent`
`:914-917`. TS mirrors `src/domain/deciders.ts:72,114,137,386-388`,
`enablement.ts:44`, `invariants.ts:85-90`, `equality.ts:108`;
`model/refinement.qnt:281,316,355`; `model/api.qnt:21-22`.

Target: `type Escalation = NoEscalation | WorkFailureEscalated |
WorkExecutionUnavailableEscalated | EvaluationFailureEscalated |
FinalizationUnavailableEscalated`, one `Ticket.escalation` replacing both
fields, plus `pure def resumeOf(ticket): Resume`. `Resume` **stays** as derived
vocabulary; the stored field leaves. `Phase` stays flat: giving `Escalated` a
payload would change `Transition`, every golden, `ticket_projection.phase` and
`project_continuation.expected_phase` for a redundancy `deskConsistent` already
proves away, and there is no package `Phase` to converge on until PR 8.

Each package fact's chuggy home: `resumeInput`/`source` — nowhere (PR 6).
`WorkEscalation.evidence` — `execution.blocked_reason`, except on the
continuation path where the `GitEvidence` is dropped (surprise 7).
`EvaluationFailureEscalation.evidence` — the retained `record`
(`ticket.qnt:230-240`), not rework entries. `FinalizationEscalation.
finalization` — the `finalization_request` row (a new one per resume); its
`evidence` — `hold_kind` (007) and the submission's `kind` (surprise 6).

Diff against the package afterwards: the four constructor **names** match
`ticket.qnt:50-54`. Still differing — no `EvaluationBlockedEscalated` (PR 7);
every payload absent; `Escalated` a `Phase` constructor beside a field rather
than `TicketState.Escalated(Escalation)` (package `:64-70`); `isEscalated`
(`:260-262`) is `hasOpenHumanTask` (`ticket.qnt:267`); `decideResume`'s four
arms (`:584-621`) are `resumeOf` plus today's `decideResumeTicket`, chuggy's
resume respawning a task set where the package emits obligations.

## 2. Resume derived

Goes: `Ticket.resumeAt` and its writers/readers above;
`ticketResponseSchema.resumeAt` (`src/contract/responses.ts:240`) and
`nativeWeb.ts:288`; `projectionResume` and its use
(`src/adapters/postgres/nativeReads.ts:291-303, 313`); the `resume_at` column,
CHECK and grants; `TicketProjection.resumeAt`
(`src/interpreter/projectDecision.ts:129`, written `projectWriter.ts:153`,
upserted `src/adapters/postgres/decision.ts:201-208`). `resumePoints`
(`src/contract/rosters.ts:99-105`) leaves the ticket read but stays as the
derived roster the console names.

Stays: the `ResumeTicket` command; `decideResumeTicket`, switching on
`resumeOf(ticket)`. `resumePoint.ts`'s `walledPoint` becomes the whole module,
`interruptedPoint` moving into the model as the record-kind derivation
(surprise 2), so `ResumeSituation` loses `lastSet` and `resumeAt`.
`project_continuation.expected_phase` is untouched (surprise 8).

## 3. Schema — migration 008

Names `reason` or `resume_at`: `ticket_projection.reason` +
`ticket_projection_reason_is_known` (`007:96-97`), `.resume_at` +
`ticket_projection_resume_is_known` (`006:106`), two grants
(`baseline/privileges.ts:807-808`); `native_action.reason` +
`native_action_reason_check` (`007:99-100`, still carrying 005's settled
`DependencyRevoked` arm); `decision_event_is_valid`'s `ExecutionBlocked` list
(`007:132-136`, both vintages); `submit_task_completion`'s `in_reason` guard and
event build (`baseline/functions.ts:3812, 3827-3832`);
`request_finalization_approval`, which writes `'NoReason'` on its action row
(`baseline/functions.ts:3113-3118`). `submit_finalization_result` and
`record_finalization_hold` name neither; no index does (surprise 12);
`execution.blocked_reason` is evidence and stays.

008: drop `resume_at` with its CHECK and grants; replace
`ticket_projection.reason` with `escalation text NOT NULL DEFAULT
'NoEscalation'` (or `jsonb` iff the evidence moves in — decide 4/6/7 first),
CHECK over the five; the same on `native_action`, keeping the settled-row arm;
`decision_event_is_valid` admits one `ExecutionBlocked` escalation kind plus an
`evidence` string over `blockedReasons ∪ GitEvidence`; **rewrite
`submit_task_completion`** to build `{reason: 'WorkExecutionUnavailable-
Escalated', evidence: in_reason}` (surprise 4) — it is a boundary function and
006/007 replaced four of its siblings. `request_finalization_approval`'s
literal follows the rename.

The rig wipe. One `TRUNCATE` naming every table at once, so FK order is moot:
the journal and its ledger (`journal_entry, operation, decision_input,
project_continuation, project_readiness, project_change, project_notification,
thread_wake_cursor`), the desk and projection (`ticket_projection,
native_action(_resolution)`), authoring (`draft, draft_revision, draft_brief*`),
dispatch (`dispatch_candidate(_dependency), dispatch_view`), every `execution*`
and `input_bundle*` table plus `worker_artifact_reservation` and
`scheduler_incident`, every `finalization_*` plus `commit_permit`, every
`selector_*` but the two settings pairs, and `agent_session, session_attempt,
session_turn, session_store_batch`. Then **reset `project.head` to 0 and
`ingress_next`/`ticket_next`/`notification_next`/`manifest_next` to 1**
(`baseline/relations.ts:684-705`): truncating the journal without this leaves
the actor's head past an empty ledger. Keep `project` itself,
`configuration_revision`, `repository_configuration_version`/`_provenance`,
`project_repository(_bind_operation)`, `forge_installation`,
`installation_authority`, `deployment_authoring_policy`, the two selector
settings pairs, `worker_pool(_registration_token)`, `execution_cluster`,
`capacity_account`, `admitted_worker`, `recovery_epoch`.

## 4. Wire and console

Fold, yes: `reason` + `resumeAt` + `executionBlockedBy` +
`finalizationBlockedBy` (`src/contract/responses.ts:222-240`) become one
optional `escalation: { kind, evidence?, resumeAt }`. `escalationReasons`
(`rosters.ts:32-38`) becomes `escalationKinds` (four, no `NoEscalation`);
`blockedReasons` and `finalizationUnavailableKinds` stay as evidence rosters;
`resumePoints` stays, derived. `test/contract/rosters.test.ts:178,190,201,222`
follow. If the evidence lands on the projection, the two correlated subqueries
at `nativeReads.ts:561-572` and their row fields `:96-97` go.

Console surfaces drawing reason/resume/blocked-by (8 app files, 7 tests):
`app/core/codeLabels.ts:42-50, 56-95, 120-133, 312-404`,
`codeSentences.ts:27-36`, `ticketSections.ts:67-90`, `resumePoint.ts` (whole),
`ticketActions.ts:140-176`, `browser/ticket/TicketSituation.tsx:62-96`,
`browser/ticket/ticketPageFacts.ts:80-104`, `browser/Inbox.tsx:39,359`; tests
`codeLabels`, `codeSentences`, `resumePoint`, `ticketActions`,
`ticketSections`, `ticketAttempt`, `ticketPageLedger`. One escalation object
gives them a single switch: kind → label/sentence/badge/tone, evidence → the
wall line, `resumeAt` → the offer; `ResumeOffer`'s `NotRead` arm loses its only
producer (`ticketPageFacts.ts:85-89`) once every read carries the point.

## 5. Stored text

Four columns store a model event or record as opaque text (surprise 12):
`journal_entry.entry` (`rec` + `event`), `operation.command`,
`draft_revision.authoring` and `selector_proposal_delivery.command` (release and
dispatch only — neither names a reason or a resume). This PR changes the first
two: the `ExecutionBlocked` event gains an evidence field, its `rec` unchanged
(`escalate` writes no reason into the record — the transition is the whole of
it), and a `SubmitFinalizationResult` command keeps the `kind` 007 writes. Old
rows are wiped, so no lift.

`decisionSemantics.ts`: **delete** corrections 1–5 and their three fixtures
(`test/actor/journalAtSemanticsOne.json`, `…OneWalls.json`, `…Four.json`).
With the rig wiped, no row exists that any of them re-derives, and one of them
writes a state the new sum cannot hold (surprise 5); keeping a fixture whose
spellings the image no longer maps proves nothing. **Keep** the mechanism:
`journal_entry.decision_semantics_version`, `DecisionSemanticsVersion` = 6
alone, `isDecisionSemanticsVersion` admitting 6, `storedJournalLegalOn`
refusing 1–5. `rowAtCurrentVocabulary`/`eventAtCurrentVocabulary`/
`wordAtCurrentVocabulary`/`parseStoredDecisionEventText` **shrink to nothing and
go with them — but only if 008 rewrites `submit_task_completion`** (surprise 4);
otherwise `wordAtCurrentVocabulary` must keep the five wall entries forever as a
live boundary translation, and should then be renamed for what it is.

## Sizing

90 files name a reason literal, `resumeAt`/`resume_at` or a resume point:
model 6 · `src/domain` 4 · `src/actor` 2 · `src/interpreter` 3 · `src/adapters`
10 · `src/contract` 2 · `src/generated` 1 · `test` 42 · `ui/…/app` 6 ·
`ui/…/test` 14. Ten goldens re-emitted, no new one; one migration, one
boundary-function rewrite, no new step label, no fabric or worker change.
