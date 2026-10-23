/**
 * An imported catalog keeps the file each workload it named by path was read
 * from.
 *
 * THE PATH IS PROVENANCE, NOT CONTENT. The revision stores the workload
 * inline and its digest covers what runs, so where the repository kept the
 * workload is a row beside the revision's provenance, keyed by it, and a
 * workload moving into a file changes no digest and no version number.
 *
 * `import_repository_configuration` IS DROPPED AND RECREATED for the reason
 * 039 gives, otherwise the baseline's. The paths travel as one JSON object of
 * names to paths, and an import of a revision already stored adds the paths
 * an import before this one did not keep; a path that differs from the one
 * stored is the identity conflict a differing provenance is.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  repositoryConfigurationImportFunction,
  type Migration,
} from "../shared.ts";

const importOldSignature = `public.${repositoryConfigurationImportFunction}(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_kind text, in_subject text)`;
const importSignature = `public.${repositoryConfigurationImportFunction}(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_revision text, in_canonical text, in_digest text, in_commit text, in_path text, in_name text, in_workload_paths text, in_kind text, in_subject text)`;

export const migration073: Migration = {
  version: 73,
  name: "an imported catalog keeps the file each workload it named by path was read from",
  statements: [
    `CREATE TABLE public.repository_configuration_workload_path (
    tenant text NOT NULL,
    project text NOT NULL,
    revision text NOT NULL,
    workload text NOT NULL,
    path text NOT NULL,
    CONSTRAINT repository_configuration_workload_path_pkey PRIMARY KEY (tenant, project, revision, workload),
    CONSTRAINT repository_configuration_workload_path_belongs_to_provenance FOREIGN KEY (tenant, project, revision) REFERENCES public.repository_configuration_provenance(tenant, project, revision),
    CONSTRAINT repository_configuration_workload_path_workload_is_bounded CHECK ((((length(workload) >= 1) AND (length(workload) <= 64)) AND (workload ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$'::text))),
    CONSTRAINT repository_configuration_workload_path_path_is_bounded CHECK ((((length(path) >= 1) AND (length(path) <= 256)) AND (path ~ '^\\.chug/'::text)))
)`,
    `GRANT SELECT,INSERT ON TABLE public.repository_configuration_workload_path TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.repository_configuration_workload_path TO ${apiRole}`,
    `DROP FUNCTION ${importOldSignature}`,
    `CREATE FUNCTION ${importSignature} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE existing configuration_revision%ROWTYPE;
           provenance repository_configuration_provenance%ROWTYPE; inserted boolean := false;
           paths jsonb := coalesce(in_workload_paths,'{}')::jsonb;
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
     IF jsonb_typeof(paths)<>'object'
       THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     INSERT INTO repository_configuration_workload_path (tenant,project,revision,workload,path)
     SELECT in_tenant,in_project,in_revision,w.key,w.value FROM jsonb_each_text(paths) w
     ON CONFLICT (tenant,project,revision,workload) DO NOTHING;
     IF EXISTS (SELECT 1 FROM jsonb_each_text(paths) w
                  JOIN repository_configuration_workload_path s
                    ON s.tenant=in_tenant AND s.project=in_project
                   AND s.revision=in_revision AND s.workload=w.key
                 WHERE s.path<>w.value)
       THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict'; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended(in_tenant||'/'||in_project,0));
     INSERT INTO repository_configuration_version (tenant,project,name,digest,number)
     SELECT in_tenant,in_project,in_name,in_digest,coalesce(max(number),0)+1
       FROM repository_configuration_version
      WHERE tenant=in_tenant AND project=in_project AND name=in_name
     ON CONFLICT (tenant,project,name,digest) DO NOTHING;
     IF inserted THEN
       PERFORM publish_project_notification(in_tenant,in_project,'Configuration',in_revision,NULL,NULL);
       RETURN 'Imported'; END IF;
     RETURN 'AlreadyImported';
   EXCEPTION WHEN unique_violation OR foreign_key_violation OR check_violation THEN
     RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='repository configuration identity conflict';
   END $$`,
    `ALTER FUNCTION ${importSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${importSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${importSignature} TO ${apiRole}`,
    `GRANT ALL ON FUNCTION ${importSignature} TO ${configurationImporterRole}`,
  ],
};
