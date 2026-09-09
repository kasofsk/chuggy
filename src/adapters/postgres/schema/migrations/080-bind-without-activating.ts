/**
 * A project binds repositories and privileges none of them, and the owner has a
 * door that binds one without electing it.
 *
 * WHY THE ACTIVATION LEDGER GOES RATHER THAN GAINS A ROW. It existed to answer
 * which of a project's bindings future work discovers. A ticket names its own
 * repository, so nothing asks that any more, and a relation kept for a question
 * nobody asks is a second place a repository's standing can be read from.
 *
 * THE BINDING READ GOES BACK TO 027'S BODY, AND IT IS ON ITS WAY OUT. Session
 * placement, the ticket service, the finalizer's fallback, the configuration
 * importer and the API's configuration-snapshot read still want exactly one
 * repository for a project; until each reads its ticket's own, they get the
 * oldest binding rather than an elected one. The function is dropped with its
 * last caller.
 *
 * `project_repository_bind_operation` IS NOT THE RETIRED LEDGER RENAMED. What
 * made the ledger a second standing was that a read elected a project's
 * repository from its latest row. Nothing reads this relation to choose a
 * repository, no runtime role may read it at all, and the door consults it by
 * operation identity alone; delete it and what comes back is the replay below,
 * not an election.
 *
 * THE OPERATION IDENTITY IS OFF THE BINDING ROW, BECAUSE THE OPERATION MAY NOT
 * INSERT ONE. `AlreadyBound` binds nothing, so a column on `project_repository`
 * would leave that identity unspent and replayable against a different
 * repository. Every accepted outcome is recorded here instead, and a replay is
 * answered by the row's presence and argument equality, not by its stored
 * outcome, which is audit-only. Bindings older than this migration get no
 * row: no operation made them, and naming this migration as their authority
 * would write a fact that never happened onto rows
 * `project_repository_is_immutable` lets nobody correct.
 *
 * A REFUSAL SPENDS NOTHING, which is what 040 did and is kept deliberately. An
 * operator who mistyped an epoch retries the same intent under the same
 * identity; were a refusal to spend it, that retry would come back
 * `OperationConflict` and report an argument conflict over a binding the server
 * does not have.
 *
 * ONE IDENTITY NAMES ONE OPERATION FOR THE WHOLE INSTALLATION, as
 * `operation_identity_is_never_reused` already has it for the journalled inbox.
 * This door has one operator, and a partition key on the constraint would let a
 * replay under a mistyped tenant bind a second repository instead of being
 * refused.
 *
 * THE IMPORT FENCE ASKS WHETHER THE REPOSITORY IS BOUND. It compared the
 * importer's repository against the elected one; with no election it is an
 * existence check on the binding, at the epoch that binding was made under.
 * `StaleBinding` still names what went wrong — the binding the importer read is
 * not one the server has.
 */

import { finalizerIdentityCharsMax } from "../../../../interpreter/finalizer.ts";
import {
  authorityCharsMax,
  operationIdentityCharsMax,
} from "../../../../interpreter/operationInbox.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  notificationPublishFunction,
  repositoryActivationFunction,
  repositoryBindingReadFunction,
  repositoryBindingWriteFunction,
  repositoryConfigurationImportFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The oldest-binding read the election's remaining callers still need. */
const bindingRead = [
  `CREATE OR REPLACE FUNCTION ${repositoryBindingReadFunction}(in_tenant text,in_project text)
     RETURNS TABLE(repository text,recovery_epoch text)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     SELECT b.repository,b.recovery_epoch FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository LIMIT 1
     $$`,
];

const activationRetired = [
  `DROP FUNCTION ${repositoryActivationFunction}(text,text,text,text,text,text,text,text)`,
  `DROP TRIGGER project_repository_initial_activation ON project_repository`,
  `DROP FUNCTION project_repository_initial_activation()`,
  `DROP TABLE project_repository_activation`,
  `DROP FUNCTION project_repository_activation_is_immutable()`,
];

/**
 * What the door accepted, under whose authority, and whether it bound the
 * repository or found it already bound. The outcome is not derivable from the
 * binding, because a binding older than this relation has no operation at all
 * and the earliest one naming it is an `AlreadyBound`.
 */
const bindOperations = [
  `CREATE TABLE project_repository_bind_operation (
     operation         text PRIMARY KEY,
     tenant            text NOT NULL,
     project           text NOT NULL,
     repository        text NOT NULL,
     recovery_epoch    text NOT NULL REFERENCES recovery_epoch (epoch),
     authority_kind    text NOT NULL,
     authority_subject text NOT NULL,
     outcome           text NOT NULL,
     recorded_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT project_repository_bind_operation_names_a_binding
       FOREIGN KEY (tenant,project,repository)
       REFERENCES project_repository (tenant,project,repository),
     CONSTRAINT project_repository_bind_operation_was_accepted CHECK (
       outcome IN ('Bound','AlreadyBound')),
     CONSTRAINT project_repository_bind_operation_is_bounded CHECK (
       length(operation) BETWEEN 1 AND ${operationIdentityCharsMax}
       AND length(repository) BETWEEN 1 AND ${finalizerIdentityCharsMax}
       AND length(authority_kind) BETWEEN 1 AND ${authorityCharsMax}
       AND length(authority_subject) BETWEEN 1 AND ${authorityCharsMax})
   )`,
  `CREATE FUNCTION project_repository_bind_operation_is_immutable() RETURNS trigger
     LANGUAGE plpgsql AS $$ BEGIN
     RAISE EXCEPTION 'repository bind operations are immutable'
       USING ERRCODE='integrity_constraint_violation'; END $$`,
  `ALTER FUNCTION project_repository_bind_operation_is_immutable() OWNER TO ${boundaryOwnerRole}`,
  `CREATE TRIGGER project_repository_bind_operation_is_immutable
     BEFORE UPDATE OR DELETE ON project_repository_bind_operation
     FOR EACH ROW EXECUTE FUNCTION project_repository_bind_operation_is_immutable()`,
  `GRANT SELECT,INSERT ON project_repository_bind_operation TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON project_repository_bind_operation
     FROM ${apiRole},${ticketServiceRole},${selectorServiceRole},${schedulerRole},
          ${workerPlaneRole},${finalizerRole},${configurationImporterRole}`,
];

/**
 * The owner's door, which binds a repository and decides nothing else. The
 * operation lock makes a replay answer from the row it wrote, and the
 * repository lock is what serialises two projects reaching for one repository —
 * `project_repository_is_exclusive` would otherwise raise where an outcome
 * string belongs.
 */
const bindingDoor = [
  `CREATE FUNCTION ${repositoryBindingWriteFunction}(
     in_tenant text,in_project text,in_repository text,in_recovery_epoch text,
     in_operation text,in_authority_kind text,in_authority_subject text)
     RETURNS text LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE existing project_repository_bind_operation%ROWTYPE;
           holder project_repository%ROWTYPE;
           current_epoch text;
           accepted text;
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtextextended('operation:'||in_operation,0));
     SELECT * INTO existing FROM project_repository_bind_operation
      WHERE operation=in_operation;
     IF FOUND THEN
       IF existing.tenant=in_tenant AND existing.project=in_project
          AND existing.repository=in_repository
          AND existing.recovery_epoch=in_recovery_epoch
          AND existing.authority_kind=in_authority_kind
          AND existing.authority_subject=in_authority_subject
         THEN RETURN 'AlreadyBound'; END IF;
       RETURN 'OperationConflict';
     END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('repository:'||in_repository,0));
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='foreign_key_violation',
       MESSAGE='repository binding project is absent'; END IF;
     SELECT epoch INTO current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
     IF current_epoch IS DISTINCT FROM in_recovery_epoch
       THEN RETURN 'RecoveryEpochMismatch'; END IF;
     SELECT * INTO holder FROM project_repository WHERE repository=in_repository;
     IF FOUND THEN
       IF holder.tenant<>in_tenant OR holder.project<>in_project
         THEN RETURN 'RepositoryBoundElsewhere'; END IF;
       accepted := 'AlreadyBound';
     ELSE
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch);
       accepted := 'Bound';
     END IF;
     INSERT INTO project_repository_bind_operation
       (operation,tenant,project,repository,recovery_epoch,
        authority_kind,authority_subject,outcome)
       VALUES(in_operation,in_tenant,in_project,in_repository,in_recovery_epoch,
              in_authority_kind,in_authority_subject,accepted);
     RETURN accepted;
   END $$`,
  `ALTER FUNCTION ${repositoryBindingWriteFunction}(text,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryBindingWriteFunction}(text,text,text,text,text,text,text)
     FROM PUBLIC`,
];

const importFence = [
  `CREATE OR REPLACE FUNCTION ${repositoryConfigurationImportFunction}(
     in_tenant text,in_project text,in_expected_repository text,in_expected_recovery_epoch text,
     in_revision text,in_canonical text,in_digest text,in_commit text,
     in_path text,in_name text,in_kind text,in_subject text) RETURNS text
   LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
   DECLARE existing configuration_revision%ROWTYPE;
           provenance repository_configuration_provenance%ROWTYPE; inserted boolean := false;
   BEGIN
     PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR SHARE;
     PERFORM 1 FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_expected_repository
        AND b.recovery_epoch=in_expected_recovery_epoch;
     IF NOT FOUND THEN RETURN 'StaleBinding'; END IF;
     INSERT INTO configuration_revision
       (tenant,project,revision,parent,canonical,digest,authority_kind,authority_subject)
     VALUES (in_tenant,in_project,in_revision,NULL,in_canonical,in_digest,in_kind,in_subject)
     ON CONFLICT (tenant,project,revision) DO NOTHING RETURNING true INTO inserted;
     IF inserted IS NOT TRUE THEN
       SELECT * INTO existing FROM configuration_revision
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       IF existing.canonical<>in_canonical OR existing.digest<>in_digest OR existing.parent IS NOT NULL
         THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     END IF;
     INSERT INTO repository_configuration_provenance
       (tenant,project,revision,digest,repository,repository_commit,path,name)
     VALUES (in_tenant,in_project,in_revision,in_digest,in_expected_repository,in_commit,in_path,in_name)
     ON CONFLICT (tenant,project,revision) DO NOTHING;
     SELECT * INTO provenance FROM repository_configuration_provenance
      WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
     IF provenance.digest<>in_digest OR provenance.repository<>in_expected_repository
        OR provenance.repository_commit<>in_commit OR provenance.path<>in_path OR provenance.name<>in_name
       THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended(in_tenant||'/'||in_project,0));
     INSERT INTO repository_configuration_version (tenant,project,name,digest,number)
     SELECT in_tenant,in_project,in_name,in_digest,coalesce(max(number),0)+1
       FROM repository_configuration_version
      WHERE tenant=in_tenant AND project=in_project AND name=in_name
     ON CONFLICT (tenant,project,name,digest) DO NOTHING;
     IF inserted THEN
       PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
       RETURN 'Imported'; END IF;
     RETURN 'AlreadyImported';
   EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict';
   END $$`,
  `ALTER FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
];

export const migration080: Migration = {
  version: 80,
  name: "bind without activating",
  statements: [
    ...bindingRead,
    ...activationRetired,
    ...bindOperations,
    ...bindingDoor,
    ...importFence,
  ],
};
