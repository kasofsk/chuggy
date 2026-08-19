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
 */

/** One migration: the version that orders it, the name that reports it, and the statements it applies. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** The role every runtime dispatcher connects as, named once so the grants and the suite agree. */
export const dispatcherRole = "chuggy_dispatcher";

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

const foundationGrants = [
  `GRANT SELECT ON recovery_epoch TO ${dispatcherRole}`,
  `GRANT SELECT, UPDATE ON project TO ${dispatcherRole}`,
  `GRANT SELECT, INSERT ON journal_entry TO ${dispatcherRole}`,
];

/**
 * Creates the runtime role if this database has never seen it. `CREATE ROLE`
 * has no `IF NOT EXISTS`, and a role is a cluster-wide object a sibling
 * database may already have made.
 */
const foundationRole = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${dispatcherRole}') THEN
      CREATE ROLE ${dispatcherRole} NOLOGIN;
    END IF;
  END
  $$
`;

/** Every migration in version order, which is the order the runner applies them in. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "the project foundation",
    statements: [foundationRole, ...foundationRelations, ...foundationGrants],
  },
];
