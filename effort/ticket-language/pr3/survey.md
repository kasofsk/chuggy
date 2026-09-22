# Rename survey (Explore agent, 2026-09-21, worktree three-deletions @ d3a66d0f)

Layout: model `model/*.qnt`; mirrored TS `src/domain/generated/modelTypes.ts` + `src/generated/model-api.ts`, both emitted by `scripts/generate-model-api.ts` from `model/api.qnt` (`check-model-api.sh --check`); migrations are TypeScript under `src/adapters/postgres/schema/migrations/` (001–005 + `baseline/*`), next is **006**; goldens `test/golden/*.itf.json` + `manifest.json` via `.chug/tasks/emit-goldens.sh`; decision semantics `src/actor/decisionSemantics.ts` current **4**.

Files carrying a renamed literal: 168 (190 with `Core`; ~200 with `images/worker/*.mjs` for Verdict).

## Per literal

- **Phases** Working/Evaluating/Finalizing: sum constructors `model/ticket.qnt:50-51`; TS union `Phase` + `phaseTags`; CHECKs `ticket_projection_phase_is_known`, `project_continuation_expected_phase_check` (restated `003-no-handoff.ts:417-421`); `'Finalizing'` inside `submit_finalization_result` (`005:219-281`); data in `ticket_projection.phase`, `project_continuation.expected_phase`, `journal_entry.entry` JSON `rec.transitions[].from/to`. Console switch arms: `tones.ts:43-49`, `ticketSections.ts:44-50`, `codeLabels.ts:115-120`, `resumePoint.ts:98-104`, `ticketActions.ts:30`, `ticketPageFacts.ts:57`. Totals 365/166/113 hits.
- **FinalizationFailed→FinalizationNeedsWork**: `ticket.qnt:165`; in `decision_event_is_valid`, `ticket_command_is_valid`, `public_ticket_command_is_valid`, `submit_finalization_result` (`in_outcome` RPC argument), `accept_operation`; `src/interpreter/finalizer.ts` ×4; 60 hits.
- **Core→TicketGraph**: `ticket.qnt:259`, `api.qnt:31` (`ApiCore`), `src/domain/core.ts` (37 import specifiers), `decodeCore/encodeCore/coreSchema`; 273 identifier hits / 53 files; ~988 lowercase `core` params.
- **ReleaseTicket→CreateTicket**: `refinement.qnt:272-291`; `decisionEventTags`; `src/actor/decisionEvent.ts`; `ticketCommand.ts`, `wire.ts:223`; `postgres/nativeReads.ts`, `decision.ts`, `journal.ts`; SQL reads `command->'event'->>'type'` in `decision_event_is_valid` etc. and the partial index `journal_entry_release_ticket` (`baseline/constraints.ts:333`); 60 hits.
- **Verdict Pass/Fail**: `ticket.qnt:108`; `rosters.ts:148 resultVerdicts`; `resultManifest.ts:578,658,688,697` casts the worker's string; CHECK `execution_result_verdict_is_known`; **`images/worker/result.mjs`, `checks.mjs`, `entrypoint.mjs` emit it — digest-attested manifest v1..v3**.
- **Stage→StageDefinition**: record alias `ticket.qnt:116`, `api.qnt:19`; no golden tag; 26 UI hits are display copy, not the type.
- **Effects** (plain strings in `StepRecord.effects`, hand-written in `src/domain/effect.ts`): map to DB kinds `SpawnWork`/`SpawnEvaluation` at `decisionPlan.ts:134`; `RunFinalizer`/`CancelTicketWork` embedded in PKs `"{seq}:{position}:{kind}"` (`decisionPlan.ts:48-49`); `OpenHumanTask` materialises `native_action` and effect positions are stored (`effect_position`).
- **Reasons**: `ticket.qnt:150-154`; `rosters.ts:32-40 escalationReasons`; CHECKs `execution_blocked_reason_is_known`, `native_action_reason_check`, `ticket_projection_reason_is_known`; `decision_event_is_valid`, `submit_execution_outcome`. The five walls are `ExecutionPolicyDenied`, `TicketConfigIncompatible`, `ExecutionProfileUnavailable`, `RuntimeVersionUnsupported`, `RequiredCapabilityUnavailable`; produced by `kubernetes/clusterReach.ts`, `workerPod.ts`, `sessionPod.ts`, `supplied/schedulerPorts.ts`; `BlockedReason = Extract<Reason,…>` in `executionScheduler.ts:604-621`. **Evidence home exists: `execution.blocked_reason`** (paired with `outcome='Blocked'`); no evidence field beside `ticket_projection.reason` / `native_action.reason` / wire `reason`.
- **Decision semantics**: corrections read whole rows and match `"Finalizing"`, `"Escalated"`, `"ReworkBudgetExhausted"`, labels `ticket-done`/`ticket-revoked`; `journal_entry.event_schema_version` hard-pinned to 1 (`postgres/journal.ts:122`); fixtures `test/actor/journalAtSemanticsOne*.json` are frozen old rows.
- Outside wire/console: only Verdict (worker image). MCP tool names carry no literal. Selector prompts none.

## Surprises

1. `Working→Work`, `Evaluating→Evaluation` **collide with `type TaskKind = Work | Evaluation(int)`** in the same Quint module (`ticket.qnt:67`); also `executionTaskKinds`, `execution_request_task.kind`, `codeLabels.ts:83-85`, and golden tags.
2. `Resume` names (`ResumeWorking`…`ResumeFinalizing`) are phase-named and not in the list.
3. `decisionSemantics.ts` corrections are keyed on renamed spellings.
4. Journal JSON rename is a byte-format change; entries are digest-chained and immutable.
5. Durable PKs embed effect names.
6. Dropping `OpenHumanTask` shifts effect positions.
7. DB already has decoupled effect kinds `SpawnWork`/`SpawnEvaluation`.
8. Verdict is the untrusted worker's hashed wire format.
9. `ConversationWorkCard.tsx:140` returns the word "Working" as copy; `Stage` table headers are copy.
10. `model/api.qnt` aliases name the generated TS types.
11. Golden manifest invariants and snake-case step labels (`ticket-escalated work_failed`, …) contain the literals; `coverage.test.ts` regenerates the label roster from `domain.qnt`.
12. Baseline migration files are frozen; 006 restates.
13. Kubernetes adapters produce the wall reasons directly.
14. `FinalizationNeedsWork` is an RPC argument to `submit_finalization_result`.
