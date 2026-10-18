/**
 * The configuration import of each binding that finished last, and the one
 * door that writes it.
 *
 * ONE ROW A BINDING, REPLACED BY EACH ATTEMPT. An import at an unchanged head
 * writes no revision, so this row is the only record that it was made. A
 * commit is kept where one was read, and an attempt whose default branch named
 * none, or could not be read, keeps none. Every caller runs the door once its
 * import has come out, so `attempted_at` is the database's clock as it was
 * recorded and the row is the attempt that finished last; of two recordings
 * racing, the one whose transaction began first never replaces the other.
 *
 * THE WORDS ARE THE CONTRACT'S `repositoryConfigurationImportResults` AND
 * `repositoryConfigurationImportAbsences` AS THEY STAND HERE, written out
 * rather than read from it, so this file goes on saying what it installed when
 * a roster grows. A new word is a new migration.
 *
 * THE API AND THE IMPORTER WRITE IT THROUGH THE DOOR ALONE, each recording the
 * imports it makes, and the API reads it for the repository listing.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  repositoryConfigurationImportRecordFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${repositoryConfigurationImportRecordFunction}(in_tenant text, in_project text, in_repository text, in_commit text, in_result text, in_absent text)`;

export const migration067: Migration = {
  version: 67,
  name: "the last configuration import attempted of each binding is kept",
  statements: [
    `CREATE TABLE public.repository_configuration_import (
       tenant text NOT NULL,
       project text NOT NULL,
       repository text NOT NULL,
       attempted_at timestamptz NOT NULL,
       repository_commit text
         CONSTRAINT repository_configuration_import_commit_is_git_object
         CHECK (repository_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
       result text NOT NULL
         CONSTRAINT repository_configuration_import_result_is_known
         CHECK (result = ANY (ARRAY['Imported'::text, 'SnapshotAbsent'::text,
                                    'Unavailable'::text, 'SnapshotRefused'::text,
                                    'DeclarationsRefused'::text,
                                    'IdentityConflict'::text,
                                    'StaleBinding'::text])),
       absent text
         CONSTRAINT repository_configuration_import_absent_is_known
         CHECK (absent = ANY (ARRAY['Commit'::text,
                                    'ConfigurationDirectory'::text])),
       CONSTRAINT repository_configuration_import_absent_is_a_snapshots
         CHECK ((absent IS NOT NULL) = (result = 'SnapshotAbsent')),
       CONSTRAINT repository_configuration_import_commit_was_read
         CHECK (repository_commit IS NOT NULL OR result = 'Unavailable'
                OR (result = 'SnapshotAbsent' AND absent = 'Commit')),
       PRIMARY KEY (tenant,project,repository),
       CONSTRAINT repository_configuration_import_repository_is_bound
         FOREIGN KEY (tenant,project,repository)
         REFERENCES public.project_repository(tenant,project,repository))`,
    `GRANT SELECT,INSERT ON TABLE public.repository_configuration_import TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(attempted_at,repository_commit,result,absent) ON TABLE public.repository_configuration_import TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.repository_configuration_import TO ${apiRole}`,
    `CREATE FUNCTION ${signature} RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       INSERT INTO repository_configuration_import AS kept
         (tenant,project,repository,attempted_at,repository_commit,result,absent)
       VALUES(in_tenant,in_project,in_repository,now(),in_commit,in_result,
              in_absent)
       ON CONFLICT (tenant,project,repository) DO UPDATE
          SET attempted_at=EXCLUDED.attempted_at,
              repository_commit=EXCLUDED.repository_commit,
              result=EXCLUDED.result,
              absent=EXCLUDED.absent
        WHERE kept.attempted_at <= EXCLUDED.attempted_at
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}, ${configurationImporterRole}`,
  ],
};
