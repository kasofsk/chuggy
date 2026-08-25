import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  notificationPublishFunction,
  repositoryConfigurationImportFunction,
  repositoryBindingReadFunction,
  roleStatement,
  type Migration,
} from "../shared.ts";

export const migration029: Migration = {
  version: 29,
  name: "repository configuration binding fence",
  statements: [
    roleStatement(configurationImporterRole),
    `DROP FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text)`,
    `CREATE FUNCTION ${repositoryConfigurationImportFunction}(
       in_tenant text,in_project text,in_expected_repository text,in_expected_recovery_epoch text,
       in_revision text,in_canonical text,in_digest text,in_commit text,
       in_path text,in_name text,in_kind text,in_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE standing project_repository%ROWTYPE;
             existing configuration_revision%ROWTYPE;
             provenance repository_configuration_provenance%ROWTYPE;
             inserted boolean := false;
     BEGIN
       SELECT * INTO standing FROM project_repository
        WHERE tenant=in_tenant AND project=in_project
          AND repository=in_expected_repository FOR UPDATE;
       IF NOT FOUND OR standing.recovery_epoch IS DISTINCT FROM in_expected_recovery_epoch THEN
         RETURN 'StaleBinding';
       END IF;
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
         THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration provenance conflict'; END IF;
       IF inserted THEN
         PERFORM ${notificationPublishFunction}(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
         RETURN 'Imported';
       END IF;
       RETURN 'AlreadyImported';
     EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
       RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict';
     END $$`,
    `ALTER FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text,text)
       FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text,text)
       TO ${apiRole},${configurationImporterRole}`,
    `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(text,text)
       TO ${configurationImporterRole}`,
    `GRANT SELECT ON schema_migration TO ${configurationImporterRole}`,
  ],
};
