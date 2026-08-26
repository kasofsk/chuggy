import {
  authorityCharsMax,
  operationIdentityCharsMax,
} from "../../../../interpreter/operationInbox.ts";
import { finalizerIdentityCharsMax } from "../../../../interpreter/finalizer.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  repositoryActivationFunction,
  repositoryBindingReadFunction,
  repositoryConfigurationImportFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

export const migration040: Migration = {
  version: 40,
  name: "append only repository activation",
  statements: [
    `CREATE TABLE project_repository_activation (
       activation        bigint GENERATED ALWAYS AS IDENTITY,
       tenant            text NOT NULL,
       project           text NOT NULL,
       repository        text NOT NULL,
       recovery_epoch    text NOT NULL REFERENCES recovery_epoch (epoch),
       operation         text NOT NULL UNIQUE,
       expected_repository text NOT NULL,
       authority_kind    text NOT NULL,
       authority_subject text NOT NULL,
       activated_at      timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,activation),
       CONSTRAINT project_repository_activation_has_binding
         FOREIGN KEY (tenant,project,repository)
         REFERENCES project_repository (tenant,project,repository),
       CONSTRAINT project_repository_activation_expected_binding_exists
         FOREIGN KEY (tenant,project,expected_repository)
         REFERENCES project_repository (tenant,project,repository),
       CONSTRAINT project_repository_activation_is_bounded CHECK (
         length(repository) BETWEEN 1 AND ${finalizerIdentityCharsMax}
         AND length(expected_repository) BETWEEN 1 AND ${finalizerIdentityCharsMax}
         AND length(operation) BETWEEN 1 AND ${operationIdentityCharsMax}
         AND length(authority_kind) BETWEEN 1 AND ${authorityCharsMax}
         AND length(authority_subject) BETWEEN 1 AND ${authorityCharsMax})
     )`,
    `GRANT SELECT,INSERT ON project_repository_activation TO ${boundaryOwnerRole}`,
    `GRANT USAGE ON SEQUENCE project_repository_activation_activation_seq TO ${boundaryOwnerRole}`,
    `GRANT INSERT ON project_repository TO ${boundaryOwnerRole}`,
    `INSERT INTO project_repository_activation
       (tenant,project,repository,recovery_epoch,operation,expected_repository,
        authority_kind,authority_subject,activated_at)
     SELECT DISTINCT ON (tenant,project)
       tenant,project,repository,recovery_epoch,'migration-040-'||gen_random_uuid()::text,
       repository,'Migration','040',bound_at
       FROM project_repository ORDER BY tenant,project,bound_at,repository`,
    `CREATE FUNCTION project_repository_initial_activation() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN
       INSERT INTO project_repository_activation
         (tenant,project,repository,recovery_epoch,operation,expected_repository,
          authority_kind,authority_subject,activated_at)
       SELECT NEW.tenant,NEW.project,NEW.repository,NEW.recovery_epoch,
              'binding-'||gen_random_uuid()::text,NEW.repository,'Binding','Initial',NEW.bound_at
        WHERE NOT EXISTS (SELECT 1 FROM project_repository_activation
                           WHERE tenant=NEW.tenant AND project=NEW.project);
       RETURN NEW; END $$`,
    `ALTER FUNCTION project_repository_initial_activation() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER project_repository_initial_activation AFTER INSERT ON project_repository
       FOR EACH ROW EXECUTE FUNCTION project_repository_initial_activation()`,
    `CREATE OR REPLACE FUNCTION ${repositoryBindingReadFunction}(in_tenant text,in_project text)
       RETURNS TABLE(repository text,recovery_epoch text)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.repository,a.recovery_epoch FROM project_repository_activation a
        WHERE a.tenant=in_tenant AND a.project=in_project
        ORDER BY a.activation DESC LIMIT 1
       $$`,
    `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(text,text) TO ${finalizerRole}`,
    `CREATE FUNCTION ${repositoryActivationFunction}(
       in_tenant text,in_project text,in_expected_repository text,in_repository text,
       in_recovery_epoch text,in_operation text,in_authority_kind text,in_authority_subject text)
       RETURNS text LANGUAGE plpgsql SECURITY DEFINER
       SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE existing project_repository_activation%ROWTYPE;
             active project_repository_activation%ROWTYPE;
             current_epoch text;
             repository_owner record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('operation:'||in_operation,0));
       SELECT * INTO existing FROM project_repository_activation WHERE operation=in_operation;
       IF FOUND THEN
         IF existing.tenant=in_tenant AND existing.project=in_project
            AND existing.expected_repository=in_expected_repository
            AND existing.repository=in_repository
            AND existing.recovery_epoch=in_recovery_epoch
            AND existing.authority_kind=in_authority_kind
            AND existing.authority_subject=in_authority_subject
           THEN RETURN 'AlreadyActivated'; END IF;
         RETURN 'OperationConflict';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended('repository:'||in_repository,0));
       PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR UPDATE;
       IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='foreign_key_violation',
         MESSAGE='repository activation project is absent'; END IF;
       SELECT * INTO active FROM project_repository_activation
        WHERE tenant=in_tenant AND project=in_project ORDER BY activation DESC LIMIT 1;
       IF NOT FOUND OR active.repository<>in_expected_repository
         THEN RETURN 'ExpectedRepositoryMismatch'; END IF;
       SELECT epoch INTO current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
       IF current_epoch IS DISTINCT FROM in_recovery_epoch
         THEN RETURN 'RecoveryEpochMismatch'; END IF;
       SELECT tenant,project INTO repository_owner FROM project_repository
        WHERE repository=in_repository;
       IF FOUND AND (repository_owner.tenant<>in_tenant OR repository_owner.project<>in_project)
         THEN RETURN 'RepositoryBoundElsewhere'; END IF;
       INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch)
         ON CONFLICT (tenant,project,repository) DO NOTHING;
       INSERT INTO project_repository_activation
         (tenant,project,repository,recovery_epoch,operation,expected_repository,
          authority_kind,authority_subject)
         VALUES(in_tenant,in_project,in_repository,in_recovery_epoch,in_operation,
                in_expected_repository,in_authority_kind,in_authority_subject);
       RETURN 'Activated';
     END $$`,
    `ALTER FUNCTION ${repositoryActivationFunction}(text,text,text,text,text,text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${repositoryActivationFunction}(text,text,text,text,text,text,text,text)
       FROM PUBLIC`,
    `REVOKE ALL ON project_repository_activation
       FROM ${apiRole},${ticketServiceRole},${selectorServiceRole},${schedulerRole},
            ${workerPlaneRole},${finalizerRole},${configurationImporterRole}`,
    `CREATE FUNCTION project_repository_is_immutable() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN
       RAISE EXCEPTION 'repository bindings are immutable'
         USING ERRCODE='integrity_constraint_violation'; END $$`,
    `ALTER FUNCTION project_repository_is_immutable() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER project_repository_is_immutable BEFORE UPDATE OR DELETE ON project_repository
       FOR EACH ROW EXECUTE FUNCTION project_repository_is_immutable()`,
    `CREATE OR REPLACE FUNCTION ${repositoryConfigurationImportFunction}(
       in_tenant text,in_project text,in_expected_repository text,in_expected_recovery_epoch text,
       in_revision text,in_canonical text,in_digest text,in_commit text,
       in_path text,in_name text,in_kind text,in_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE standing record; existing configuration_revision%ROWTYPE;
             provenance repository_configuration_provenance%ROWTYPE; inserted boolean := false;
     BEGIN
       PERFORM 1 FROM project WHERE tenant=in_tenant AND project=in_project FOR SHARE;
       SELECT * INTO standing FROM ${repositoryBindingReadFunction}(in_tenant,in_project);
       IF NOT FOUND OR standing.repository IS DISTINCT FROM in_expected_repository
          OR standing.recovery_epoch IS DISTINCT FROM in_expected_recovery_epoch
         THEN RETURN 'StaleBinding'; END IF;
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
       IF inserted THEN
         PERFORM publish_project_notification(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
         RETURN 'Imported'; END IF;
       RETURN 'AlreadyImported';
     EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
       RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict';
     END $$`,
    `ALTER FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
  ],
};
