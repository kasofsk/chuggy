/**
 * A binding says whether the jobs its project runs may be issued a credential
 * that starts and reads the forge's pipeline runs in its repository, which
 * every binding, standing or made, starts without.
 *
 * THE COLUMN IS A SETTING LIKE `pipelines_writable`. The immutability trigger,
 * 174's otherwise, lets it move beside the landing, `pipelines_writable` and
 * `retired_at`, the boundary owner is granted its update, and the landing door
 * is the one door that moves it, fenced the same way: refused where the row
 * stands at neither the value the writer read nor the one it asked for. A
 * write naming neither value leaves it as it stands, so a writer that does not
 * know the setting saves the others without touching it.
 *
 * THE BINDING DOORS ARE DROPPED AND RECREATED, because each answers the row
 * and a function's answer cannot be widened in place. Each is 129's with the
 * column added, written out rather than built from 129's, owned, withheld
 * from the public and granted to the roles 129 gave it again.
 */

import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  repositoryBindingListFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  schedulerRole,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const list = `public.${repositoryBindingListFunction}(in_tenant text, in_project text, in_max bigint)`;
const read = `public.${repositoryLandingReadFunction}(in_tenant text, in_project text, in_repository text)`;
const retire = `public.${repositoryRetirementWriteFunction}(in_tenant text, in_project text, in_repository text)`;
const setOld = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_kind text, in_expected_mode text, in_expected_policy text, in_kind text, in_mode text, in_policy text, in_expected_pipelines_writable boolean, in_pipelines_writable boolean)`;
const set = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_kind text, in_expected_mode text, in_expected_policy text, in_kind text, in_mode text, in_policy text, in_expected_pipelines_writable boolean, in_pipelines_writable boolean, in_expected_pipelines_runnable boolean, in_pipelines_runnable boolean)`;

/** The columns every binding door answers, in the order each answers them. */
const bindingColumns =
  "repository text, bound_at timestamp with time zone, landing_kind text, landing_mode text, landing_policy text, pipelines_writable boolean, pipelines_runnable boolean, retired_at timestamp with time zone";

const projectDeleting = `EXISTS(SELECT 1 FROM public.project p
                 WHERE p.tenant=OLD.tenant AND p.project=OLD.project
                   AND p.lifecycle='Deleting')`;

/** The statements that own one door and grant it to exactly the roles named. */
function migration183Owned(
  signature: string,
  roles: readonly string[],
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT ALL ON FUNCTION ${signature} TO ${role}`),
  ];
}

const projectRepositoryStatements: readonly string[] = [
  `ALTER TABLE public.project_repository
     ADD COLUMN pipelines_runnable boolean DEFAULT false NOT NULL`,
  `GRANT UPDATE(pipelines_runnable) ON TABLE public.project_repository TO ${boundaryOwnerRole}`,
  `CREATE OR REPLACE FUNCTION public.project_repository_is_immutable() RETURNS trigger
     LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$ BEGIN
       IF TG_OP='UPDATE'
          AND to_jsonb(NEW)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'pipelines_runnable'-'retired_at'
            = to_jsonb(OLD)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'pipelines_runnable'-'retired_at'
         THEN RETURN NEW; END IF;
       IF TG_OP='DELETE' AND ${projectDeleting} THEN RETURN OLD; END IF;
       RAISE EXCEPTION 'repository bindings are immutable but for their landing, their pipelines and their retirement'
         USING ERRCODE='integrity_constraint_violation'; END $$`,
];

const bindingReadStatements: readonly string[] = [
  `DROP FUNCTION ${list}`,
  `CREATE FUNCTION ${list} RETURNS TABLE(${bindingColumns})
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_kind,b.landing_mode,b.landing_policy,
            b.pipelines_writable,b.pipelines_runnable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository
      LIMIT least(coalesce(in_max,200),
                  200)
     $$`,
  ...migration183Owned(list, [apiRole, schedulerRole]),
  `DROP FUNCTION ${read}`,
  `CREATE FUNCTION ${read} RETURNS TABLE(${bindingColumns})
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_kind,b.landing_mode,b.landing_policy,
            b.pipelines_writable,b.pipelines_runnable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$`,
  ...migration183Owned(read, [apiRole, workerPlaneRole, finalizerRole]),
];

const bindingWriteStatements: readonly string[] = [
  `DROP FUNCTION ${retire}`,
  `CREATE FUNCTION ${retire} RETURNS TABLE(outcome text, ${bindingColumns})
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::text,NULL::text,NULL::boolean,NULL::boolean,
         NULL::timestamptz; RETURN;
     END IF;
     IF standing.retired_at IS NULL THEN
       UPDATE project_repository b SET retired_at=now()
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository
        RETURNING b.retired_at INTO standing.retired_at;
     END IF;
     RETURN QUERY SELECT 'Retired',standing.repository,standing.bound_at,
       standing.landing_kind,standing.landing_mode,standing.landing_policy,
       standing.pipelines_writable,standing.pipelines_runnable,
       standing.retired_at;
   END $$`,
  ...migration183Owned(retire, [apiRole]),
  `DROP FUNCTION ${setOld}`,
  `CREATE FUNCTION ${set} RETURNS TABLE(outcome text, ${bindingColumns})
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
   DECLARE standing project_repository%ROWTYPE;
   BEGIN
     IF (in_expected_pipelines_runnable IS NULL) <> (in_pipelines_runnable IS NULL) THEN
       RAISE EXCEPTION 'repository landing: pipeline runs are written as read and as wanted, or not at all'
         USING ERRCODE = 'invalid_parameter_value';
     END IF;
     SELECT * INTO standing FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository FOR UPDATE;
     IF NOT FOUND THEN
       RETURN QUERY SELECT 'NotBound',NULL::text,NULL::timestamptz,
         NULL::text,NULL::text,NULL::text,NULL::boolean,NULL::boolean,
         NULL::timestamptz; RETURN;
     END IF;
     IF ((standing.landing_kind,standing.landing_mode,standing.landing_policy)
           IS DISTINCT FROM (in_expected_kind,in_expected_mode,in_expected_policy)
         AND (standing.landing_kind,standing.landing_mode,standing.landing_policy)
           IS DISTINCT FROM (in_kind,in_mode,in_policy))
        OR (standing.pipelines_writable<>in_expected_pipelines_writable
            AND standing.pipelines_writable<>in_pipelines_writable)
        OR (in_pipelines_runnable IS NOT NULL
            AND standing.pipelines_runnable<>in_expected_pipelines_runnable
            AND standing.pipelines_runnable<>in_pipelines_runnable) THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_kind,standing.landing_mode,standing.landing_policy,
         standing.pipelines_writable,standing.pipelines_runnable,
         standing.retired_at; RETURN;
     END IF;
     UPDATE project_repository b
        SET landing_kind=in_kind,landing_mode=in_mode,landing_policy=in_policy,
            pipelines_writable=in_pipelines_writable,
            pipelines_runnable=coalesce(in_pipelines_runnable,standing.pipelines_runnable)
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,
       in_kind,in_mode,in_policy,in_pipelines_writable,
       coalesce(in_pipelines_runnable,standing.pipelines_runnable),
       standing.retired_at;
   END $$`,
  ...migration183Owned(set, [apiRole]),
];

export const migration183: Migration = {
  version: 183,
  name: "a binding says whether its jobs may start and read the forge's pipeline runs",
  statements: [
    ...projectRepositoryStatements,
    ...bindingReadStatements,
    ...bindingWriteStatements,
  ],
};
