/**
 * The relations the PostgreSQL foundation owns, as the migrations that create
 * them.
 *
 * issue #180 requires five things of every
 * new mutable relation, so each one states them here rather than in a doc that
 * would drift from the DDL beside it.
 *
 * `recovery_epoch` — the global, unpredictable, never-reused epoch a restore
 * advances before it permits any mutation. Owned by the control plane; the
 * ticket-service role may read it and may not write it, because a runtime that
 * could mint an epoch could unfence itself. It has no project key by design:
 * it is global authority, and a per-project counter restored from the past is
 * exactly what it exists to defeat. Identity is the epoch text, unique, so a
 * replayed establish is refused rather than absorbed. It is changed by
 * `establishRecoveryEpoch` alone, appending one row. Unfinished work after a
 * restore is found by comparing the current epoch to the one every live lease
 * and journal entry carries.
 *
 * `project` — one authoritative lifecycle and ownership row per partition.
 * Owned by the control plane for insertion and by the ticket-service role for the
 * ownership columns, which is why the runtime is granted UPDATE and not
 * INSERT: provisioning is not a decision. Its composite key is
 * `(tenant, project)` and it is the parent every other relation here points
 * at. Ownership is changed by `acquire`, `renew`, `release` and `fence`, each
 * locking this row; the head is changed only by the decision transaction, in
 * the same transaction as the entry it counts. Unfinished work is found by selecting
 * active projects whose lease has expired by database time.
 *
 * `journal_entry` — the append-only decision log, partitioned by the composite
 * key it carries into its own primary key `(tenant, project, seq)`. The
 * ticket-service role is granted INSERT and SELECT and deliberately not UPDATE or
 * DELETE: a runtime that could rewrite history would make replay an opinion.
 * Its identity is that primary key, and `seq` is the project's head plus one,
 * so the identity and the concurrency control are the same value. It is
 * changed by the decision transaction and by nothing else. Unfinished work
 * does not exist for it — an entry is committed or it was rolled back — which
 * is the whole point of putting the head in the same transaction.
 *
 * WHY THE FENCE COLUMNS RIDE ON THE ENTRY. An entry records the owner, fencing
 * epoch and recovery epoch that authorized it, so a takeover or a restore can
 * be audited from the log rather than reconstructed from process memory. They
 * are not read back during replay: the domain event is the entry text, and
 * these are the envelope 006 keeps outside the pure event.
 *
 * THE DIGEST CHAIN IS STRUCTURAL AND ARRIVES NOW rather than when integrity
 * containment does, because 006 makes this the production format version one
 * and a chain added later is a migration over authoritative history.
 *
 * `project.ingress_next` — the per-project ingress counter, a column on the
 * lifecycle row rather than a relation of its own because 006 has acceptance
 * lock that row and allocate the ordinal in the same statement, and two rows
 * would be two locks with an order to get wrong. Owned by the API role, which
 * is granted UPDATE on this column and no other: allocating an ordinal is not
 * a licence to move the head, the owner or the lifecycle. It is changed by
 * acceptance alone, whose conditional UPDATE also decides admission, so a
 * lifecycle transition committing first leaves the counter untouched.
 *
 * `operation` — one accepted mutation, its authority, its idempotency scope
 * and its terminal state. Owned by the API role for insertion and, from the
 * decision transaction onward, by the project ticket writer for its outcome. Its
 * composite key is `(tenant, project)` and it points at
 * `project`; its identity is `(tenant, project, operation)` with the opaque
 * operation identity unique globally, because 006 mints those outside any
 * partition and a reused one would answer another project's poll. Its
 * idempotency key is `(tenant, project, authority_kind, key_digest)`, unique
 * and permanent, which is what makes a retry find its original rather than
 * create a second. It is changed by acceptance, by cancellation and by the
 * decision transaction, and a trigger refuses any later change at all to a row
 * already terminal. Unfinished work is found by selecting `Pending` operations
 * for a partition.
 *
 * WHY NO ROLE MAY WRITE A SETTLEMENT, BY EITHER VERB, AND CANCELLATION IS A
 * FUNCTION. 006 lets the API insert authorized operations and decide none of
 * them, and allows one narrowly constrained transaction to move a
 * still-pending operation to cancelled. A grant on the column is not that
 * constraint, and the hole has two halves. `UPDATE operation SET state =
 * 'Succeeded'` on a pending row satisfies every column-level grant a
 * cancellation needs, and the terminality trigger cannot refuse it because the
 * row it fires on is not yet terminal. A table-level `INSERT` is the same hole
 * spelled the other way: the settlement columns are columns like any other, no
 * CHECK refuses a row born `Succeeded`, and a `BEFORE UPDATE` trigger never
 * runs on an insert. So the API role holds no `UPDATE` on this relation at
 * all, its `INSERT` names the columns acceptance writes and not one more, and
 * cancellation is a `SECURITY DEFINER` function it is granted `EXECUTE` on — which also makes the transition, the settlement
 * columns and the inbox flag one call rather than three grants that only
 * together add up to a cancellation. A role-aware trigger would be the other
 * shape and it is broken in deployment: a service connects as a login role
 * that inherits `chuggy_api`, so `current_user` names the login role and the
 * check never fires.
 *
 * WHY THE IDEMPOTENCY TOMBSTONE IS THIS ROW AND NOT A SECOND ONE. The scope,
 * the key digest and the payload digest belong to exactly one operation, and
 * standing rule 3 rejects the copy a second relation would keep. 006 compacts
 * a terminal operation's command body while the tombstone survives, which is a
 * change to this row rather than a row that outlives its parent — and
 * `command` is `NOT NULL` until the slice that compacts one makes it nullable,
 * because weakening a constraint for a caller that does not exist yet is
 * reaching forward into that slice.
 *
 * `inbox_item` — the project's durable inbox, in the ordinal order acceptance
 * allocated. Owned by the API role for insertion and, through the cancellation
 * function alone, for making an item non-consumable, and by the ticket writer
 * role for the acknowledgement that does the same on the way out. Its composite key is `(tenant, project)`, its
 * identity is
 * `(tenant, project, ordinal)`, and its source key `(tenant, project,
 * operation)` is unique, which is the deduplication 006 requires before
 * ordinal allocation — every item I1 admits is an accepted operation's, and
 * a second source kind arrives with the slice that has one. It is changed by
 * acceptance, by cancellation and by the decision transaction. Unfinished work
 * is found by selecting
 * consumable items for a partition in ordinal order, which is also what
 * activation verifies the inbox with.
 *
 * `project_readiness` — the discovery index over that inbox, and the only
 * thing fleet discovery reads. Owned by the API role, whose grant covers
 * `ready` and `generation`, and by the ticket-service role, whose grant covers
 * `ready` alone — so the separation the server holds is by column, and which
 * direction either role may move a column it holds is this adapter's. Its
 * composite key and identity are both `(tenant, project)`. It is changed by
 * acceptance, which raises readiness and advances the generation, and by an
 * idle owner clearing it. Unfinished work is found by selecting the ready rows
 * across the fleet.
 *
 * WHY THE ROW IS NEVER DELETED AND THE GENERATION IS ONLY ADVANCED. Clearing
 * lowers a flag rather than removing the row, because a generation that
 * restarted at one would let an owner holding a stale one erase the wake-up
 * that reused it — the stale observation the generation exists to refuse. That
 * is a discipline every writer here keeps rather than a rule the server
 * applies, and the note beside `inboxGrants` says what the grant permits
 * instead.
 *
 * `journal_entry.cause_operation` — the one durable cause an entry names, with
 * its uniqueness over the partition. 006 lets a cause authorize at most one
 * effective journal decision, and that constraint is what prevents a second
 * entry when a commit whose result the writer never learned is retried. Every
 * cause this tree admits yet is an accepted operation's, so the column names the
 * operation rather than a kind and an identity; the typed cause kind arrives
 * with the slice that has a second one.
 *
 * `operation.outcome_code`, `operation.decided_seq`,
 * `operation.refused_head`, `operation.refused_lifecycle_generation` — what a
 * terminal operation says besides its state, and the columns the earlier
 * tranche deferred to the transaction that produces them. They are written by
 * the project ticket writer alone, in the decision transaction, and neither is a
 * duplicate of anything derivable: a client reads the sequence to read its own
 * write, and a writer resolving an ambiguous commit reads whichever of them
 * the recorded outcome carries.
 *
 * `ticket_projection` — the project-primary projection, one row per ticket,
 * carrying the sequence that produced it. Owned by the ticket-service role, which
 * is granted INSERT and UPDATE on the phase and the sequence and not on the
 * key. Its composite key is `(tenant, project)` and its identity is
 * `(tenant, project, ticket)`. It is changed by the decision transaction and
 * by nothing else, and it has no unfinished work of its own: it commits with
 * the entry that moved it, and it is rebuilt from the journal rather than
 * repaired.
 *
 * WHY A PROJECTION AT ALL, WHEN STANDING RULE 3 REJECTS A STORED DUPLICATE.
 * Because the fact it duplicates is derivable only by replaying a project
 * partition into memory, and 006 requires normal reads to use PostgreSQL
 * rather than enter the in-memory actor. It is explicitly not a second
 * semantic authority: nothing decides from it, and a disagreement between it
 * and a replay is the projection being wrong.
 *
 * WHY THE TICKET WRITER READS `operation` AT ALL. It decides one, so it reads the
 * command it carries and the state it is in; the read is table-wide because a
 * column-level SELECT makes every query name its columns and the row it may
 * not read is one this partition's own writer already holds the journal for.
 *
 * WHY THE TICKET WRITER MAY WRITE A SETTLEMENT WHERE THE API MAY NOT. The API
 * accepts work and decides none, so a grant that let it settle an operation
 * would be a grant to decide one — which is why cancellation is a function.
 * The `ProjectTicketWriter` is the single writer: settling an operation is its own
 * authority rather than a boundary it would be crossing, and a domain refusal
 * settles one with no journal entry to pair the write against, so there is no
 * pairing a constraint could enforce.
 *
 * WHY A TENURE CANNOT BE REINSTATED BY HAND. The ticket-service role needs UPDATE
 * on `owner`, `fencing_epoch` and `lease_expires_at` because any replica may
 * acquire a partition, and those columns are also what it takes
 * to write a fenced owner back into an active project (kasofsk/chuggy#115). A
 * grant cannot say which values a column may take, so the rule is the server's
 * own: the fencing epoch never moves backwards, and any update leaving a live
 * lease that is not the continuation of the live tenure already there must
 * advance it. Acquisition advances it, renewal continues one, release and
 * fencing leave none — so the adapter is unchanged and the composed statement
 * is refused.
 */

import {
  phaseTags,
  reasonTags,
  verdictTags,
} from "../../domain/generated/modelTypes.ts";
import {
  allAttemptStates,
  allBlockedReasons,
  allExecutionOutcomes,
  allExecutionStatuses,
  allSchedulerIncidentKinds,
  executionCapacityDefaults,
  executionSchedulerAuthorityKind,
  schedulerEvidenceCharsMax,
} from "../../interpreter/executionScheduler.ts";
import {
  allArtifactRoles,
  artifactBytesMax,
  artifactDigestChars,
  artifactPathCharsMax,
  manifestArtifactsMax,
  resultDigestFoldHexChars,
} from "../../interpreter/resultManifest.ts";
import { schedulerIdentityCharsMax } from "../../interpreter/schedulerIdentity.ts";
import {
  authorityCharsMax,
  operationCommandCharsMax,
  operationIdentityCharsMax,
} from "../../interpreter/operationInbox.ts";
import { allRefusalCodes } from "../../interpreter/projectDecision.ts";

/** One migration: the version that orders it, the name that reports it, and the statements it applies. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** The role every ticket-service runtime connects as. */
export const ticketServiceRole = "chuggy_ticket_service";

/** The role the authenticated API connects as, which accepts and cancels work and decides none of it. */
export const apiRole = "chuggy_api";
export const selectorServiceRole = "chuggy_selector_service";

/** Each server routine's name, stated once so the definition and its grants cannot drift; the exported ones are how the suites address them. */
export const cancellationFunction = "cancel_pending_operation";
export const acceptanceFunction = "accept_operation";
export const dispatchAcceptanceFunction = "accept_dispatch_operation";
export const continuationFunction = "publish_continuation";
const configurationCreateFunction = "create_configuration_revision";
const draftCreateFunction = "create_draft";
const draftReviseFunction = "revise_draft";
const draftDeleteFunction = "delete_draft";
const draftReleaseFunction = "release_draft_fenced";
export const notificationPublishFunction = "publish_project_notification";
export const boundaryOwnerRole = "chuggy_boundary_owner";

/** The role the execution scheduler connects as, which owns execution and capacity and decides no ticket. */
export const schedulerRole = "chuggy_scheduler";

/** The whole of a scheduler completion, named once so the grant, the adapter and the suite agree on it. */
export const completionFunction = "submit_task_completion";
export const activeWorkFunction = "project_active_work";
export const backlogFunction = "execution_backlog";
export const statusMoveFunction = "execution_status_move_is_legal";
export const digestFoldFunction = "result_digest_fold";
export const accountProvisionFunction = "project_draws_a_capacity_account";
export const accountIdentityFunction = "project_capacity_account";

/**
 * The account row a project draws on when nothing else has said otherwise,
 * written once so the backfill for the projects predating this migration and
 * the trigger for the ones after it cannot state two entitlements. An account
 * is not an identity axis, so the default one is named for the project drawing
 * on it and `ON CONFLICT DO NOTHING` means it is already provisioned rather
 * than that somebody else took the name.
 */
const capacityAccountDefaults = [
  `'${executionCapacityDefaults.cluster}'`,
  String(executionCapacityDefaults.accountReserved),
  String(executionCapacityDefaults.accountMaximum),
  "1",
].join(", ");

/** The ledger of applied migrations, which the runner creates before it reads anything. */
export const migrationLedger = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const foundationRelations = [
  `CREATE TABLE recovery_epoch (
     ordinal        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     epoch          text NOT NULL UNIQUE,
     established_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE project (
     tenant               text   NOT NULL,
     project              text   NOT NULL,
     lifecycle            text   NOT NULL,
     lifecycle_generation bigint NOT NULL DEFAULT 1,
     fencing_epoch        bigint NOT NULL DEFAULT 1,
     head                 bigint NOT NULL DEFAULT 0,
     owner                text,
     lease_expires_at     timestamptz,
     recovery_epoch       text REFERENCES recovery_epoch (epoch),
     PRIMARY KEY (tenant, project),
     CONSTRAINT project_lifecycle_is_known CHECK (
       lifecycle IN ('Active', 'Suspended', 'IntegrityBlocked', 'Deleting', 'Retention')
     ),
     CONSTRAINT project_counters_are_positive CHECK (
       lifecycle_generation >= 1 AND fencing_epoch >= 1 AND head >= 0
     ),
     CONSTRAINT project_ownership_is_whole CHECK (
       (owner IS NULL) = (lease_expires_at IS NULL)
       AND (owner IS NULL) = (recovery_epoch IS NULL)
     )
   )`,
  `CREATE TABLE journal_entry (
     tenant         text   NOT NULL,
     project        text   NOT NULL,
     seq            bigint NOT NULL,
     entry          text   NOT NULL,
     entry_digest   text   NOT NULL,
     prev_digest    text   NOT NULL,
     owner          text   NOT NULL,
     fencing_epoch  bigint NOT NULL,
     recovery_epoch text   NOT NULL REFERENCES recovery_epoch (epoch),
     committed_at   timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, seq),
     CONSTRAINT journal_entry_seq_is_positive CHECK (seq >= 1),
     CONSTRAINT journal_entry_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project)
   )`,
  `CREATE INDEX project_lease_expiry ON project (lease_expires_at)
     WHERE lifecycle = 'Active' AND owner IS NOT NULL`,
];

/**
 * What a runtime role may write, which is still wider than the fences over
 * it: the ownership columns and an INSERT let a direct table write install the
 * role as owner of a project another ticket writer holds, or place an entry at a
 * seq the primary key has not taken and move `head` to match, because the
 * fences that would refuse those — lease validity, epoch currency, expected
 * head, lifecycle admission — all live in this adapter. Closing it takes a
 * constraint in the database on what those columns may become rather than a
 * narrower grant on which of them may be written; kasofsk/chuggy#115 settled
 * that, and a later slice carries it.
 */
const foundationGrants = [
  `GRANT SELECT ON recovery_epoch TO ${ticketServiceRole}`,
  `GRANT SELECT ON project TO ${ticketServiceRole}`,
  `GRANT UPDATE (head, owner, lease_expires_at, recovery_epoch, fencing_epoch)
     ON project TO ${ticketServiceRole}`,
  `GRANT SELECT, INSERT ON journal_entry TO ${ticketServiceRole}`,
];

/**
 * Creates a runtime role if this cluster has never seen it. `CREATE ROLE` has
 * no `IF NOT EXISTS`, and a role is a cluster-wide object a sibling database
 * may already have made — so the test is a check-then-act that the
 * database-scoped migration lock cannot serialize, and the handler is what
 * absorbs the sibling that won.
 */
function roleStatement(role: string): string {
  return `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
      CREATE ROLE ${role} NOLOGIN;
    END IF;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END
  $$
`;
}

const inboxRelations = [
  `ALTER TABLE project
     ADD COLUMN ingress_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_ingress_is_positive CHECK (ingress_next >= 1)`,
  `CREATE TABLE operation (
     tenant                    text   NOT NULL,
     project                   text   NOT NULL,
     operation                 text   NOT NULL,
     authority_kind            text   NOT NULL,
     authority_subject         text   NOT NULL,
     admission                 text   NOT NULL,
     key_version               text   NOT NULL,
     key_digest                text   NOT NULL,
     payload_digest            text   NOT NULL,
     command                   text   NOT NULL,
     state                     text   NOT NULL DEFAULT 'Pending',
     lifecycle_generation      bigint NOT NULL,
     accepted_at               timestamptz NOT NULL DEFAULT now(),
     settled_at                timestamptz,
     settled_authority_kind    text,
     settled_authority_subject text,
     PRIMARY KEY (tenant, project, operation),
     CONSTRAINT operation_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT operation_identity_is_never_reused UNIQUE (operation),
     CONSTRAINT operation_idempotency_is_scoped
       UNIQUE (tenant, project, authority_kind, key_digest),
     CONSTRAINT operation_state_is_known CHECK (
       state IN ('Pending', 'Succeeded', 'Refused', 'Cancelled')
     ),
     CONSTRAINT operation_admission_is_known CHECK (
       admission IN ('Ordinary', 'CorrectnessReducing')
     ),
     CONSTRAINT operation_settlement_is_whole CHECK (
       (state = 'Pending') = (settled_at IS NULL)
       AND (settled_authority_kind IS NULL) = (settled_authority_subject IS NULL)
     ),
     CONSTRAINT operation_text_is_bounded CHECK (
       length(operation) <= ${operationIdentityCharsMax}
       AND length(authority_kind) <= ${authorityCharsMax}
       AND length(authority_subject) <= ${authorityCharsMax}
       AND length(command) <= ${operationCommandCharsMax}
       AND coalesce(length(settled_authority_kind), 0) <= ${authorityCharsMax}
       AND coalesce(length(settled_authority_subject), 0) <= ${authorityCharsMax}
     )
   )`,
  `CREATE TABLE inbox_item (
     tenant      text   NOT NULL,
     project     text   NOT NULL,
     ordinal     bigint NOT NULL,
     operation   text   NOT NULL,
     consumable  boolean NOT NULL DEFAULT true,
     enqueued_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, ordinal),
     CONSTRAINT inbox_item_source_is_unique UNIQUE (tenant, project, operation),
     CONSTRAINT inbox_item_has_its_operation
       FOREIGN KEY (tenant, project, operation)
       REFERENCES operation (tenant, project, operation),
     CONSTRAINT inbox_item_ordinal_is_positive CHECK (ordinal >= 1)
   )`,
  `CREATE TABLE project_readiness (
     tenant     text    NOT NULL,
     project    text    NOT NULL,
     ready      boolean NOT NULL,
     generation bigint  NOT NULL,
     PRIMARY KEY (tenant, project),
     CONSTRAINT project_readiness_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT project_readiness_generation_is_positive CHECK (generation >= 1)
   )`,
  `CREATE INDEX inbox_item_consumable ON inbox_item (tenant, project, ordinal)
     WHERE consumable`,
  `CREATE INDEX project_readiness_ready ON project_readiness (tenant, project)
     WHERE ready`,
];

/**
 * The trigger that makes a terminal outcome final, settling authority
 * included: a grant cannot say which value a column may take, so the rule that
 * a cancelled operation is never later succeeded — or later re-audited to
 * somebody else — has to be the server's own. Its EXECUTE is revoked from
 * PUBLIC as the cancellation function's is, which changes nothing a caller can
 * do with a trigger function and leaves the privilege audit an explicit ACL to
 * read where a default is a column it cannot see.
 */
const inboxTerminality = [
  `CREATE FUNCTION operation_stays_terminal() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state <> 'Pending'
          AND (NEW.state, NEW.settled_at, NEW.settled_authority_kind, NEW.settled_authority_subject)
              IS DISTINCT FROM
              (OLD.state, OLD.settled_at, OLD.settled_authority_kind, OLD.settled_authority_subject)
       THEN
         RAISE EXCEPTION
           'operation % is already %, and an outcome is decided once', OLD.operation, OLD.state
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$`,
  `REVOKE EXECUTE ON FUNCTION operation_stays_terminal() FROM PUBLIC`,
  `CREATE TRIGGER operation_outcome_is_decided_once
     BEFORE UPDATE ON operation
     FOR EACH ROW EXECUTE FUNCTION operation_stays_terminal()`,
];

/**
 * The whole of a cancellation as one call the API role is granted, because the
 * grants that would let a caller assemble it by hand are the grants that let it
 * decide an operation instead. A `SECURITY DEFINER` body runs as its owner —
 * whichever role applied the migration, which nothing here decides — so the
 * `search_path` is pinned on the definition against a caller shadowing
 * `operation`, and kasofsk/chuggy#134 carries who owns it in production.
 */
const inboxCancellation = [
  `CREATE FUNCTION ${cancellationFunction}(
     in_tenant text, in_project text, in_operation text,
     in_authority_kind text, in_authority_subject text)
     RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE
       locked_state text;
     BEGIN
       SELECT state INTO locked_state FROM operation
         WHERE tenant = in_tenant AND project = in_project AND operation = in_operation
         FOR UPDATE;
       IF NOT FOUND THEN
         RETURN NULL;
       END IF;
       IF locked_state <> 'Pending' THEN
         RETURN locked_state;
       END IF;
       UPDATE operation
          SET state = 'Cancelled', settled_at = now(),
              settled_authority_kind = in_authority_kind,
              settled_authority_subject = in_authority_subject
        WHERE tenant = in_tenant AND project = in_project AND operation = in_operation;
       UPDATE inbox_item SET consumable = false
        WHERE tenant = in_tenant AND project = in_project AND operation = in_operation;
       RETURN locked_state;
     END
     $$`,
  `REVOKE EXECUTE ON FUNCTION ${cancellationFunction}(text, text, text, text, text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${cancellationFunction}(text, text, text, text, text) TO ${apiRole}`,
];

/**
 * What either role may write, which is wider than the discipline over it: both
 * grants permit lowering `ready` over a consumable item — an enqueued
 * submission no writer discovers until something raises readiness again — and
 * the API's also permits rewinding the generation a stale observation is
 * refused by, because direction is this adapter's rule and no grant states it.
 * A narrower grant cannot draw that line, since acceptance writes both columns
 * and an idle owner writes one of them back; kasofsk/chuggy#121 is open on what
 * does, and a later slice carries it.
 */
const inboxGrants = [
  `GRANT SELECT ON project TO ${apiRole}`,
  `GRANT UPDATE (ingress_next) ON project TO ${apiRole}`,
  `GRANT SELECT ON operation TO ${apiRole}`,
  `GRANT INSERT (tenant, project, operation, authority_kind, authority_subject,
                 admission, key_version, key_digest, payload_digest, command,
                 lifecycle_generation)
     ON operation TO ${apiRole}`,
  `GRANT SELECT ON inbox_item TO ${apiRole}`,
  `GRANT INSERT (tenant, project, ordinal, operation) ON inbox_item TO ${apiRole}`,
  `GRANT SELECT ON project_readiness TO ${apiRole}`,
  `GRANT INSERT (tenant, project, ready, generation)
     ON project_readiness TO ${apiRole}`,
  `GRANT UPDATE (ready, generation) ON project_readiness TO ${apiRole}`,
  `GRANT SELECT ON inbox_item TO ${ticketServiceRole}`,
  `GRANT SELECT ON project_readiness TO ${ticketServiceRole}`,
  `GRANT UPDATE (ready) ON project_readiness TO ${ticketServiceRole}`,
];

/** A closed set of text values as the SQL list a CHECK compares against. */
function schemaTextSet(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

const decisionRelations = [
  `ALTER TABLE journal_entry
     ADD COLUMN cause_operation text NOT NULL,
     ADD CONSTRAINT journal_entry_cause_is_effective
       UNIQUE (tenant, project, cause_operation),
     ADD CONSTRAINT journal_entry_has_its_cause
       FOREIGN KEY (tenant, project, cause_operation)
       REFERENCES operation (tenant, project, operation)`,
  `ALTER TABLE operation
     ADD COLUMN outcome_code text,
     ADD COLUMN decided_seq  bigint,
     ADD COLUMN refused_head bigint,
     ADD COLUMN refused_lifecycle_generation bigint,
     ADD CONSTRAINT operation_outcome_is_whole CHECK (
       (state = 'Refused') = (outcome_code IS NOT NULL)
       AND (state = 'Refused') = (refused_head IS NOT NULL)
       AND (state = 'Refused') = (refused_lifecycle_generation IS NOT NULL)
       AND (state = 'Succeeded') = (decided_seq IS NOT NULL)
       AND coalesce(decided_seq, 1) >= 1
       AND coalesce(refused_head, 0) >= 0
       AND coalesce(refused_lifecycle_generation, 1) >= 1
     ),
     ADD CONSTRAINT operation_outcome_code_is_known CHECK (
       outcome_code IS NULL OR outcome_code IN (${schemaTextSet(allRefusalCodes)})
     )`,
  `CREATE TABLE ticket_projection (
     tenant  text   NOT NULL,
     project text   NOT NULL,
     ticket  bigint NOT NULL,
     phase   text   NOT NULL,
     seq     bigint NOT NULL,
     PRIMARY KEY (tenant, project, ticket),
     CONSTRAINT ticket_projection_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT ticket_projection_phase_is_known CHECK (
       phase IN (${schemaTextSet(phaseTags)})
     ),
     CONSTRAINT ticket_projection_counters_are_positive CHECK (
       ticket >= 1 AND seq >= 1
     )
   )`,
];

/**
 * The trigger that stops a settled operation being written again at all. It is
 * wider than the outcome the earlier version froze because the outcome now has
 * columns beside `state`, and a rule that lists them is a rule the next column
 * is added without.
 */
const decisionTerminality = [
  `CREATE OR REPLACE FUNCTION operation_stays_terminal() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state <> 'Pending' THEN
         RAISE EXCEPTION
           'operation % is already %, and an outcome is decided once', OLD.operation, OLD.state
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$`,
];

/**
 * The trigger that makes the fencing epoch the only way to obtain a tenure. A
 * grant names columns and not values, so the rule that ownership is taken
 * rather than written has to be the server's own.
 */
const tenureFence = [
  `CREATE FUNCTION project_tenure_is_fenced() RETURNS trigger
     LANGUAGE plpgsql AS $$
     DECLARE
       was_live boolean;
       is_live  boolean;
     BEGIN
       IF NEW.fencing_epoch < OLD.fencing_epoch THEN
         RAISE EXCEPTION
           'project %/% would move its fencing epoch backwards, and a fence only advances',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       was_live := OLD.owner IS NOT NULL AND OLD.lease_expires_at > now();
       is_live  := NEW.owner IS NOT NULL AND NEW.lease_expires_at > now();
       IF is_live AND NEW.fencing_epoch = OLD.fencing_epoch
          AND NOT (was_live
                   AND NEW.owner = OLD.owner
                   AND NEW.recovery_epoch IS NOT DISTINCT FROM OLD.recovery_epoch)
       THEN
         RAISE EXCEPTION
           'project %/% would take a tenure without advancing its fencing epoch',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$`,
  `CREATE TRIGGER project_tenure_is_fenced
     BEFORE UPDATE ON project
     FOR EACH ROW EXECUTE FUNCTION project_tenure_is_fenced()`,
];

const decisionGrants = [
  `GRANT SELECT ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (state, settled_at, settled_authority_kind,
                 settled_authority_subject, outcome_code, decided_seq,
                 refused_head, refused_lifecycle_generation)
     ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (consumable) ON inbox_item TO ${ticketServiceRole}`,
  `GRANT SELECT, INSERT ON ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (phase, seq) ON ticket_projection TO ${ticketServiceRole}`,
];

/** I3 replaces the operation-only inbox with one typed, prioritized decision-input authority. */
const durableMailbox = [
  roleStatement(boundaryOwnerRole),
  roleStatement(ticketServiceRole),
  `CREATE FUNCTION command_integer(value jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       IF value IS NULL OR jsonb_typeof(value) <> 'number'
          OR value::text !~ '^-?(0|[1-9][0-9]*)$' THEN
         RETURN false;
       END IF;
       RETURN value::text::numeric BETWEEN -9007199254740991 AND 9007199254740991;
     EXCEPTION WHEN numeric_value_out_of_range THEN
       RETURN false;
     END $$`,
  `CREATE FUNCTION decision_event_is_valid(event jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     DECLARE tag text; value jsonb; item jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'TaskDone' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND command_integer(value->'tid')
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded', 'FinalizationFailed');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'reason' IN ('NoReason', 'WorkFailed', 'ReworkBudgetExhausted',
             'FinalizationBudgetExhausted', 'GasExhausted', 'DependencyRevoked',
             'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable');
       END IF;
       IF tag <> 'ReleaseTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
          OR jsonb_typeof(value->'reworkPolicy') <> 'object'
          OR value->'reworkPolicy'->>'type' <> 'BudgetedRework'
          OR NOT command_integer(value->'reworkPolicy'->'value')
          OR value->>'resumePricing' NOT IN ('RetryCharged', 'RetryFree')
          OR value->>'finalizer' NOT IN ('NoFinalizer', 'ManagedFinalizer') THEN
         RETURN false;
       END IF;
       IF NOT (value->'finalizationPricing' = '"DeadlineOnly"'::jsonb OR
          (jsonb_typeof(value->'finalizationPricing') = 'object'
           AND value->'finalizationPricing'->>'type' = 'Budgeted'
           AND command_integer(value->'finalizationPricing'->'value'))) THEN
         RETURN false;
       END IF;
       IF (SELECT count(*) FROM jsonb_array_elements(value->'deps')) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(value->'deps') AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'deps') AS elements(element) LOOP
         IF NOT command_integer(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'prog') AS elements(element) LOOP
         IF jsonb_typeof(item) <> 'object' OR NOT command_integer(item->'fanout')
            OR item->>'combinator' NOT IN ('UnanimousPass', 'AnyPass') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$`,
  `CREATE FUNCTION ticket_command_is_valid(command jsonb) RETURNS boolean
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'version') <> 'number'
          OR command->>'version' <> '1' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'Decide' THEN
         RETURN decision_event_is_valid(command->'event')
           AND command->'event'->>'type' <> 'ReleaseTicket';
       END IF;
       IF command->>'command' = 'ReleaseDraft' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       RETURN command->>'command' = 'ResolveNativeAction'
         AND jsonb_typeof(command->'action') = 'string'
         AND length(command->>'action') BETWEEN 1 AND 256
         AND command_integer(command->'authorizingSeq')
         AND (command->>'authorizingSeq')::numeric >= 1
         AND command->>'resolution' IN ('Resume', 'Revoke');
     END $$`,
  `CREATE FUNCTION legacy_event(command text) RETURNS jsonb
     LANGUAGE plpgsql IMMUTABLE AS $$
     BEGIN
       RETURN command::jsonb;
     EXCEPTION WHEN others THEN
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION command_integer(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION decision_event_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ticket_command_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION legacy_event(text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION command_integer(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION decision_event_is_valid(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ticket_command_is_valid(jsonb) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION legacy_event(text) FROM PUBLIC`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ticketServiceRole}`,
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${ticketServiceRole}`,
  `GRANT SELECT ON recovery_epoch, project, journal_entry, operation,
     project_readiness, ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (head, owner, lease_expires_at, recovery_epoch, fencing_epoch, ingress_next)
     ON project TO ${ticketServiceRole}`,
  `GRANT INSERT ON journal_entry, ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (ready) ON project_readiness TO ${ticketServiceRole}`,
  `GRANT UPDATE (phase, seq) ON ticket_projection TO ${ticketServiceRole}`,
  `ALTER ROLE ${boundaryOwnerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  `GRANT ${boundaryOwnerRole} TO CURRENT_USER`,
  `GRANT USAGE, CREATE ON SCHEMA public TO ${boundaryOwnerRole}`,
  `CREATE TABLE decision_input (
     tenant text NOT NULL, project text NOT NULL, ordinal bigint NOT NULL,
     input_kind text NOT NULL, input_id text NOT NULL,
     base_priority text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
     lifecycle_generation bigint NOT NULL, state text NOT NULL DEFAULT 'Pending',
     decided_seq bigint, outcome_code text, refused_head bigint,
     refused_lifecycle_generation bigint, terminal_at timestamptz,
     settled_authority_kind text, settled_authority_subject text,
     PRIMARY KEY (tenant, project, ordinal),
     CONSTRAINT decision_input_identity_is_unique UNIQUE (tenant, project, input_kind, input_id),
     CONSTRAINT decision_input_decision_tuple_is_unique UNIQUE (tenant, project, input_kind, input_id, decided_seq),
     CONSTRAINT decision_input_belongs_to_project FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT decision_input_ordinal_is_positive CHECK (ordinal >= 1 AND lifecycle_generation >= 1),
     CONSTRAINT decision_input_kind_is_known CHECK (input_kind IN ('Operation', 'Continuation')),
     CONSTRAINT decision_input_priority_is_known CHECK (base_priority IN ('Safety', 'Completion', 'Continuation', 'Ordinary')),
     CONSTRAINT decision_input_state_is_known CHECK (state IN ('Pending', 'Journaled', 'Refused', 'Cancelled', 'Stale')),
     CONSTRAINT decision_input_kind_state_agree CHECK (
       (input_kind = 'Operation' AND state IN ('Pending', 'Journaled', 'Refused', 'Cancelled')) OR
       (input_kind = 'Continuation' AND state IN ('Pending', 'Journaled', 'Stale'))),
     CONSTRAINT decision_input_outcome_is_whole CHECK (
       (state = 'Journaled') = (decided_seq IS NOT NULL) AND
       (state = 'Refused') = (outcome_code IS NOT NULL) AND
       (state = 'Refused') = (refused_head IS NOT NULL) AND
       (state = 'Refused') = (refused_lifecycle_generation IS NOT NULL) AND
       (state IN ('Pending')) = (terminal_at IS NULL) AND
       (settled_authority_kind IS NULL) = (settled_authority_subject IS NULL) AND
       coalesce(decided_seq, 1) >= 1)
   )`,
  `DROP TRIGGER operation_outcome_is_decided_once ON operation`,
  `DROP FUNCTION operation_stays_terminal()`,
  `ALTER TABLE operation DROP CONSTRAINT operation_outcome_code_is_known`,
  `UPDATE operation o
      SET state='Refused', settled_at=now(),
          settled_authority_kind='ProjectTicketWriter',
          settled_authority_subject='I3Migration', outcome_code='CommandUnreadable',
          refused_head=p.head, refused_lifecycle_generation=o.lifecycle_generation
     FROM project p
    WHERE p.tenant=o.tenant AND p.project=o.project AND o.state='Pending'
      AND decision_event_is_valid(legacy_event(o.command)) IS NOT TRUE`,
  `UPDATE inbox_item i SET consumable=false
     FROM operation o
    WHERE o.tenant=i.tenant AND o.project=i.project AND o.operation=i.operation
      AND o.state='Refused'`,
  `UPDATE operation
      SET command = jsonb_build_object(
        'version', 1, 'command', 'Decide', 'event', legacy_event(command)
      )::text
    WHERE decision_event_is_valid(legacy_event(command))`,
  `INSERT INTO decision_input
     (tenant, project, ordinal, input_kind, input_id, base_priority, created_at,
      lifecycle_generation, state, decided_seq, outcome_code, refused_head,
      refused_lifecycle_generation, terminal_at, settled_authority_kind, settled_authority_subject)
   SELECT o.tenant, o.project, i.ordinal, 'Operation', o.operation,
          CASE
            WHEN legacy_event(o.command)->'event'->>'type' = 'Revoke' THEN 'Safety'
            WHEN legacy_event(o.command)->'event'->>'type' IN ('TaskDone', 'ExecutionBlocked', 'FinalizationResult') THEN 'Completion'
            ELSE 'Ordinary' END,
          o.accepted_at, o.lifecycle_generation,
          CASE o.state WHEN 'Succeeded' THEN 'Journaled' ELSE o.state END,
          o.decided_seq, o.outcome_code, o.refused_head, o.refused_lifecycle_generation,
          o.settled_at, o.settled_authority_kind, o.settled_authority_subject
     FROM operation o JOIN inbox_item i USING (tenant, project, operation)`,
  `DO $$ BEGIN
     IF (SELECT count(*) FROM operation) <> (SELECT count(*) FROM decision_input WHERE input_kind = 'Operation')
     THEN RAISE EXCEPTION 'I3 operation input backfill lost rows'; END IF;
   END $$`,
  `ALTER TABLE journal_entry ADD COLUMN cause_kind text, ADD COLUMN cause_id text`,
  `UPDATE journal_entry SET cause_kind = 'Operation', cause_id = cause_operation`,
  `ALTER TABLE journal_entry ALTER COLUMN cause_kind SET NOT NULL, ALTER COLUMN cause_id SET NOT NULL`,
  `ALTER TABLE journal_entry DROP CONSTRAINT journal_entry_cause_is_effective,
     DROP CONSTRAINT journal_entry_has_its_cause,
     ADD CONSTRAINT journal_entry_cause_is_effective UNIQUE (tenant, project, cause_kind, cause_id),
     ADD CONSTRAINT journal_entry_input_sequence_is_unique
       UNIQUE (tenant, project, cause_kind, cause_id, seq),
     ADD CONSTRAINT journal_entry_has_its_input
       FOREIGN KEY (tenant, project, cause_kind, cause_id, seq)
       REFERENCES decision_input (tenant, project, input_kind, input_id, decided_seq)
       DEFERRABLE INITIALLY DEFERRED`,
  `ALTER TABLE decision_input ADD CONSTRAINT decision_input_has_its_entry
       FOREIGN KEY (tenant, project, input_kind, input_id, decided_seq)
       REFERENCES journal_entry (tenant, project, cause_kind, cause_id, seq)
       DEFERRABLE INITIALLY DEFERRED`,
  `ALTER TABLE journal_entry DROP COLUMN cause_operation`,
  `ALTER TABLE operation ADD COLUMN command_tag text`,
  `UPDATE operation SET command_tag = CASE
       WHEN ticket_command_is_valid(legacy_event(command))
       THEN legacy_event(command)->'event'->>'type'
       ELSE 'LegacyUnreadable' END`,
  `ALTER TABLE operation ALTER COLUMN command_tag SET NOT NULL`,
  `GRANT INSERT (command_tag) ON operation TO ${apiRole}`,
  `ALTER TABLE operation DROP CONSTRAINT operation_outcome_is_whole,
     DROP CONSTRAINT operation_state_is_known,
     DROP CONSTRAINT operation_settlement_is_whole,
     DROP COLUMN state, DROP COLUMN lifecycle_generation, DROP COLUMN settled_at,
     DROP COLUMN settled_authority_kind, DROP COLUMN settled_authority_subject,
     DROP COLUMN outcome_code, DROP COLUMN decided_seq, DROP COLUMN refused_head,
     DROP COLUMN refused_lifecycle_generation`,
  `DROP TABLE inbox_item`,
  `CREATE INDEX decision_input_safety_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Safety'`,
  `CREATE INDEX decision_input_completion_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Completion'`,
  `CREATE INDEX decision_input_continuation_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Continuation'`,
  `CREATE INDEX decision_input_ordinary_head ON decision_input (tenant, project, ordinal) WHERE state = 'Pending' AND base_priority = 'Ordinary'`,
  `CREATE TABLE project_continuation (
     tenant text NOT NULL, project text NOT NULL, continuation text NOT NULL,
     kind text NOT NULL, authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, expected_ticket_version bigint NOT NULL,
     expected_phase text NOT NULL, task_set_generation bigint NOT NULL,
     PRIMARY KEY (tenant, project, continuation),
     UNIQUE (tenant, project, authorizing_seq, effect_position, kind),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (kind IN ('ReduceWork', 'ReduceEvaluation')),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND expected_ticket_version >= 1 AND task_set_generation >= 1),
     CHECK (expected_phase IN (${schemaTextSet(phaseTags)}))
   )`,
  `CREATE TABLE native_action (
     tenant text NOT NULL, project text NOT NULL, action text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, action_version bigint NOT NULL, kind text NOT NULL,
     reason text NOT NULL, required_capability text NOT NULL,
     state text NOT NULL DEFAULT 'Open',
     PRIMARY KEY (tenant, project, action),
     UNIQUE (tenant, project, authorizing_seq, effect_position),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (state IN ('Open', 'Resolved', 'Withdrawn')),
     CHECK (kind = 'TicketEscalation'),
     CHECK (required_capability = 'ResolveTicket'),
     CHECK (reason IN (${schemaTextSet(reasonTags)})),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND action_version = authorizing_seq)
   )`,
  `CREATE UNIQUE INDEX native_action_one_open ON native_action (tenant, project, ticket) WHERE state = 'Open'`,
  `CREATE TABLE native_action_resolution (
     tenant text NOT NULL, project text NOT NULL, action text NOT NULL, resolution text NOT NULL,
     PRIMARY KEY (tenant, project, action, resolution),
     FOREIGN KEY (tenant, project, action) REFERENCES native_action (tenant, project, action)
     ,CHECK (resolution IN ('Resume', 'Revoke'))
   )`,
  `CREATE TABLE execution_request (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, ticket_version bigint NOT NULL, kind text NOT NULL,
     state text NOT NULL DEFAULT 'Open', claim_owner text, claim_generation bigint NOT NULL DEFAULT 0,
     claim_expires_at timestamptz,
     PRIMARY KEY (tenant, project, request),
     UNIQUE (tenant, project, authorizing_seq, effect_position, kind),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (kind IN ('SpawnWork', 'SpawnEvaluation', 'CancelTicketWork')),
     CHECK (state IN ('Open', 'Registered', 'Fulfilled', 'Invalidated')),
     CHECK ((claim_owner IS NULL) = (claim_expires_at IS NULL)),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND ticket_version = authorizing_seq AND claim_generation >= 0)
   )`,
  `CREATE TABLE execution_request_task (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     task bigint NOT NULL, kind text NOT NULL, stage bigint,
     PRIMARY KEY (tenant, project, request, task),
     FOREIGN KEY (tenant, project, request) REFERENCES execution_request (tenant, project, request),
     CHECK (kind IN ('Work', 'Evaluation')),
     CHECK ((kind = 'Work' AND stage IS NULL) OR (kind = 'Evaluation' AND stage IS NOT NULL AND stage >= 0)),
     CHECK (task >= 1)
   )`,
  `CREATE TABLE finalization_request (
     tenant text NOT NULL, project text NOT NULL, request text NOT NULL,
     authorizing_seq bigint NOT NULL, effect_position integer NOT NULL,
     ticket bigint NOT NULL, ticket_version bigint NOT NULL, request_generation bigint NOT NULL,
     state text NOT NULL DEFAULT 'Open', claim_owner text, claim_generation bigint NOT NULL DEFAULT 0,
     claim_expires_at timestamptz,
     PRIMARY KEY (tenant, project, request),
     UNIQUE (tenant, project, authorizing_seq, effect_position),
     FOREIGN KEY (tenant, project, authorizing_seq) REFERENCES journal_entry (tenant, project, seq),
     CHECK (state IN ('Open', 'Registered', 'Fulfilled', 'Invalidated')),
     CHECK ((claim_owner IS NULL) = (claim_expires_at IS NULL)),
     CHECK (authorizing_seq >= 1 AND effect_position >= 0 AND ticket >= 1 AND ticket_version = authorizing_seq AND request_generation >= 1 AND claim_generation >= 0)
   )`,
  `CREATE UNIQUE INDEX finalization_request_one_open ON finalization_request (tenant, project, ticket) WHERE state = 'Open'`,
  `CREATE FUNCTION ${acceptanceFunction}(
      in_tenant text, in_project text, in_operation text,
      in_authority_kind text, in_authority_subject text,
      in_key_version text, in_key_digest text, in_payload_digest text,
      in_retained_key_digests text[], in_retained_payload_digests text[],
      in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint)
     RETURNS TABLE(result text, operation text, ordinal bigint, state text,
       authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE project_lifecycle text; project_generation bigint; next_ordinal bigint;
       pending_total bigint; pending_ordinary bigint; existing record;
       command_value jsonb; command_tag text; priority text; admission_class text;
       action_id text; authorizing_sequence bigint; action_resolution text;
     BEGIN
       IF cardinality(in_retained_key_digests) <> cardinality(in_retained_payload_digests) THEN
         RAISE EXCEPTION 'idempotency digest arrays disagree';
       END IF;

       BEGIN
         command_value := in_command::jsonb;
       EXCEPTION WHEN others THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_value->>'command' = 'Decide'
          AND jsonb_typeof(command_value->'event') = 'object' THEN
         command_tag := command_value->'event'->>'type';
       ELSIF command_value->>'command' = 'ReleaseDraft' THEN
         command_tag := 'ReleaseDraft';
       ELSIF command_value->>'command' = 'ResolveNativeAction'
          AND jsonb_typeof(command_value->'action') = 'string'
          AND length(command_value->>'action') BETWEEN 1 AND 256
          AND jsonb_typeof(command_value->'authorizingSeq') = 'number'
          AND (command_value->>'authorizingSeq') ~ '^[1-9][0-9]*$'
          AND command_value->>'resolution' IN ('Resume', 'Revoke') THEN
         command_tag := 'ResolveNativeAction';
         action_id := command_value->>'action';
         BEGIN
           authorizing_sequence := (command_value->>'authorizingSeq')::bigint;
         EXCEPTION WHEN numeric_value_out_of_range THEN
           RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
           RETURN;
         END;
         action_resolution := command_value->>'resolution';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       IF command_tag = 'Revoke' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = 'Revoke') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('TaskDone', 'ExecutionBlocked', 'FinalizationResult') THEN
         priority := 'Completion'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', 'Dispatch', 'ResumeTicket') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution = 'Resume') THEN
         priority := 'Ordinary'; admission_class := 'Ordinary';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT p.lifecycle, p.lifecycle_generation INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;

       SELECT o.operation, d.ordinal, d.state, o.authority_kind, o.admission,
              d.lifecycle_generation, offered.payload_digest AS offered_payload, o.payload_digest
         INTO existing
         FROM unnest(in_retained_key_digests, in_retained_payload_digests)
              AS offered(key_digest, payload_digest)
         JOIN operation o ON o.tenant=in_tenant AND o.project=in_project
              AND o.authority_kind=in_authority_kind AND o.key_digest=offered.key_digest
         JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
         ORDER BY (o.payload_digest = offered.payload_digest) DESC
         LIMIT 1;
       IF FOUND THEN
         IF existing.payload_digest IS DISTINCT FROM existing.offered_payload THEN
           RETURN QUERY SELECT 'IdempotencyConflict'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         ELSE
           RETURN QUERY SELECT 'Original'::text, existing.operation::text,
             existing.ordinal::bigint, existing.state::text, existing.authority_kind::text,
             existing.admission::text, existing.lifecycle_generation::bigint, NULL::text;
         END IF;
         RETURN;
       END IF;

       IF command_tag='ResolveNativeAction' AND NOT EXISTS (
         SELECT 1 FROM native_action a JOIN native_action_resolution r
           USING (tenant, project, action)
          WHERE a.tenant=in_tenant AND a.project=in_project AND a.action=action_id
            AND a.state='Open' AND a.authorizing_seq=authorizing_sequence
            AND r.resolution=action_resolution FOR UPDATE OF a)
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_tag='ReleaseDraft' AND NOT EXISTS (
         SELECT 1 FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project
            AND r.ticket=(command_value->>'ticket')::bigint
            AND r.authoring_version=(command_value->>'authoringVersion')::bigint
            AND r.configuration_revision=command_value->>'configurationRevision')
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT count(*), count(*) FILTER (WHERE d.base_priority='Ordinary')
         INTO pending_total, pending_ordinary FROM decision_input d
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Pending';
       IF pending_total >= in_hard_limit THEN
         RETURN QUERY SELECT 'Unavailable'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF priority='Ordinary' AND pending_ordinary >= in_ordinary_soft_limit THEN
         RETURN QUERY SELECT 'Backpressure'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF NOT (project_lifecycle = 'Active' OR
          (admission_class = 'CorrectnessReducing' AND
           project_lifecycle IN ('Suspended', 'IntegrityBlocked', 'Deleting'))) THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, project_lifecycle;
         RETURN;
       END IF;

       UPDATE project p SET ingress_next=p.ingress_next+1
        WHERE p.tenant=in_tenant AND p.project=in_project
        RETURNING p.ingress_next-1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, in_authority_kind, in_authority_subject,
          admission_class, in_key_version, in_key_digest, in_payload_digest, in_command, command_tag);
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation, priority, project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
       RETURN QUERY SELECT 'Accepted'::text, in_operation, next_ordinal, 'Pending'::text,
         in_authority_kind, admission_class, project_generation, NULL::text;
     END $$`,
  `CREATE FUNCTION ${continuationFunction}(in_tenant text, in_project text, in_ordinal bigint,
      in_continuation text) RETURNS void
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     BEGIN
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       SELECT in_tenant, in_project, in_ordinal, 'Continuation', in_continuation, 'Continuation', lifecycle_generation
         FROM project WHERE tenant=in_tenant AND project=in_project;
     END $$`,
  `CREATE OR REPLACE FUNCTION ${cancellationFunction}(
     in_tenant text, in_project text, in_operation text,
     in_authority_kind text, in_authority_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE locked_state text;
     BEGIN
       SELECT state INTO locked_state FROM decision_input
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation FOR UPDATE;
       IF NOT FOUND THEN RETURN NULL; END IF;
       IF locked_state <> 'Pending' THEN RETURN CASE locked_state WHEN 'Journaled' THEN 'Succeeded' ELSE locked_state END; END IF;
       UPDATE decision_input SET state='Cancelled', terminal_at=now(),
         settled_authority_kind=in_authority_kind, settled_authority_subject=in_authority_subject
        WHERE tenant=in_tenant AND project=in_project AND input_kind='Operation' AND input_id=in_operation;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Operation',in_operation,NULL,NULL);
       RETURN locked_state;
     END $$`,
  `ALTER FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${continuationFunction}(text,text,bigint,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${cancellationFunction}(text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${continuationFunction}(text,text,bigint,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${cancellationFunction}(text,text,text,text,text) FROM PUBLIC`,
  `GRANT SELECT, INSERT ON operation, decision_input, project, project_readiness,
     native_action, native_action_resolution TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ingress_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ready, generation) ON project_readiness TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state) ON native_action TO ${boundaryOwnerRole}`,
  `GRANT USAGE ON SCHEMA public TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (state, terminal_at, settled_authority_kind, settled_authority_subject) ON decision_input TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${acceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint) TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION ${continuationFunction}(text,text,bigint,text) TO ${ticketServiceRole}`,
  `GRANT EXECUTE ON FUNCTION ${cancellationFunction}(text,text,text,text,text) TO ${apiRole}`,
  `REVOKE INSERT ON decision_input FROM ${apiRole}, ${ticketServiceRole}`,
  `REVOKE INSERT ON operation FROM ${apiRole}`,
  `REVOKE UPDATE (ingress_next) ON project FROM ${apiRole}`,
  `REVOKE INSERT, UPDATE ON project_readiness FROM ${apiRole}`,
  `GRANT SELECT ON decision_input, project_continuation, native_action, native_action_resolution,
     execution_request, execution_request_task, finalization_request TO ${ticketServiceRole}`,
  `GRANT UPDATE (state, decided_seq, outcome_code, refused_head, refused_lifecycle_generation,
     terminal_at, settled_authority_kind, settled_authority_subject) ON decision_input TO ${ticketServiceRole}`,
  `GRANT INSERT ON native_action, native_action_resolution, execution_request,
     execution_request_task, finalization_request, project_continuation TO ${ticketServiceRole}`,
  `GRANT UPDATE (state) ON native_action TO ${ticketServiceRole}`,
  `GRANT UPDATE (state) ON finalization_request TO ${ticketServiceRole}`,
  `REVOKE CREATE ON SCHEMA public FROM ${boundaryOwnerRole}`,
  `REVOKE ${boundaryOwnerRole} FROM CURRENT_USER`,
];

/** I4a gives the API only the columns needed to poll operations and read projections. */
const nativeWebReads = [
  `REVOKE SELECT ON operation FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, operation, authority_kind, admission,
                 accepted_at)
     ON operation TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ordinal, input_kind, input_id, state,
                 lifecycle_generation, decided_seq, outcome_code,
                 refused_head, refused_lifecycle_generation)
     ON decision_input TO ${apiRole}`,
  `REVOKE SELECT ON project FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation,
                 fencing_epoch, head)
     ON project TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ticket, phase, seq)
     ON ticket_projection TO ${apiRole}`,
];

const nativeAuthoring = [
  `UPDATE decision_input i
      SET state='Refused', outcome_code='CommandUnreadable',
          refused_head=p.head,
          refused_lifecycle_generation=p.lifecycle_generation,
          terminal_at=now(),
          settled_authority_kind='ProjectTicketWriter',
          settled_authority_subject='I4Migration'
     FROM operation o, project p
    WHERE o.tenant=i.tenant AND o.project=i.project AND o.operation=i.input_id
      AND i.input_kind='Operation' AND i.state='Pending'
      AND p.tenant=i.tenant AND p.project=i.project
      AND legacy_event(o.command)->>'command'='Decide'
      AND legacy_event(o.command)->'event'->>'type'='ReleaseTicket'`,
  `ALTER TABLE project ADD COLUMN ticket_next bigint`,
  `UPDATE project p SET ticket_next=coalesce(
     (SELECT max(t.ticket)+1 FROM ticket_projection t
       WHERE t.tenant=p.tenant AND t.project=p.project),1)`,
  `ALTER TABLE project ALTER COLUMN ticket_next SET NOT NULL,
     ALTER COLUMN ticket_next SET DEFAULT 1,
     ADD CONSTRAINT project_ticket_next_is_positive CHECK (ticket_next >= 1)`,
  `CREATE TABLE configuration_revision (
     tenant text NOT NULL, project text NOT NULL, revision text NOT NULL,
     parent text, canonical text NOT NULL, digest text NOT NULL,
     authority_kind text NOT NULL, authority_subject text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, revision),
     CONSTRAINT configuration_revision_belongs_to_project FOREIGN KEY (tenant,project)
       REFERENCES project (tenant,project),
     CONSTRAINT configuration_revision_parent_is_local FOREIGN KEY (tenant,project,parent)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT configuration_revision_digest_identity UNIQUE (tenant,project,revision,digest),
     CONSTRAINT configuration_revision_content_is_bounded CHECK (length(canonical) BETWEEN 1 AND 65536)
   )`,
  `ALTER TABLE journal_entry
     ADD COLUMN integrity_version integer NOT NULL DEFAULT 1,
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest text,
     ADD COLUMN event_schema_version integer NOT NULL DEFAULT 1,
     ADD COLUMN decision_semantics_version integer NOT NULL DEFAULT 1,
     ADD CONSTRAINT journal_configuration_is_whole CHECK
       ((configuration_revision IS NULL)=(configuration_digest IS NULL)),
     ADD CONSTRAINT journal_configuration_is_required_for_v2 CHECK
       (integrity_version=1 OR configuration_revision IS NOT NULL),
     ADD CONSTRAINT journal_configuration_is_retained FOREIGN KEY
       (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest),
     ADD CONSTRAINT journal_integrity_version_is_known CHECK (integrity_version IN (1,2))`,
  `ALTER TABLE journal_entry
     ADD CONSTRAINT journal_event_schema_version_is_positive CHECK (event_schema_version >= 1),
     ADD CONSTRAINT journal_decision_semantics_version_is_positive CHECK (decision_semantics_version >= 1)`,
  `ALTER TABLE ticket_projection
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest text,
     ADD CONSTRAINT ticket_projection_configuration_is_whole CHECK
       ((configuration_revision IS NULL)=(configuration_digest IS NULL)),
     ADD CONSTRAINT ticket_projection_configuration_is_retained FOREIGN KEY
       (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest)`,
  `CREATE TABLE draft (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     authoring_version bigint NOT NULL, state text NOT NULL,
     configuration_revision text NOT NULL,
     PRIMARY KEY (tenant,project,ticket),
     CONSTRAINT draft_belongs_to_project FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
     CONSTRAINT draft_configuration_is_local FOREIGN KEY (tenant,project,configuration_revision)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT draft_ticket_is_positive CHECK (ticket >= 1 AND authoring_version >= 1),
     CONSTRAINT draft_state_is_known CHECK (state IN ('Draft','Released','Deleted'))
   )`,
  `CREATE TABLE draft_revision (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     authoring_version bigint NOT NULL, configuration_revision text NOT NULL,
     authoring text NOT NULL, authority_kind text NOT NULL, authority_subject text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,ticket,authoring_version),
     CONSTRAINT draft_revision_belongs_to_draft FOREIGN KEY (tenant,project,ticket)
       REFERENCES draft (tenant,project,ticket),
     CONSTRAINT draft_revision_configuration_is_local FOREIGN KEY (tenant,project,configuration_revision)
       REFERENCES configuration_revision (tenant,project,revision),
     CONSTRAINT draft_revision_content_is_bounded CHECK (length(authoring) BETWEEN 1 AND 65536)
   )`,
  `CREATE FUNCTION ${configurationCreateFunction}(in_tenant text,in_project text,in_revision text,
      in_parent text,in_canonical text,in_digest text,in_kind text,in_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE existing configuration_revision%ROWTYPE; inserted boolean := false;
     BEGIN
       BEGIN
         INSERT INTO configuration_revision
           (tenant,project,revision,parent,canonical,digest,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_revision,in_parent,in_canonical,in_digest,in_kind,in_subject)
         ON CONFLICT (tenant,project,revision) DO NOTHING RETURNING true INTO inserted;
       EXCEPTION
         WHEN foreign_key_violation THEN RETURN 'ParentNotFound';
         WHEN unique_violation THEN NULL;
       END;
       IF inserted THEN
         PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
         RETURN 'Created';
       END IF;
       SELECT * INTO existing FROM configuration_revision
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       RETURN CASE WHEN existing.canonical=in_canonical AND existing.digest=in_digest
         AND existing.parent IS NOT DISTINCT FROM in_parent THEN 'AlreadyExists' ELSE 'IdentityConflict' END;
     END $$`,
  `CREATE FUNCTION ${draftCreateFunction}(in_tenant text,in_project text,in_configuration text,
      in_authoring text,in_kind text,in_subject text)
     RETURNS TABLE(result text,ticket bigint,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE minted bigint;
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       UPDATE project SET ticket_next=ticket_next+1 WHERE tenant=in_tenant AND project=in_project AND lifecycle='Active'
         RETURNING ticket_next-1 INTO minted;
       IF minted IS NULL THEN RETURN QUERY SELECT 'ConfigurationNotFound',NULL::bigint,NULL::bigint,NULL::text; RETURN; END IF;
       INSERT INTO draft VALUES (in_tenant,in_project,minted,1,'Draft',in_configuration);
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,minted,1,in_configuration,in_authoring,in_kind,in_subject);
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',minted::text,NULL,1);
       RETURN QUERY SELECT 'Created',minted,1::bigint,'Draft'::text;
     END $$`,
  `CREATE FUNCTION ${draftReviseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_authoring text,in_kind text,in_subject text)
     RETURNS TABLE(result text,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE; next_version bigint;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_kind,in_subject);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,'Draft'::text;
     END $$`,
  `CREATE FUNCTION ${draftDeleteFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_kind text,in_subject text)
     RETURNS TABLE(result text,authoring_version bigint,state text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state <> 'Draft' THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,authority_kind,authority_subject)
         SELECT r.tenant,r.project,r.ticket,r.authoring_version+1,r.configuration_revision,r.authoring,in_kind,in_subject
           FROM draft_revision r WHERE r.tenant=in_tenant AND r.project=in_project AND r.ticket=in_ticket
            AND r.authoring_version=current.authoring_version;
       UPDATE draft d SET state='Deleted',authoring_version=d.authoring_version+1
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket;
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Draft',in_ticket::text,NULL,current.authoring_version+1);
       RETURN QUERY SELECT 'Deleted',current.authoring_version+1,'Deleted'::text;
     END $$`,
  `CREATE FUNCTION ${draftReleaseFunction}(in_tenant text,in_project text,in_ticket bigint,
      in_expected bigint,in_configuration text,in_digest text,in_commit boolean) RETURNS boolean
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE current draft%ROWTYPE;
     BEGIN
       SELECT d.* INTO current FROM draft d JOIN configuration_revision c
         ON c.tenant=d.tenant AND c.project=d.project AND c.revision=d.configuration_revision
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.ticket=in_ticket
          AND c.digest=in_digest FOR UPDATE OF d;
       IF NOT FOUND OR current.state <> 'Draft' OR current.authoring_version <> in_expected
          OR current.configuration_revision <> in_configuration THEN RETURN false; END IF;
       IF in_commit THEN UPDATE draft SET state='Released'
         WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket; END IF;
       RETURN true;
     END $$`,
  `ALTER FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftCreateFunction}(text,text,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftDeleteFunction}(text,text,bigint,bigint,text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text),
     ${draftCreateFunction}(text,text,text,text,text,text),
     ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text),
     ${draftDeleteFunction}(text,text,bigint,bigint,text,text),
     ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) FROM PUBLIC`,
  `GRANT SELECT,INSERT ON configuration_revision,draft,draft_revision TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ticket_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ticket_next) ON project TO ${ticketServiceRole}`,
  `GRANT UPDATE (authoring_version,state,configuration_revision) ON draft TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${configurationCreateFunction}(text,text,text,text,text,text,text,text),
     ${draftCreateFunction}(text,text,text,text,text,text),
     ${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text),
     ${draftDeleteFunction}(text,text,bigint,bigint,text,text) TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION ${draftReleaseFunction}(text,text,bigint,bigint,text,text,boolean) TO ${ticketServiceRole}`,
  `GRANT SELECT ON configuration_revision,draft,draft_revision TO ${apiRole},${ticketServiceRole}`,
];

const durableNotifications = [
  `ALTER TABLE project ADD COLUMN notification_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_notification_next_is_positive CHECK (notification_next >= 1)`,
  `CREATE TABLE project_notification (
     tenant text NOT NULL, project text NOT NULL, ordinal bigint NOT NULL,
     kind text NOT NULL, resource text NOT NULL, project_seq bigint,
     authoring_version bigint, created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,ordinal),
     CONSTRAINT project_notification_belongs_to_project FOREIGN KEY (tenant,project)
       REFERENCES project (tenant,project),
     CONSTRAINT project_notification_kind_is_known CHECK
       (kind IN ('Operation','Ticket','Draft','Configuration')),
     CONSTRAINT project_notification_values_are_bounded CHECK
       (ordinal >= 1 AND length(resource) BETWEEN 1 AND 256
        AND coalesce(project_seq,1) >= 1 AND coalesce(authoring_version,1) >= 1)
   )`,
  `CREATE FUNCTION ${notificationPublishFunction}(in_tenant text,in_project text,in_kind text,
      in_resource text,in_project_seq bigint,in_authoring_version bigint) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE allocated bigint; retention_max constant bigint := 1000;
     BEGIN
       UPDATE project SET notification_next=notification_next+1
        WHERE tenant=in_tenant AND project=in_project
        RETURNING notification_next-1 INTO allocated;
       IF allocated IS NULL THEN RAISE EXCEPTION 'notification project is absent'; END IF;
       INSERT INTO project_notification
         (tenant,project,ordinal,kind,resource,project_seq,authoring_version)
       VALUES (in_tenant,in_project,allocated,in_kind,in_resource,in_project_seq,in_authoring_version);
       DELETE FROM project_notification
        WHERE tenant=in_tenant AND project=in_project AND ordinal <= allocated-retention_max;
       RETURN allocated;
     END $$`,
  `ALTER FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint) FROM PUBLIC`,
  `GRANT SELECT,INSERT,DELETE ON project_notification TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (notification_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${notificationPublishFunction}(text,text,text,text,bigint,bigint)
     TO ${ticketServiceRole}`,
  `GRANT SELECT ON project_notification TO ${apiRole}`,
];

const durableDispatch = [
  roleStatement(selectorServiceRole),
  `CREATE FUNCTION ${dispatchAcceptanceFunction}(
      in_tenant text,in_project text,in_operation text,in_authority_kind text,
      in_authority_subject text,in_key_version text,in_key_digest text,in_payload_digest text,
      in_retained_key_digests text[],in_retained_payload_digests text[],in_command text,
      in_ordinary_soft_limit bigint,in_hard_limit bigint)
     RETURNS TABLE(result text,operation text,ordinal bigint,state text,authority_kind text,
       admission text,lifecycle_generation bigint,lifecycle text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE command_value jsonb; ticket_value bigint; expected_version bigint;
       view_watermark bigint; command_fields bigint; token_fields bigint; accepted record;
     BEGIN
       BEGIN command_value:=in_command::jsonb;
       EXCEPTION WHEN others THEN RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
         NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF jsonb_typeof(command_value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(command_value->'version') IS DISTINCT FROM 'number'
          OR command_value->>'version' IS DISTINCT FROM '1'
          OR jsonb_typeof(command_value->'command') IS DISTINCT FROM 'string'
          OR command_value->>'command' NOT IN ('ManualDispatch','ProposeDispatch')
          OR jsonb_typeof(command_value->'ticket') IS DISTINCT FROM 'number'
          OR coalesce(command_value->>'ticket','') !~ '^[1-9][0-9]*$'
          OR jsonb_typeof(command_value->'expectedTicketVersion') IS DISTINCT FROM 'number'
          OR coalesce(command_value->>'expectedTicketVersion','') !~ '^[1-9][0-9]*$' THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       SELECT count(*) INTO command_fields FROM jsonb_object_keys(command_value);
       IF (command_value->>'command'='ManualDispatch' AND command_fields<>4)
          OR (command_value->>'command'='ProposeDispatch' AND command_fields<>6) THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       BEGIN ticket_value:=(command_value->>'ticket')::bigint;
         expected_version:=(command_value->>'expectedTicketVersion')::bigint;
       EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'InvalidCommand'::text,
         NULL::text,NULL::bigint,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'command'='ProposeDispatch'
          AND jsonb_typeof(command_value->'observedViewToken') IS DISTINCT FROM 'object' THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF command_value->>'command'='ProposeDispatch' THEN
         SELECT count(*) INTO token_fields
           FROM jsonb_object_keys(command_value->'observedViewToken');
       END IF;
       IF command_value->>'command'='ProposeDispatch' AND (
          token_fields<>6
          OR jsonb_typeof(command_value->'observedViewToken'->'tenant') IS DISTINCT FROM 'string'
          OR jsonb_typeof(command_value->'observedViewToken'->'project') IS DISTINCT FROM 'string'
          OR command_value->'observedViewToken'->>'tenant' IS DISTINCT FROM in_tenant
          OR command_value->'observedViewToken'->>'project' IS DISTINCT FROM in_project
          OR jsonb_typeof(command_value->'observedViewToken'->'recoveryEpoch') IS DISTINCT FROM 'string'
          OR coalesce(length(command_value->'observedViewToken'->>'recoveryEpoch'),0)
             NOT BETWEEN 1 AND 256
          OR jsonb_typeof(command_value->'observedViewToken'->'schemaVersion') IS DISTINCT FROM 'number'
          OR command_value->'observedViewToken'->>'schemaVersion' IS DISTINCT FROM '1'
          OR jsonb_typeof(command_value->'observedViewToken'->'watermark') IS DISTINCT FROM 'number'
          OR coalesce(command_value->'observedViewToken'->>'watermark','') !~ '^(0|[1-9][0-9]*)$'
          OR jsonb_typeof(command_value->'observedViewToken'->'digest') IS DISTINCT FROM 'string'
          OR coalesce(command_value->'observedViewToken'->>'digest','') !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(command_value->'selectorDecisionReference') IS DISTINCT FROM 'string'
          OR coalesce(length(command_value->>'selectorDecisionReference'),0) NOT BETWEEN 1 AND 256) THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF command_value->>'command'='ProposeDispatch' THEN
         BEGIN view_watermark:=(command_value->'observedViewToken'->>'watermark')::bigint;
         EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'InvalidCommand'::text,
           NULL::text,NULL::bigint,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       END IF;
       SELECT * INTO accepted FROM ${acceptanceFunction}(
         in_tenant,in_project,in_operation,in_authority_kind,in_authority_subject,
         in_key_version,in_key_digest,in_payload_digest,in_retained_key_digests,
         in_retained_payload_digests,jsonb_build_object('version',1,'command','Decide',
           'event',jsonb_build_object('type','ResumeTicket','value',ticket_value))::text,
         in_ordinary_soft_limit,in_hard_limit);
       IF accepted.result='Accepted' THEN UPDATE operation AS stored
         SET command=in_command,command_tag=command_value->>'command'
         WHERE stored.tenant=in_tenant AND stored.project=in_project
           AND stored.operation=in_operation; END IF;
       RETURN QUERY SELECT accepted.result::text,accepted.operation::text,accepted.ordinal::bigint,
         accepted.state::text,accepted.authority_kind::text,accepted.admission::text,
         accepted.lifecycle_generation::bigint,accepted.lifecycle::text;
     END $$`,
  `ALTER FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${dispatchAcceptanceFunction}(text,text,text,text,text,text,text,text,text[],text[],text,bigint,bigint)
     TO ${apiRole}`,
  `GRANT UPDATE (command,command_tag) ON operation TO ${boundaryOwnerRole}`,
  `ALTER TABLE project_notification DROP CONSTRAINT project_notification_kind_is_known,
     ADD CONSTRAINT project_notification_kind_is_known CHECK
       (kind IN ('Operation','Ticket','Draft','Configuration','Project'))`,
  `CREATE TABLE dispatch_view (
     tenant text NOT NULL, project text NOT NULL, recovery_epoch text NOT NULL,
     watermark bigint NOT NULL, schema_version integer NOT NULL, digest text NOT NULL,
     PRIMARY KEY (tenant,project),
     FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
     FOREIGN KEY (recovery_epoch) REFERENCES recovery_epoch (epoch),
     CHECK (watermark >= 0 AND schema_version = 1 AND digest ~ '^[0-9a-f]{64}$')
   )`,
  `CREATE TABLE dispatch_candidate (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL,
     ticket_version bigint NOT NULL, work_fanout bigint NOT NULL,
     program text NOT NULL, rework_policy text NOT NULL,
     finalization_pricing text NOT NULL, resume_pricing text NOT NULL,
     finalizer text NOT NULL, configuration_revision text NOT NULL,
     configuration_digest text NOT NULL, configuration_canonical text NOT NULL,
     PRIMARY KEY (tenant,project,ticket),
     FOREIGN KEY (tenant,project) REFERENCES dispatch_view (tenant,project) ON DELETE CASCADE,
     FOREIGN KEY (tenant,project,configuration_revision,configuration_digest)
       REFERENCES configuration_revision (tenant,project,revision,digest),
     CHECK (ticket >= 1 AND ticket_version >= 1 AND work_fanout >= 1)
   )`,
  `CREATE TABLE dispatch_candidate_dependency (
     tenant text NOT NULL, project text NOT NULL, ticket bigint NOT NULL, dependency bigint NOT NULL,
     PRIMARY KEY (tenant,project,ticket,dependency),
     FOREIGN KEY (tenant,project,ticket) REFERENCES dispatch_candidate (tenant,project,ticket) ON DELETE CASCADE,
     CHECK (dependency >= 1)
   )`,
  `CREATE TABLE selector_project_state (
     tenant text NOT NULL, project text NOT NULL, notification_cursor bigint NOT NULL DEFAULT 0,
     recovery_epoch text, attention text NOT NULL DEFAULT 'Monitoring', updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project), CHECK (notification_cursor >= 0),
     CHECK (attention IN ('Monitoring','Attention','Stopped')),
     CHECK (recovery_epoch IS NULL OR length(recovery_epoch) BETWEEN 1 AND 256)
   )`,
  `CREATE TABLE selector_inventory_state (
     singleton integer PRIMARY KEY DEFAULT 1, tenant text, project text,
     CHECK (singleton=1), CHECK ((tenant IS NULL)=(project IS NULL))
   )`,
  `INSERT INTO selector_inventory_state (singleton) VALUES (1)`,
  `CREATE TABLE selector_interaction (
     ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
     selector_decision text PRIMARY KEY, tenant text NOT NULL, project text NOT NULL,
     instructions_version text NOT NULL, instructions text NOT NULL, observed_view text NOT NULL,
     context text NOT NULL, tool_activity text NOT NULL, result text NOT NULL,
     implementation_revision text NOT NULL, model_revision text NOT NULL, policy_revision text NOT NULL,
     accounting text NOT NULL, started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
     UNIQUE (selector_decision,tenant,project),
     CHECK (length(selector_decision) BETWEEN 1 AND 256),
     CHECK (length(instructions_version) BETWEEN 1 AND 256
       AND length(implementation_revision) BETWEEN 1 AND 256
       AND length(model_revision) BETWEEN 1 AND 256
       AND length(policy_revision) BETWEEN 1 AND 256),
     CHECK (length(instructions) <= 65536 AND length(observed_view) <= 65536
       AND length(context) <= 65536 AND length(tool_activity) <= 65536
       AND length(result) <= 65536 AND length(accounting) <= 65536),
     CHECK (completed_at >= started_at)
   )`,
  `CREATE TABLE selector_planning_intent (
     tenant text NOT NULL, project text NOT NULL, selector_decision text NOT NULL,
     intent text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant,project),
     FOREIGN KEY (selector_decision,tenant,project)
       REFERENCES selector_interaction (selector_decision,tenant,project)
     ,CHECK (length(intent) <= 65536)
   )`,
  `CREATE TABLE selector_proposal_delivery (
     selector_decision text PRIMARY KEY,
     tenant text NOT NULL, project text NOT NULL, operation text NOT NULL UNIQUE,
     command text NOT NULL, state text NOT NULL DEFAULT 'Pending', outcome text,
     attempts bigint NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
     reconciliation_attempts bigint NOT NULL DEFAULT 0,
     reconcile_at timestamptz NOT NULL DEFAULT now(),
     FOREIGN KEY (selector_decision,tenant,project)
       REFERENCES selector_interaction (selector_decision,tenant,project),
     CHECK (state IN ('Pending','Submitted','Terminal')),
     CHECK (attempts >= 0 AND reconciliation_attempts >= 0),
     CHECK (length(operation) BETWEEN 1 AND 256 AND length(command) <= 65536
       AND (outcome IS NULL OR length(outcome) <= 65536))
   )`,
  `CREATE INDEX selector_delivery_pending_due
     ON selector_proposal_delivery (retry_at,selector_decision)
     WHERE state='Pending'`,
  `CREATE INDEX selector_delivery_submitted_due
     ON selector_proposal_delivery (reconcile_at,selector_decision)
     WHERE state='Submitted'`,
  `CREATE INDEX selector_interaction_project_history
     ON selector_interaction (tenant,project,ordinal)`,
  `GRANT SELECT ON dispatch_view,dispatch_candidate,dispatch_candidate_dependency TO ${apiRole}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON selector_project_state,selector_inventory_state,selector_interaction,
     selector_planning_intent,selector_proposal_delivery TO ${selectorServiceRole}`,
  `GRANT USAGE,SELECT ON SEQUENCE selector_interaction_ordinal_seq TO ${selectorServiceRole}`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ON dispatch_view,dispatch_candidate,
     dispatch_candidate_dependency TO ${ticketServiceRole}`,
  `INSERT INTO project_readiness (tenant,project,ready,generation)
     SELECT tenant,project,true,1 FROM project WHERE lifecycle='Active'
     ON CONFLICT (tenant,project) DO UPDATE SET
       ready=true,generation=project_readiness.generation+1`,
];

/** The relations, triggers and boundaries the execution scheduler owns, which I6 adds. */
const durableExecutionScheduler = [
  roleStatement(schedulerRole),
  `ALTER ROLE ${schedulerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${schedulerRole}`,
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${schedulerRole}`,
  `GRANT USAGE ON SCHEMA public TO ${schedulerRole}`,
  `GRANT ${boundaryOwnerRole} TO CURRENT_USER`,
  `GRANT CREATE ON SCHEMA public TO ${boundaryOwnerRole}`,

  /**
   * A project's identity is its tenant and its project together, so the account
   * named for one carries both. The encoding is length-prefixed rather than
   * delimiter-joined because both halves are opaque text: a delimiter one of
   * them contains would let two projects spell one account name, which is one
   * entitlement two tenants would spend against.
   */
  `CREATE FUNCTION ${accountIdentityFunction}(in_tenant text, in_project text)
     RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT octet_length(in_tenant)::text || ':' || in_tenant
           || octet_length(in_project)::text || ':' || in_project
     $$`,

  `ALTER TABLE execution_request
     ADD COLUMN capacity_account       text,
     ADD COLUMN configuration_revision text,
     ADD COLUMN configuration_digest   text`,
  `UPDATE execution_request r
      SET capacity_account = ${accountIdentityFunction}(r.tenant, r.project),
          configuration_revision = j.configuration_revision,
          configuration_digest = j.configuration_digest
     FROM journal_entry j
    WHERE j.tenant = r.tenant AND j.project = r.project AND j.seq = r.authorizing_seq
      AND r.kind IN ('SpawnWork', 'SpawnEvaluation')`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM execution_request
                 WHERE kind IN ('SpawnWork','SpawnEvaluation')
                   AND (capacity_account IS NULL OR configuration_revision IS NULL
                        OR configuration_digest IS NULL))
     THEN RAISE EXCEPTION 'I6 found a spawn request with no retained configuration to pin';
     END IF;
   END $$`,
  `ALTER TABLE execution_request
     ADD CONSTRAINT execution_request_pins_are_whole CHECK (
       (kind IN ('SpawnWork','SpawnEvaluation')) = (capacity_account IS NOT NULL)
       AND (kind IN ('SpawnWork','SpawnEvaluation')) = (configuration_revision IS NOT NULL)
       AND (kind IN ('SpawnWork','SpawnEvaluation')) = (configuration_digest IS NOT NULL)
       AND coalesce(length(capacity_account), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     ADD CONSTRAINT execution_request_configuration_is_retained
       FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
       REFERENCES configuration_revision (tenant, project, revision, digest),
     ADD CONSTRAINT execution_request_ticket_is_referenceable
       UNIQUE (tenant, project, request, ticket)`,
  `CREATE INDEX execution_request_claimable
     ON execution_request (kind, authorizing_seq) WHERE state = 'Open'`,

  `ALTER TABLE project
     ADD COLUMN manifest_next bigint NOT NULL DEFAULT 1,
     ADD CONSTRAINT project_manifest_next_is_positive CHECK (manifest_next >= 1)`,

  `CREATE TABLE execution_cluster (
     cluster         text    NOT NULL,
     slots_max       integer NOT NULL,
     policy_revision bigint  NOT NULL,
     PRIMARY KEY (cluster),
     CONSTRAINT execution_cluster_slots_are_bounded CHECK (slots_max >= 0),
     CONSTRAINT execution_cluster_policy_is_positive CHECK (policy_revision >= 1),
     CONSTRAINT execution_cluster_identity_is_bounded CHECK (
       length(cluster) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE TABLE capacity_account (
     account         text    NOT NULL,
     cluster         text    NOT NULL REFERENCES execution_cluster (cluster),
     reserved        integer NOT NULL,
     maximum         integer NOT NULL,
     policy_revision bigint  NOT NULL,
     PRIMARY KEY (account),
     CONSTRAINT capacity_account_entitlement_is_ordered CHECK (
       reserved >= 0 AND maximum >= reserved),
     CONSTRAINT capacity_account_policy_is_positive CHECK (policy_revision >= 1),
     CONSTRAINT capacity_account_identity_is_bounded CHECK (
       length(account) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     CONSTRAINT capacity_account_draws_from_one_cluster UNIQUE (account, cluster)
   )`,
  `INSERT INTO execution_cluster (cluster, slots_max, policy_revision)
     VALUES ('${executionCapacityDefaults.cluster}',
             ${executionCapacityDefaults.clusterSlotsMax}, 1)`,
  `INSERT INTO capacity_account (account, cluster, reserved, maximum, policy_revision)
     SELECT ${accountIdentityFunction}(p.tenant, p.project), ${capacityAccountDefaults}
       FROM project p ON CONFLICT (account) DO NOTHING`,
  `CREATE FUNCTION ${accountProvisionFunction}() RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     BEGIN
       INSERT INTO capacity_account (account, cluster, reserved, maximum, policy_revision)
       VALUES (${accountIdentityFunction}(NEW.tenant, NEW.project), ${capacityAccountDefaults})
       ON CONFLICT (account) DO NOTHING;
       RETURN NULL;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION ${accountProvisionFunction}() FROM PUBLIC`,
  `CREATE TRIGGER project_has_a_capacity_account
     AFTER INSERT ON project
     FOR EACH ROW EXECUTE FUNCTION ${accountProvisionFunction}()`,

  `CREATE TABLE execution (
     tenant                 text   NOT NULL,
     project                text   NOT NULL,
     execution              text   NOT NULL,
     ticket                 bigint NOT NULL,
     task                   bigint NOT NULL,
     source_request         text   NOT NULL,
     account                text   NOT NULL,
     cluster                text   NOT NULL,
     configuration_revision text   NOT NULL,
     configuration_digest   text   NOT NULL,
     status                 text   NOT NULL DEFAULT 'Queued',
     outcome                text,
     blocked_reason         text,
     result_manifest        text,
     completion_operation   text,
     attempt_next           bigint NOT NULL DEFAULT 1,
     retries_spent          bigint NOT NULL DEFAULT 0,
     placement_backoff_from timestamptz,
     registered_at          timestamptz NOT NULL DEFAULT now(),
     terminal_at            timestamptz,
     PRIMARY KEY (tenant, project, execution),
     CONSTRAINT execution_identity_is_never_reused UNIQUE (execution),
     CONSTRAINT execution_names_one_logical_task UNIQUE (tenant, project, ticket, task),
     CONSTRAINT execution_completion_is_its_own UNIQUE (tenant, project, completion_operation),
     CONSTRAINT execution_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT execution_has_its_authorized_task
       FOREIGN KEY (tenant, project, source_request, task)
       REFERENCES execution_request_task (tenant, project, request, task),
     CONSTRAINT execution_has_its_authorized_ticket
       FOREIGN KEY (tenant, project, source_request, ticket)
       REFERENCES execution_request (tenant, project, request, ticket),
     CONSTRAINT execution_account_draws_its_cluster
       FOREIGN KEY (account, cluster) REFERENCES capacity_account (account, cluster),
     CONSTRAINT execution_configuration_is_retained
       FOREIGN KEY (tenant, project, configuration_revision, configuration_digest)
       REFERENCES configuration_revision (tenant, project, revision, digest),
     CONSTRAINT execution_completion_is_an_operation
       FOREIGN KEY (tenant, project, completion_operation)
       REFERENCES operation (tenant, project, operation),
     CONSTRAINT execution_status_is_known CHECK (
       status IN (${schemaTextSet(allExecutionStatuses)})),
     CONSTRAINT execution_outcome_is_known CHECK (
       outcome IS NULL OR outcome IN (${schemaTextSet(allExecutionOutcomes)})),
     CONSTRAINT execution_blocked_reason_is_known CHECK (
       blocked_reason IS NULL OR blocked_reason IN (${schemaTextSet(allBlockedReasons)})),
     CONSTRAINT execution_counters_are_positive CHECK (
       ticket >= 1 AND task >= 1 AND attempt_next >= 1 AND retries_spent >= 0),
     CONSTRAINT execution_identity_is_bounded CHECK (
       length(execution) BETWEEN 1 AND ${schedulerIdentityCharsMax}),
     CONSTRAINT execution_outcome_is_whole CHECK (
       (status = 'Terminal') = (outcome IS NOT NULL)
       AND (status = 'Terminal') = (completion_operation IS NOT NULL)
       AND (status IN ('Terminal','Cancelled')) = (terminal_at IS NOT NULL)
       AND (outcome IS NOT NULL AND outcome IS DISTINCT FROM 'Blocked')
           = (result_manifest IS NOT NULL)
       AND (outcome IS NOT DISTINCT FROM 'Blocked') = (blocked_reason IS NOT NULL))
   )`,
  `CREATE INDEX execution_queued ON execution (cluster, registered_at) WHERE status = 'Queued'`,
  `CREATE INDEX execution_active_by_cluster ON execution (cluster)
     WHERE status IN ('Admitted','Launching','Running')`,
  `CREATE INDEX execution_active_by_account ON execution (account)
     WHERE status IN ('Admitted','Launching','Running')`,
  `CREATE INDEX execution_live_by_project ON execution (tenant, project, status)
     WHERE status NOT IN ('Terminal','Cancelled')`,
  `CREATE INDEX execution_by_request ON execution (tenant, project, source_request)`,

  `CREATE TABLE execution_attempt (
     tenant           text   NOT NULL,
     project          text   NOT NULL,
     execution        text   NOT NULL,
     attempt          text   NOT NULL,
     attempt_number   bigint NOT NULL,
     generation       bigint NOT NULL DEFAULT 1,
     recovery_epoch   text   NOT NULL REFERENCES recovery_epoch (epoch),
     state            text   NOT NULL DEFAULT 'Placing',
     lease_owner      text,
     lease_expires_at timestamptz,
     workload         text,
     evidence         text,
     opened_at        timestamptz NOT NULL DEFAULT now(),
     ended_at         timestamptz,
     PRIMARY KEY (tenant, project, execution, attempt_number),
     CONSTRAINT execution_attempt_identity_is_never_reused UNIQUE (attempt),
     CONSTRAINT execution_attempt_identity_is_local UNIQUE (tenant, project, execution, attempt),
     CONSTRAINT execution_attempt_has_its_execution
       FOREIGN KEY (tenant, project, execution) REFERENCES execution (tenant, project, execution),
     CONSTRAINT execution_attempt_state_is_known CHECK (
       state IN (${schemaTextSet(allAttemptStates)})),
     CONSTRAINT execution_attempt_lease_is_whole CHECK (
       (lease_owner IS NULL) = (lease_expires_at IS NULL)),
     CONSTRAINT execution_attempt_ending_is_whole CHECK (
       (state IN ('Placing','Running')) = (ended_at IS NULL)),
     CONSTRAINT execution_attempt_evidence_is_whole CHECK (
       evidence IS NULL OR state NOT IN ('Placing','Running')),
     CONSTRAINT execution_attempt_counters_are_positive CHECK (
       attempt_number >= 1 AND generation >= 1),
     CONSTRAINT execution_attempt_text_is_bounded CHECK (
       length(attempt) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(lease_owner), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(workload), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(evidence), 0) <= ${schedulerEvidenceCharsMax})
   )`,
  `CREATE UNIQUE INDEX execution_attempt_one_authoritative
     ON execution_attempt (tenant, project, execution) WHERE state IN ('Placing','Running')`,
  `CREATE INDEX execution_attempt_lease_expiry ON execution_attempt (lease_expires_at)
     WHERE state IN ('Placing','Running')`,
  `CREATE INDEX execution_attempt_epoch ON execution_attempt (recovery_epoch)
     WHERE state IN ('Placing','Running')`,

  `CREATE TABLE execution_result (
     tenant           text    NOT NULL,
     project          text    NOT NULL,
     manifest         text    NOT NULL,
     execution        text    NOT NULL,
     attempt          text    NOT NULL,
     manifest_ordinal bigint  NOT NULL,
     schema_version   integer NOT NULL,
     digest           text    NOT NULL,
     verdict          text    NOT NULL,
     recorded_at      timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, manifest),
     CONSTRAINT execution_result_identity_is_never_reused UNIQUE (manifest),
     CONSTRAINT execution_result_ordinal_is_project_local UNIQUE (tenant, project, manifest_ordinal),
     CONSTRAINT execution_result_is_one_per_execution UNIQUE (tenant, project, execution),
     CONSTRAINT execution_result_is_referenceable UNIQUE (tenant, project, execution, manifest),
     CONSTRAINT execution_result_is_one_per_attempt UNIQUE (tenant, project, attempt),
     CONSTRAINT execution_result_has_its_attempt
       FOREIGN KEY (tenant, project, execution, attempt)
       REFERENCES execution_attempt (tenant, project, execution, attempt),
     CONSTRAINT execution_result_verdict_is_known CHECK (
       verdict IN (${schemaTextSet(verdictTags)})),
     CONSTRAINT execution_result_counters_are_positive CHECK (
       manifest_ordinal >= 1 AND schema_version >= 1),
     CONSTRAINT execution_result_digest_is_hex CHECK (
       digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
     CONSTRAINT execution_result_identity_is_bounded CHECK (
       length(manifest) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE TABLE execution_result_artifact (
     tenant   text    NOT NULL,
     project  text    NOT NULL,
     manifest text    NOT NULL,
     ordinal  integer NOT NULL,
     role     text    NOT NULL,
     path     text    NOT NULL,
     digest   text    NOT NULL,
     bytes    bigint  NOT NULL,
     PRIMARY KEY (tenant, project, manifest, ordinal),
     CONSTRAINT execution_result_artifact_has_its_manifest
       FOREIGN KEY (tenant, project, manifest) REFERENCES execution_result (tenant, project, manifest),
     CONSTRAINT execution_result_artifact_path_is_declared_once
       UNIQUE (tenant, project, manifest, path),
     CONSTRAINT execution_result_artifact_role_is_known CHECK (
       role IN (${schemaTextSet(allArtifactRoles)})),
     CONSTRAINT execution_result_artifact_count_is_bounded CHECK (
       ordinal BETWEEN 1 AND ${manifestArtifactsMax}),
     CONSTRAINT execution_result_artifact_size_is_bounded CHECK (
       bytes BETWEEN 0 AND ${artifactBytesMax}),
     CONSTRAINT execution_result_artifact_digest_is_hex CHECK (
       digest ~ '^[0-9a-f]{${artifactDigestChars}}$'),
     CONSTRAINT execution_result_artifact_path_is_normalized CHECK (
       length(path) BETWEEN 1 AND ${artifactPathCharsMax}
       AND path !~ '^/' AND path !~ '//' AND path !~ '[\\\\]'
       AND path !~ '(^|/)[.][.]?(/|$)'
       AND path !~ '[[:cntrl:]]'
       AND path !~ '(^|/)[[:space:]]' AND path !~ '[[:space:]](/|$)')
   )`,
  `CREATE FUNCTION execution_result_is_immutable() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION
         'result manifest % is written once, and a manifest that could be edited is not evidence',
         OLD.manifest
         USING ERRCODE = 'integrity_constraint_violation';
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_result_is_immutable() FROM PUBLIC`,
  `CREATE TRIGGER execution_result_is_written_once
     BEFORE UPDATE OR DELETE ON execution_result
     FOR EACH ROW EXECUTE FUNCTION execution_result_is_immutable()`,
  `CREATE TRIGGER execution_result_artifact_is_written_once
     BEFORE UPDATE OR DELETE ON execution_result_artifact
     FOR EACH ROW EXECUTE FUNCTION execution_result_is_immutable()`,
  /**
   * The body runs as whoever wrote the row rather than as the boundary owner,
   * so the schemas it resolves names in are that caller's. `TEMPORARY` is a
   * privilege every role holds by default and a temporary schema is searched
   * ahead of `public`, so an unpinned path lets the writer stand an empty
   * `execution_attempt` in front of the real one and read back no fence.
   */
  `CREATE FUNCTION execution_result_reporter_is_unfenced() RETURNS trigger
     LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE reporter text;
     BEGIN
       SELECT a.state INTO reporter FROM execution_attempt a
        WHERE a.tenant = NEW.tenant AND a.project = NEW.project
          AND a.execution = NEW.execution AND a.attempt = NEW.attempt;
       IF reporter = 'Superseded' THEN
         RAISE EXCEPTION
           'attempt % was fenced, and a fenced reporter''s manifest is not evidence',
           NEW.attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_result_reporter_is_unfenced() FROM PUBLIC`,
  `CREATE TRIGGER execution_result_comes_from_an_unfenced_attempt
     BEFORE INSERT ON execution_result
     FOR EACH ROW EXECUTE FUNCTION execution_result_reporter_is_unfenced()`,
  `ALTER TABLE execution ADD CONSTRAINT execution_result_is_its_own
     FOREIGN KEY (tenant, project, execution, result_manifest)
     REFERENCES execution_result (tenant, project, execution, manifest)`,

  `CREATE TABLE scheduler_incident (
     tenant      text NOT NULL,
     project     text NOT NULL,
     incident    text NOT NULL,
     kind        text NOT NULL,
     execution   text,
     attempt     text,
     evidence    text NOT NULL,
     observed_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant, project, incident),
     CONSTRAINT scheduler_incident_identity_is_never_reused UNIQUE (incident),
     CONSTRAINT scheduler_incident_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT scheduler_incident_kind_is_known CHECK (
       kind IN (${schemaTextSet(allSchedulerIncidentKinds)})),
     CONSTRAINT scheduler_incident_evidence_is_bounded CHECK (
       length(evidence) BETWEEN 1 AND ${schedulerEvidenceCharsMax}),
     CONSTRAINT scheduler_incident_subject_is_bounded CHECK (
       coalesce(length(execution), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax}
       AND coalesce(length(attempt), 1) BETWEEN 1 AND ${schedulerIdentityCharsMax})
   )`,
  `CREATE INDEX scheduler_incident_recent ON scheduler_incident (tenant, project, observed_at DESC)`,
];

/**
 * The server's own statements of what may move, and the boundaries the runtime
 * roles reach it through. The boundary owner owns what its `SECURITY DEFINER`
 * bodies call and reads what they read, and the scheduler is granted the move
 * table because its own status updates are what fire the trigger consulting it
 * and `SELECT` on the manifest counter because allocating an ordinal reads the
 * column it advances.
 */
const durableExecutionSchedulerBoundaries = [
  `CREATE FUNCTION ${statusMoveFunction}(before text, after text) RETURNS boolean
     LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT CASE before
         WHEN 'Queued'    THEN after IN ('Admitted', 'Cancelled')
         WHEN 'Admitted'  THEN after IN ('Launching', 'Terminal', 'Cancelled')
         WHEN 'Launching' THEN after IN ('Running', 'Terminal', 'Cancelled')
         WHEN 'Running'   THEN after IN ('Terminal', 'Cancelled')
         WHEN 'Terminal'  THEN after = 'Terminal'
         WHEN 'Cancelled' THEN after = 'Cancelled'
       END $$`,
  `CREATE FUNCTION execution_moves_legally() RETURNS trigger
     LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE reported text;
     BEGIN
       IF OLD.status IN ('Terminal', 'Cancelled') THEN
         RAISE EXCEPTION 'execution % is already %, and a settled execution is written once',
           OLD.execution, OLD.status USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.execution, NEW.ticket, NEW.task, NEW.source_request,
           NEW.account, NEW.cluster, NEW.configuration_revision, NEW.configuration_digest)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.execution, OLD.ticket, OLD.task, OLD.source_request,
           OLD.account, OLD.cluster, OLD.configuration_revision, OLD.configuration_digest) THEN
         RAISE EXCEPTION 'execution % would change an identity or a pin it was registered under',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.status IS DISTINCT FROM OLD.status
          AND NOT ${statusMoveFunction}(OLD.status, NEW.status) THEN
         RAISE EXCEPTION 'execution % may not move from % to %',
           OLD.execution, OLD.status, NEW.status
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.attempt_next < OLD.attempt_next OR NEW.retries_spent < OLD.retries_spent THEN
         RAISE EXCEPTION 'execution % would reuse an attempt number or unspend a retry',
           OLD.execution USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.result_manifest IS NOT NULL THEN
         SELECT r.verdict INTO reported FROM execution_result r
          WHERE r.tenant = NEW.tenant AND r.project = NEW.project
            AND r.manifest = NEW.result_manifest;
         IF (NEW.outcome = 'Passed') IS DISTINCT FROM (reported = 'Pass') THEN
           RAISE EXCEPTION 'execution % settles % over a manifest that reported %',
             OLD.execution, NEW.outcome, reported
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE ALL ON FUNCTION ${statusMoveFunction}(text, text) FROM PUBLIC`,
  `REVOKE EXECUTE ON FUNCTION execution_moves_legally() FROM PUBLIC`,
  `CREATE TRIGGER execution_status_moves_legally
     BEFORE UPDATE ON execution
     FOR EACH ROW EXECUTE FUNCTION execution_moves_legally()`,
  `CREATE FUNCTION execution_attempt_is_fenced() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state NOT IN ('Placing', 'Running') THEN
         RAISE EXCEPTION 'attempt % is already %, and a finished attempt is written once',
           OLD.attempt, OLD.state USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF (NEW.tenant, NEW.project, NEW.execution, NEW.attempt, NEW.attempt_number,
           NEW.recovery_epoch)
          IS DISTINCT FROM
          (OLD.tenant, OLD.project, OLD.execution, OLD.attempt, OLD.attempt_number,
           OLD.recovery_epoch) THEN
         RAISE EXCEPTION 'attempt % would change the identity or epoch it was issued under',
           OLD.attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.generation < OLD.generation THEN
         RAISE EXCEPTION 'attempt % would move its generation backwards', OLD.attempt
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.state = 'Running' AND NEW.state = 'Placing' THEN
         RAISE EXCEPTION 'attempt % would return to placement after running', OLD.attempt
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
  `REVOKE EXECUTE ON FUNCTION execution_attempt_is_fenced() FROM PUBLIC`,
  `CREATE TRIGGER execution_attempt_is_fenced
     BEFORE UPDATE ON execution_attempt
     FOR EACH ROW EXECUTE FUNCTION execution_attempt_is_fenced()`,

  `CREATE FUNCTION ${digestFoldFunction}(in_digest text) RETURNS bigint
     LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT ('x' || substr(in_digest, 1, ${resultDigestFoldHexChars}))
              ::bit(${resultDigestFoldHexChars * 4})::bigint + 1
     $$`,
  `REVOKE ALL ON FUNCTION ${digestFoldFunction}(text) FROM PUBLIC`,

  `CREATE FUNCTION ${completionFunction}(
      in_tenant text, in_project text, in_execution text,
      in_ticket bigint, in_task bigint, in_source_effect integer,
      in_outcome text, in_manifest text, in_manifest_digest text, in_reason text,
      in_operation text, in_authority_subject text)
     RETURNS TABLE(result text, operation text, ordinal bigint)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; command_tag text;
     BEGIN
       IF in_outcome NOT IN (${schemaTextSet(allExecutionOutcomes)}) THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
         LEFT JOIN execution_result r
           ON r.tenant = e.tenant AND r.project = e.project AND r.execution = e.execution
        WHERE e.tenant = in_tenant AND e.project = in_project AND e.execution = in_execution
        FOR UPDATE OF e;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownExecution'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.completion_operation IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, bound.completion_operation::text,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = bound.completion_operation);
         RETURN;
       END IF;
       IF bound.status IN ('Terminal', 'Cancelled')
          OR bound.ticket <> in_ticket OR bound.task <> in_task
          OR bound.effect_position <> in_source_effect
          OR (in_outcome = 'Blocked') <> (in_manifest IS NULL)
          OR (in_outcome = 'Blocked') <> (in_reason IS NOT NULL)
          OR (in_reason IS NOT NULL AND in_reason NOT IN (${schemaTextSet(allBlockedReasons)}))
          OR (in_manifest IS NOT NULL
              AND (bound.manifest IS DISTINCT FROM in_manifest
                   OR bound.digest IS DISTINCT FROM in_manifest_digest))
          OR (in_outcome <> 'Blocked'
              AND (bound.verdict IS NULL
                   OR (in_outcome = 'Passed') <> (bound.verdict = 'Pass')))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF in_outcome = 'Blocked' THEN
         command_tag := 'ExecutionBlocked';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'ExecutionBlocked', 'value',
             jsonb_build_object('ticket', bound.ticket, 'reason', in_reason)));
       ELSE
         command_tag := 'TaskDone';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'TaskDone', 'value',
             jsonb_build_object('ticket', bound.ticket, 'tid', bound.task,
               'verdict', bound.verdict,
               'result', jsonb_build_object(
                 'manifest', bound.manifest_ordinal,
                 'digest', ${digestFoldFunction}(bound.digest),
                 'schema', bound.schema_version))));
       END IF;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the completion this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, '${executionSchedulerAuthorityKind}',
          in_authority_subject, 'CorrectnessReducing', 'scheduler-v1',
          encode(sha256(convert_to('execution:' || in_execution, 'UTF8')), 'hex'),
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, command_tag);
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       UPDATE execution
          SET status = 'Terminal', outcome = in_outcome, blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$`,

  `CREATE FUNCTION ${activeWorkFunction}(in_tenant text, in_project text)
     RETURNS TABLE(queued bigint, admitted bigint, launching bigint, running bigint,
                   cluster_slots_max bigint, cluster_active bigint,
                   account_maximum bigint, account_active bigint, account_deficit bigint)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
       SELECT own.queued, own.admitted, own.launching, own.running,
              coalesce(c.slots_max, 0)::bigint, coalesce(clustered.active, 0),
              coalesce(a.maximum, 0)::bigint, coalesce(held.active, 0),
              greatest(coalesce(a.reserved, 0) - coalesce(held.active, 0), 0)::bigint
         FROM (SELECT count(*) FILTER (WHERE e.status = 'Queued')    AS queued,
                      count(*) FILTER (WHERE e.status = 'Admitted')  AS admitted,
                      count(*) FILTER (WHERE e.status = 'Launching') AS launching,
                      count(*) FILTER (WHERE e.status = 'Running')   AS running
                 FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project) own
         LEFT JOIN capacity_account a
                ON a.account = ${accountIdentityFunction}(in_tenant, in_project)
         LEFT JOIN execution_cluster c ON c.cluster = a.cluster
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.cluster = a.cluster
                               AND x.status IN ('Admitted','Launching','Running')) clustered ON true
         LEFT JOIN LATERAL (SELECT count(*) AS active FROM execution x
                             WHERE x.account = a.account
                               AND x.status IN ('Admitted','Launching','Running')) held ON true
     $$`,
  `CREATE FUNCTION ${backlogFunction}(in_tenant text, in_project text)
     RETURNS TABLE(project_backlog bigint, installation_backlog bigint)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
       SELECT (SELECT count(*) FROM execution e
                WHERE e.tenant = in_tenant AND e.project = in_project
                  AND e.status NOT IN ('Terminal', 'Cancelled'))
            + (SELECT count(*) FROM execution_request q
                 JOIN execution_request_task t
                   ON t.tenant = q.tenant AND t.project = q.project AND t.request = q.request
                WHERE q.tenant = in_tenant AND q.project = in_project
                  AND q.kind IN ('SpawnWork', 'SpawnEvaluation') AND q.state = 'Open'),
              (SELECT count(*) FROM execution e
                WHERE e.status NOT IN ('Terminal', 'Cancelled'))
     $$`,

  `ALTER FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${activeWorkFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${backlogFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${statusMoveFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${digestFoldFunction}(text) OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${accountProvisionFunction}() OWNER TO ${boundaryOwnerRole}`,
  `ALTER FUNCTION ${accountIdentityFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${accountIdentityFunction}(text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${accountIdentityFunction}(text,text) TO ${ticketServiceRole}`,
  `REVOKE ALL ON FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${activeWorkFunction}(text,text) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION ${backlogFunction}(text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${completionFunction}(text,text,text,bigint,bigint,integer,text,text,text,text,text,text) TO ${schedulerRole}`,
  `GRANT EXECUTE ON FUNCTION ${activeWorkFunction}(text,text), ${backlogFunction}(text,text)
     TO ${apiRole}, ${ticketServiceRole}`,
  `GRANT EXECUTE ON FUNCTION ${statusMoveFunction}(text,text) TO ${schedulerRole}`,

  `GRANT SELECT ON operation, decision_input, project, project_readiness, execution,
     execution_request, execution_request_task, execution_result, execution_cluster,
     capacity_account TO ${boundaryOwnerRole}`,
  `GRANT INSERT ON operation, decision_input, project_readiness,
     capacity_account TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ingress_next) ON project TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (ready, generation) ON project_readiness TO ${boundaryOwnerRole}`,
  `GRANT UPDATE (status, outcome, blocked_reason, result_manifest, completion_operation,
     terminal_at) ON execution TO ${boundaryOwnerRole}`,

  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation, manifest_next)
     ON project TO ${schedulerRole}`,
  `GRANT UPDATE (manifest_next) ON project TO ${schedulerRole}`,
  `GRANT SELECT ON recovery_epoch, execution_cluster, capacity_account TO ${schedulerRole}`,
  `GRANT SELECT ON execution_request, execution_request_task TO ${schedulerRole}`,
  `GRANT UPDATE (state, claim_owner, claim_generation, claim_expires_at)
     ON execution_request TO ${schedulerRole}`,
  `GRANT SELECT ON execution, execution_attempt, execution_result,
     execution_result_artifact, scheduler_incident TO ${schedulerRole}`,
  `GRANT INSERT (tenant, project, execution, ticket, task, source_request, account, cluster,
                 configuration_revision, configuration_digest) ON execution TO ${schedulerRole}`,
  `GRANT UPDATE (status, attempt_next, retries_spent, placement_backoff_from, terminal_at)
     ON execution TO ${schedulerRole}`,
  `GRANT INSERT ON execution_attempt, execution_result, execution_result_artifact,
     scheduler_incident TO ${schedulerRole}`,
  `GRANT UPDATE (state, generation, lease_owner, lease_expires_at, workload, evidence, ended_at)
     ON execution_attempt TO ${schedulerRole}`,

  `REVOKE ALL ON journal_entry, decision_input, operation, ticket_projection,
     project_notification, project_continuation, native_action, native_action_resolution,
     finalization_request, draft, draft_revision, configuration_revision
     FROM ${schedulerRole}`,
  `REVOKE ALL ON execution, execution_attempt, execution_result, execution_result_artifact,
     scheduler_incident, execution_cluster, capacity_account
     FROM ${apiRole}, ${ticketServiceRole}`,
  `REVOKE CREATE ON SCHEMA public FROM ${boundaryOwnerRole}`,
  `REVOKE ${boundaryOwnerRole} FROM CURRENT_USER`,
];

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "the project foundation",
    statements: [
      roleStatement(ticketServiceRole),
      ...foundationRelations,
      ...foundationGrants,
    ],
  },
  {
    version: 2,
    name: "the project inbox",
    statements: [
      roleStatement(apiRole),
      ...inboxRelations,
      ...inboxTerminality,
      ...inboxCancellation,
      ...inboxGrants,
    ],
  },
  {
    version: 3,
    name: "the project decision",
    statements: [
      ...decisionRelations,
      ...decisionTerminality,
      ...decisionGrants,
    ],
  },
  {
    version: 4,
    name: "the tenure fence",
    statements: [...tenureFence],
  },
  {
    version: 5,
    name: "the durable prioritized decision mailbox",
    statements: [...durableMailbox],
  },
  {
    version: 6,
    name: "native web reads",
    statements: [...nativeWebReads],
  },
  {
    version: 7,
    name: "native versioned authoring",
    statements: [...nativeAuthoring],
  },
  {
    version: 8,
    name: "bounded durable project notifications",
    statements: [...durableNotifications],
  },
  {
    version: 9,
    name: "selector-independent durable dispatch",
    statements: [...durableDispatch],
  },
  {
    version: 10,
    name: "the durable execution scheduler",
    statements: [
      ...durableExecutionScheduler,
      ...durableExecutionSchedulerBoundaries,
    ],
  },
];
