import {
  apiRole,
  boundaryOwnerRole,
  notificationPublishFunction,
  repositoryBindingReadFunction,
  repositoryConfigurationImportFunction,
  type Migration,
} from "../shared.ts";

/**
 * A configuration's version is a number the server assigns per name, one per
 * distinct declaration digest, in the order the imports arrived. The same bytes
 * at a later commit reuse their number; changed bytes take the next one.
 *
 * THE NUMBER IS ASSIGNED IN THE IMPORT, not beside it, so the row that records
 * where a revision came from and the number its declaration carries are written
 * or rolled back together.
 *
 * A TRANSACTION-SCOPED ADVISORY LOCK IS WHAT SERIALISES TWO IMPORTERS. There is
 * no row to take `FOR UPDATE` before a name's first import creates one, so the
 * lock has to be on a key rather than on a row; it is keyed on the project
 * rather than the name because an import is one transaction over many names,
 * and per-name locks taken in two orders would let two importers deadlock.
 */
const repositoryConfigurationVersion = [
  `CREATE TABLE repository_configuration_version (
     tenant text NOT NULL, project text NOT NULL, name text NOT NULL,
     digest text NOT NULL, number bigint NOT NULL,
     PRIMARY KEY (tenant,project,name,digest),
     CONSTRAINT repository_configuration_version_is_unique UNIQUE
       (tenant,project,name,number),
     CONSTRAINT repository_configuration_version_is_positive CHECK (number>=1),
     CONSTRAINT repository_configuration_version_name_is_bounded CHECK
       (length(name) BETWEEN 1 AND 128 AND
        name ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$'),
     CONSTRAINT repository_configuration_version_digest_is_sha256 CHECK
       (digest ~ '^[0-9a-f]{64}$')
   )`,
  `GRANT SELECT,INSERT ON repository_configuration_version TO ${boundaryOwnerRole}`,
  `GRANT SELECT ON repository_configuration_version TO ${apiRole}`,
  `INSERT INTO repository_configuration_version (tenant,project,name,digest,number)
   SELECT tenant,project,name,digest,
          row_number() OVER (PARTITION BY tenant,project,name
                             ORDER BY created_at,revision)
     FROM (SELECT DISTINCT ON (p.tenant,p.project,p.name,p.digest)
                  p.tenant,p.project,p.name,p.digest,c.created_at,c.revision
             FROM repository_configuration_provenance p
             JOIN configuration_revision c USING (tenant,project,revision)
            ORDER BY p.tenant,p.project,p.name,p.digest,c.created_at,c.revision)
          AS first_seen`,
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

export const migration048: Migration = {
  version: 48,
  name: "repository configuration version",
  statements: [...repositoryConfigurationVersion],
};
