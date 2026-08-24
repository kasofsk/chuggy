import {
  authorityCharsMax,
  operationCommandCharsMax,
  operationIdentityCharsMax,
} from "../../../../interpreter/operationInbox.ts";
import {
  apiRole,
  cancellationFunction,
  roleStatement,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

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
 * decide an operation instead. A `SECURITY DEFINER` body runs as its owner, so
 * the `search_path` is pinned on the definition against a caller shadowing
 * `operation` — and that owner is whoever applied this migration only until
 * migration 5, which hands it to `boundaryOwnerRole` with the other such bodies
 * the chain has defined by then, and `test/postgres/privileges.test.ts` is what
 * holds every later one to the same rule for kasofsk/chuggy#134.
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

export const migration002: Migration = {
  version: 2,
  name: "the project inbox",
  statements: [
    roleStatement(apiRole),
    ...inboxRelations,
    ...inboxTerminality,
    ...inboxCancellation,
    ...inboxGrants,
  ],
};
