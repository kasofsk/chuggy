import { phaseTags } from "../../../domain/generated/modelTypes.ts";
import {
  authorityCharsMax,
  operationCommandCharsMax,
  operationIdentityCharsMax,
} from "../../../interpreter/operationInbox.ts";
import { allRefusalCodes } from "../../../interpreter/projectDecision.ts";
import {
  allNativeActionResolutions,
  safetyResolution,
} from "../../../interpreter/ticketCommand.ts";
import {
  apiRole,
  cancellationFunction,
  roleStatement,
  schemaTextSet,
  ticketServiceRole,
  type Migration,
} from "./shared.ts";

export const foundationRelations = [
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
export const foundationGrants = [
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

export const inboxRelations = [
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
export const inboxTerminality = [
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
 * decide an operation instead. A `SECURITY DEFINER` body runs as its owner, so
 * the `search_path` is pinned on the definition against a caller shadowing
 * `operation` — and that owner is whoever applied this migration only until
 * migration 5, which hands it to `boundaryOwnerRole` with the other such bodies
 * the chain has defined by then, and `test/postgres/privileges.test.ts` is what
 * holds every later one to the same rule for kasofsk/chuggy#134.
 */
export const inboxCancellation = [
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
export const inboxGrants = [
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

export const decisionRelations = [
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
export const decisionTerminality = [
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
export const tenureFence = [
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

export const decisionGrants = [
  `GRANT SELECT ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (state, settled_at, settled_authority_kind,
                 settled_authority_subject, outcome_code, decided_seq,
                 refused_head, refused_lifecycle_generation)
     ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (consumable) ON inbox_item TO ${ticketServiceRole}`,
  `GRANT SELECT, INSERT ON ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (phase, seq) ON ticket_projection TO ${ticketServiceRole}`,
];

/**
 * The answers acceptance classifies as ordinary work, which is every answer but
 * the one that reduces outstanding correctness risk.
 */
export const acceptanceOrdinaryResolutions = allNativeActionResolutions.filter(
  (resolution) => resolution !== safetyResolution,
);

/**
 * The body of acceptance, installed by the migration that wrote it and
 * reinstalled by the one that widened the answers its grammar admits. There is
 * one body, so the two installations cannot become two grammars.
 */

export const foundationMigrations: readonly Migration[] = [
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
  { version: 4, name: "the tenure fence", statements: [...tenureFence] },
];
