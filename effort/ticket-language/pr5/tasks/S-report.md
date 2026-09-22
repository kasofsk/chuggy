# Task S — migration 008, the boundary rewrite, the wipe

Tip `de43ec16` on `schema/escalation-sum`, four commits off `bd63df14`, not pushed. New `migrations/008-escalation-sum.ts` and `deploy/rig/wipe-tickets.sql`; edited `migrations/index.ts` and `test/postgres/migration.test.ts`. Render-diff of 001–007, main vs branch: empty. `schema/README.md` needed nothing — its `ReleaseTicket` sentence is about `public_ticket_command_is_valid`, untouched here.

## 008's statements, in order

1. `DO` guard, raising if any `journal_entry` row exists and naming the wipe. The header argues it: 006 could rename because its map was total, but here the block's reason has no field to land in and the resume is derived, so there is no map at all — an image that replays nothing older would come up holding a ticket it cannot replay under a schema that looks migrated.
2. `ticket_projection`, one ALTER: drops `ticket_projection_reason_is_known` and `..._resume_is_known`, drops `reason` and `resume_at`, adds `escalation text DEFAULT 'NoEscalation' NOT NULL` and `escalation_evidence text`, adds `ticket_projection_escalation_is_known` (the six in GOAL's order) and `ticket_projection_evidence_needs_an_escalation` (`escalation <> 'NoEscalation' OR escalation_evidence IS NULL`).
3. Four grants: `SELECT` to `chuggy_api`, `UPDATE` to `chuggy_ticket_service`, on each new column — what `reason` held at `baseline/privileges.ts:805-806`.
4. `native_action`: drop `native_action_reason_check`, `RENAME COLUMN reason TO escalation`, add `native_action_escalation_check` — the six plus the settled-row `DependencyRevoked` arm 005 kept.
5. `decision_event_is_valid` whole: `ExecutionBlocked` admits `{ticket}` alone; `ReleaseTicket` and `FinalizationFailed` leave, argued in the header — behind an empty journal there is no stored spelling left to admit.
6. `submit_task_completion` whole (below).
7. `request_finalization_approval` whole: the INSERT names `escalation`, writes `'NoEscalation'`.

## The `submit_task_completion` diff

One expression: the envelope is `jsonb_build_object('ticket', bound.ticket)` where it was `jsonb_build_object('ticket', bound.ticket, 'reason', in_reason)`. Nothing else in the body moves — the signature still takes `in_reason`, the binding check still refuses one off the five-wall roster, and the `TaskDone` arm, the mailbox check, the ordinal, the operation, the decision input, the readiness bump and `UPDATE execution … SET blocked_reason = in_reason` are byte-identical to the baseline's. What it journals is `{"type":"ExecutionBlocked","value":{"ticket":N}}`, A's `modelTypes.ts:171-173`.

## The wipe, and four corrections to survey §3

One `TRUNCATE … RESTART IDENTITY` over fifty-four relations, the file being the list: `agent_session`, `commit_permit`, `decision_input`, the three `dispatch_*`, the six `draft*`, every `execution*` but `execution_cluster`, the four `finalization_*`, both `input_bundle*`, `journal_entry`, `native_action` and its resolutions, `operation`, `project_change`, `project_continuation`, `project_notification`, `project_readiness`, `scheduler_incident`, every `selector_*` but the settings pairs and the two seeded singletons, the three `session_*`, `ticket_projection`, `worker_artifact_reservation`. Then `project.head = 0` with the four counters to 1 (`baseline/relations.ts:684-705`), then `thread_wake_cursor.sequence = 0`. No CASCADE, so a relation pointing at a wiped one and not named fails the statement rather than being emptied behind the operator; I checked every FK pair in `constraints.ts` and no kept relation points at a wiped one.

- `execution_cluster` — "every `execution*`" takes it and the survey's own keep list names it. Kept.
- `thread_wake_cursor` — the survey wipes it, but it is a baseline-seeded singleton and no role holds INSERT (`privileges.ts:791-793`), so a truncated one is a row nothing can put back. Kept, with its `sequence` reset instead — which the survey does not do and which `project_change`'s restarted identity makes necessary.
- `selector_inventory_state`, `selector_runtime_readiness` — same shape (`seed.ts:57-58`), and neither carries a ticket. Kept, untouched.
- `finalization_request_configuration` — "every `finalization_*`" would take it; 003 dropped the table.

`RESTART IDENTITY` is mine, not the survey's: `project_change.sequence` and three `selector_*` ordinals are identity columns, and restarting them is what makes a cursor at zero honest.

## Tests and red-proofs

Nine new cases in `test/postgres/migration.test.ts`: the ledger row; the guard refusing and naming the wipe, with the row it refused over untouched; the projection's roster, default and dropped columns; evidence only beside an escalation, plus the four grants; the desk's roster and its settled arm; the events the boundary admits and the two spellings it retired; the scheduler's door (an escalation as `in_reason` is a `BindingMismatch`, the wall is `Submitted`, the event carries the ticket alone, the wall still lands on the execution); the approval door's task at `NoEscalation`; the wipe. Twenty-three single mutations of 008 and of the SQL, each run against the case that owns it: all RED, no survivors (`scratchpad/redproof.py`). Eleven legacy cases that asserted an earlier migration's vocabulary now run against that migration's own schema through a new `installationAt`; the handoff case runs at 006 because its rows carry 006's spellings.

## Gates on the tip

`check-figures` 0, `check-comments` 0, `check-paths` 0, `check-source --static` 0, `check-duplication` 0. `check-queries` 1: five adapter queries name dropped columns — `src/adapters/postgres/decision.ts:201` (the projection upsert) and `:404` (the desk insert), `src/adapters/postgres/nativeReads.ts:450`, `:495`, `:543` (`t.reason`). Per the brief I edited neither file.

`check-postgres` 1, over 332 red cases. 328 are those columns named directly by `decision.ts:199`, one more (`isolation.test.ts:114`) is the same error caught as a value, and one (`leadHttpReads.test.ts:393`) is a sibling case in the same suite database left without its seed. Two are claims of their own and neither is a query: `privileges.test.ts:789` lists the desk columns the API is denied and still says `reason`, and `ticketProjection.test.ts:335` asserts `ticket_projection_resume_is_known`. Both are B's to repoint with the rest of that suite's fixtures, which name `reason` in an INSERT into `ticket_projection` or `native_action` in seven files (`finalizerApproval`, `finalizerBoundary`, `finalizerConstraints`, `nativeActionFixture`, `nativeReads`, `projectChange`, `ticketProjection`).

Two things about that run the next person needs. **The gate does not terminate on this tip.** `nativeReads.test.ts` and `readiness.test.ts` leave pooled clients `idle in transaction (aborted)` after the failed projection insert, so their processes never exit and the gate sat for twenty-five minutes past its last output; I killed the two and it then reported 1 promptly. **And there is one false green**: `privileges.test.ts:349` builds `ExecutionBlocked` with a `reason` to prove the door refuses a forged completion whatever authority it claims. 008's validator now refuses that text for its shape, so the case passes without testing its own subject. Dropping the field restores it.

## What B must know

- `ticket_projection.escalation` (`text NOT NULL DEFAULT 'NoEscalation'`), `ticket_projection.escalation_evidence` (`text`, nullable), `native_action.escalation`. Constraints: `ticket_projection_escalation_is_known`, `ticket_projection_evidence_needs_an_escalation`, `native_action_escalation_check`.
- Evidence is one-directional: an escalation may carry none; only evidence *without* an escalation is refused.
- The event is `{"type":"ExecutionBlocked","value":{"ticket":N}}`. `submit_task_completion`'s signature is unchanged, so the scheduler's write side needs nothing; what must go is `wire.ts:347` `storedSchedulerCompletion`'s lift, which now has nothing to translate.
- The postgres suite is yours to repoint past the five queries: seven files name `reason` in an INSERT into those two tables, two cases assert the retired names, and `privileges.test.ts:349` is the false green above — all listed in the gates section.
- `migration.test.ts`'s case "the baseline's index is what answers every read of a ticket's release" is red until `nativeReads.ts` lands — it drives `postgresNativeReads`, not SQL.
- Two the brief settled that a reviewer may re-ask: `DependencyRevoked` survives on `native_action` though the wipe leaves no settled row to reach it, and `'FinalizationFailed'` survives in `ticket_command_is_valid` and `submit_finalization_result`, both out of scope.
- Commit attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief names — this ran on Opus, as PR 4's S did.
