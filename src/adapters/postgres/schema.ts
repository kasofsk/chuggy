/**
 * The relations the PostgreSQL foundation owns, as the migrations that create
 * them.
 *
 * `docs/design/006-durable-project-dispatch.md` requires five things of every
 * new mutable relation, so each one states them here rather than in a doc that
 * would drift from the DDL beside it.
 *
 * `recovery_epoch` — the global, unpredictable, never-reused epoch a restore
 * advances before it permits any mutation. Owned by the control plane; the
 * dispatcher role may read it and may not write it, because a runtime that
 * could mint an epoch could unfence itself. It has no project key by design:
 * it is global authority, and a per-project counter restored from the past is
 * exactly what it exists to defeat. Identity is the epoch text, unique, so a
 * replayed establish is refused rather than absorbed. It is changed by
 * `establishRecoveryEpoch` alone, appending one row. Unfinished work after a
 * restore is found by comparing the current epoch to the one every live lease
 * and journal entry carries.
 *
 * `project` — one authoritative lifecycle and ownership row per partition.
 * Owned by the control plane for insertion and by the dispatcher role for the
 * ownership columns, which is why the dispatcher is granted UPDATE and not
 * INSERT: provisioning is not a decision. Its composite key is
 * `(tenant, project)` and it is the parent every other relation here points
 * at. Ownership is changed by `acquire`, `renew`, `release` and `fence`, each
 * locking this row; the head is changed only by `append`, in the same
 * transaction as the entry it counts. Unfinished work is found by selecting
 * active projects whose lease has expired by database time.
 *
 * `journal_entry` — the append-only decision log, partitioned by the composite
 * key it carries into its own primary key `(tenant, project, seq)`. The
 * dispatcher role is granted INSERT and SELECT and deliberately not UPDATE or
 * DELETE: a runtime that could rewrite history would make replay an opinion.
 * Its identity is that primary key, and `seq` is the project's head plus one,
 * so the identity and the concurrency control are the same value. It is
 * changed by `append` and by nothing else. Unfinished work does not exist for
 * it — an entry is committed or it was rolled back — which is the whole point
 * of putting the head in the same transaction.
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
 * decision transaction onward, by the dispatcher for its outcome. Its
 * composite key is `(tenant, project)` and it points at
 * `project`; its identity is `(tenant, project, operation)` with the opaque
 * operation identity unique globally, because 006 mints those outside any
 * partition and a reused one would answer another project's poll. Its
 * idempotency key is `(tenant, project, authority_kind, key_digest)`, unique
 * and permanent, which is what makes a retry find its original rather than
 * create a second. It is changed by acceptance and by cancellation, and a
 * trigger refuses any later change to a state or a settling authority already
 * terminal. Unfinished work is found by selecting `Pending` operations for a
 * partition.
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
 * WHY THERE IS NO OUTCOME COLUMN YET. The only outcome I1 can write is
 * cancellation, whose code would restate `state`, and a stored duplicate of a
 * derivable fact is standing rule 3's finding. The stable refusal code and the
 * decided project sequence arrive with the decision transaction that produces
 * them.
 *
 * `inbox_item` — the project's durable inbox, in the ordinal order acceptance
 * allocated. Owned by the API role for insertion and, through the cancellation
 * function alone, for making an item non-consumable; acknowledgement is the
 * writer's and arrives with it. Its composite key is `(tenant, project)`, its
 * identity is
 * `(tenant, project, ordinal)`, and its source key `(tenant, project,
 * operation)` is unique, which is the deduplication 006 requires before
 * ordinal allocation — every item I1 admits is an accepted operation's, and
 * a second source kind arrives with the slice that has one. It is changed by
 * acceptance and by cancellation. Unfinished work is found by selecting
 * consumable items for a partition in ordinal order, which is also what
 * activation verifies the inbox with.
 *
 * `project_readiness` — the discovery index over that inbox, and the only
 * thing fleet discovery reads. Owned by the API role, whose grant covers
 * `ready` and `generation`, and by the dispatcher role, whose grant covers
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
 */

import {
  authorityCharsMax,
  operationCommandCharsMax,
  operationIdentityCharsMax,
} from "../../interpreter/operationInbox.ts";

/** One migration: the version that orders it, the name that reports it, and the statements it applies. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** The role every runtime dispatcher connects as, named once so the grants and the suite agree. */
export const dispatcherRole = "chuggy_dispatcher";

/** The role the authenticated API connects as, which accepts and cancels work and decides none of it. */
export const apiRole = "chuggy_api";

/** The whole of a cancellation, named once so the grant, the adapter and the suite agree on it. */
export const cancellationFunction = "cancel_pending_operation";

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
 * role as owner of a project another dispatcher holds, or place an entry at a
 * seq the primary key has not taken and move `head` to match, because the
 * fences that would refuse those — lease validity, epoch currency, expected
 * head, lifecycle admission — all live in this adapter. Closing it takes a
 * constraint in the database on what those columns may become rather than a
 * narrower grant on which of them may be written; kasofsk/chuggy#115 settled
 * that, and a later slice carries it.
 */
const foundationGrants = [
  `GRANT SELECT ON recovery_epoch TO ${dispatcherRole}`,
  `GRANT SELECT ON project TO ${dispatcherRole}`,
  `GRANT UPDATE (head, owner, lease_expires_at, recovery_epoch, fencing_epoch)
     ON project TO ${dispatcherRole}`,
  `GRANT SELECT, INSERT ON journal_entry TO ${dispatcherRole}`,
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
  `GRANT SELECT ON inbox_item TO ${dispatcherRole}`,
  `GRANT SELECT ON project_readiness TO ${dispatcherRole}`,
  `GRANT UPDATE (ready) ON project_readiness TO ${dispatcherRole}`,
];

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "the project foundation",
    statements: [
      roleStatement(dispatcherRole),
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
];
