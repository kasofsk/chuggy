import {
  apiRole,
  boundaryOwnerRole,
  notificationPublishFunction,
  repositoryConfigurationImportFunction,
  type Migration,
} from "../shared.ts";

const repositoryConfigurationProvenance = [
  `CREATE TABLE repository_configuration_provenance (
     tenant text NOT NULL, project text NOT NULL, revision text NOT NULL,
     digest text NOT NULL, repository text NOT NULL, repository_commit text NOT NULL,
     path text NOT NULL, name text NOT NULL,
     PRIMARY KEY (tenant,project,revision),
     CONSTRAINT repository_configuration_revision_is_retained FOREIGN KEY
       (tenant,project,revision,digest) REFERENCES configuration_revision
       (tenant,project,revision,digest),
     CONSTRAINT repository_configuration_name_is_unique UNIQUE
       (tenant,project,repository,repository_commit,name),
     CONSTRAINT repository_configuration_path_is_unique UNIQUE
       (tenant,project,repository,repository_commit,path),
     CONSTRAINT repository_configuration_repository_is_bounded CHECK
       (length(repository) BETWEEN 1 AND 256),
     CONSTRAINT repository_configuration_revision_is_bounded CHECK
       (length(revision) BETWEEN 1 AND 256),
     CONSTRAINT repository_configuration_commit_is_git_object CHECK
       (repository_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
     CONSTRAINT repository_configuration_path_is_bounded CHECK
       (length(path) BETWEEN 1 AND 256 AND
        path ~ '^\\.chug/configurations/[^/]+\\.json$'),
     CONSTRAINT repository_configuration_name_is_bounded CHECK
       (length(name) BETWEEN 1 AND 128 AND
        name ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$'),
     CONSTRAINT repository_configuration_digest_is_sha256 CHECK
       (digest ~ '^[0-9a-f]{64}$')
   )`,
  `CREATE FUNCTION ${repositoryConfigurationImportFunction}(
      in_tenant text,in_project text,in_revision text,in_canonical text,in_digest text,
      in_repository text,in_commit text,in_path text,in_name text,
      in_kind text,in_subject text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE existing configuration_revision%ROWTYPE;
             provenance repository_configuration_provenance%ROWTYPE;
             inserted boolean := false;
     BEGIN
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
       VALUES (in_tenant,in_project,in_revision,in_digest,in_repository,in_commit,in_path,in_name)
       ON CONFLICT (tenant,project,revision) DO NOTHING;
       SELECT * INTO provenance FROM repository_configuration_provenance
        WHERE tenant=in_tenant AND project=in_project AND revision=in_revision;
       IF provenance.digest<>in_digest OR provenance.repository<>in_repository
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
  `ALTER FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text)
     FROM PUBLIC`,
  `GRANT SELECT,INSERT ON repository_configuration_provenance TO ${boundaryOwnerRole}`,
  `GRANT EXECUTE ON FUNCTION ${repositoryConfigurationImportFunction}(text,text,text,text,text,text,text,text,text,text,text)
     TO ${apiRole}`,
  `GRANT SELECT ON repository_configuration_provenance TO ${apiRole}`,
];

export const migration020: Migration = {
  version: 20,
  name: "repository configuration provenance",
  statements: [...repositoryConfigurationProvenance],
};
