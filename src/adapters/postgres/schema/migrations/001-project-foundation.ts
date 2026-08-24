import { roleStatement, ticketServiceRole, type Migration } from "../shared.ts";

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

export const migration001: Migration = {
  version: 1,
  name: "the project foundation",
  statements: [
    roleStatement(ticketServiceRole),
    ...foundationRelations,
    ...foundationGrants,
  ],
};
