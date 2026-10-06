/**
 * What each bound repository's newest imported head declares under its action
 * directory, and the one door that writes it.
 *
 * AN IMPORT IS ONE CALL BECAUSE IT REPLACES A SET. A document a head no longer
 * holds is a row to remove, which only a caller holding the whole set can
 * know, so the door takes the set and no declaration is imported alone.
 *
 * AN IDENTITY IS THE PROJECT'S, COMPARED AS WRITTEN. A second repository of
 * the project declaring one is refused whole and the holder's rows stand. A
 * retired binding is the exception: the importer never reads it again, so its
 * rows would otherwise hold their identities against the repository that
 * replaced it for as long as the project lives, and a live repository
 * declaring one takes it.
 *
 * EVERY IMPORT OF ONE PROJECT TAKES ONE ADVISORY LOCK. Two imports of one
 * repository would otherwise each remove the rows it could see and leave a
 * union no commit declared, and two repositories racing for one identity
 * would be decided by the key and reported as a failure rather than refused.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  repositoryActionImportFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${repositoryActionImportFunction}(in_tenant text, in_project text, in_expected_repository text, in_expected_recovery_epoch text, in_commit text, in_actions text[], in_names text[])`;

export const migration036: Migration = {
  version: 36,
  name: "a repository's declared actions are stored",
  statements: [
    `CREATE TABLE public.repository_action (
       tenant text NOT NULL,
       project text NOT NULL,
       action text NOT NULL
         CONSTRAINT repository_action_identity_is_bounded
         CHECK (length(action) BETWEEN 1 AND 128
                AND action ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$'),
       name text NOT NULL
         CONSTRAINT repository_action_name_is_bounded
         CHECK (length(name) BETWEEN 1 AND 256),
       repository text NOT NULL,
       repository_commit text NOT NULL
         CONSTRAINT repository_action_commit_is_git_object
         CHECK (repository_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
       PRIMARY KEY (tenant,project,action),
       CONSTRAINT repository_action_repository_is_bound
         FOREIGN KEY (tenant,project,repository)
         REFERENCES public.project_repository(tenant,project,repository))`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.repository_action TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.repository_action TO ${apiRole}`,
    `CREATE FUNCTION ${signature} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF in_actions IS NULL OR in_names IS NULL
          OR cardinality(in_actions) > 100
          OR cardinality(in_actions) <> cardinality(in_names) THEN
         RAISE EXCEPTION 'an import names at most % actions, each with its name',
           100 USING ERRCODE = 'invalid_parameter_value';
       END IF;
       PERFORM pg_advisory_xact_lock(
         hashtextextended('repository-action:'||in_tenant||'/'||in_project,0));
       PERFORM 1 FROM project_repository b
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_expected_repository
          AND b.recovery_epoch=in_expected_recovery_epoch;
       IF NOT FOUND THEN RETURN 'StaleBinding'; END IF;
       IF EXISTS(SELECT 1 FROM repository_action a
                   JOIN project_repository b
                     ON b.tenant=a.tenant AND b.project=a.project
                    AND b.repository=a.repository
                  WHERE a.tenant=in_tenant AND a.project=in_project
                    AND a.action=ANY(in_actions)
                    AND a.repository<>in_expected_repository
                    AND b.retired_at IS NULL) THEN
         RETURN 'IdentityConflict';
       END IF;
       DELETE FROM repository_action a
        WHERE a.tenant=in_tenant AND a.project=in_project
          AND (a.repository=in_expected_repository
               OR a.action=ANY(in_actions));
       INSERT INTO repository_action
         (tenant,project,action,name,repository,repository_commit)
       SELECT in_tenant,in_project,declared.action,declared.name,
              in_expected_repository,in_commit
         FROM unnest(in_actions,in_names) AS declared(action,name);
       RETURN 'Imported';
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${configurationImporterRole}`,
  ],
};
