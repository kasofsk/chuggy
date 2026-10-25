/**
 * A binding says whether the jobs its project runs may write the forge's
 * pipeline definitions in its repository, which every binding, standing or
 * made, starts without.
 *
 * THE COLUMN IS A SETTING LIKE THE LANDING. The immutability trigger lets it
 * move beside `landing_mode` and `retired_at`, the boundary owner is granted
 * its update, and the landing door is the one door that moves it, fenced the
 * way the landing is: refused where the row stands at neither the value the
 * writer read nor the one it asked for.
 *
 * THE FOUR BINDING DOORS ARE DROPPED AND RECREATED, because each answers the
 * row and a function's answer cannot be widened in place. Each is owned,
 * withheld from the public and granted to the roles the baseline and 058 gave
 * it again. The finalizer is granted the read beside them: it mints for the
 * pushes and proposals it lands, and a mint reads whether the binding allows
 * them the pipeline definitions.
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
const setOld = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text)`;
const set = `public.${repositoryLandingWriteFunction}(in_tenant text, in_project text, in_repository text, in_expected_mode text, in_mode text, in_expected_pipelines_writable boolean, in_pipelines_writable boolean)`;

/** The statements that own one door and grant it to exactly the roles named. */
function migration076Owned(
  signature: string,
  roles: readonly string[],
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT ALL ON FUNCTION ${signature} TO ${role}`),
  ];
}

export const migration076: Migration = {
  version: 76,
  name: "a binding says whether its jobs may write the forge's pipeline definitions",
  statements: [
    `ALTER TABLE public.project_repository
       ADD COLUMN pipelines_writable boolean DEFAULT false NOT NULL`,
    `GRANT UPDATE(pipelines_writable) ON TABLE public.project_repository TO ${boundaryOwnerRole}`,
    `CREATE OR REPLACE FUNCTION public.project_repository_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$ BEGIN
     IF TG_OP='UPDATE'
        AND to_jsonb(NEW)-'landing_mode'-'pipelines_writable'-'retired_at'
          = to_jsonb(OLD)-'landing_mode'-'pipelines_writable'-'retired_at'
       THEN RETURN NEW; END IF;
     RAISE EXCEPTION 'repository bindings are immutable but for their landing, their pipeline definitions and their retirement'
       USING ERRCODE='integrity_constraint_violation'; END $$`,
    `DROP FUNCTION ${list}`,
    `CREATE FUNCTION ${list} RETURNS TABLE(repository text, bound_at timestamp with time zone, landing_mode text, pipelines_writable boolean, retired_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.pipelines_writable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project
      ORDER BY b.bound_at,b.repository
      LIMIT least(coalesce(in_max,200),
                  200)
     $$`,
    ...migration076Owned(list, [apiRole, schedulerRole]),
    `DROP FUNCTION ${read}`,
    `CREATE FUNCTION ${read} RETURNS TABLE(repository text, bound_at timestamp with time zone, landing_mode text, pipelines_writable boolean, retired_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     SELECT b.repository,b.bound_at,b.landing_mode,b.pipelines_writable,b.retired_at
       FROM project_repository b
      WHERE b.tenant=in_tenant AND b.project=in_project AND b.repository=in_repository
     $$`,
    ...migration076Owned(read, [apiRole, workerPlaneRole, finalizerRole]),
    `DROP FUNCTION ${retire}`,
    `CREATE FUNCTION ${retire} RETURNS TABLE(outcome text, repository text, bound_at timestamp with time zone, landing_mode text, pipelines_writable boolean, retired_at timestamp with time zone)
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
         NULL::text,NULL::boolean,NULL::timestamptz; RETURN;
     END IF;
     IF standing.retired_at IS NULL THEN
       UPDATE project_repository b SET retired_at=now()
        WHERE b.tenant=in_tenant AND b.project=in_project
          AND b.repository=in_repository
        RETURNING b.retired_at INTO standing.retired_at;
     END IF;
     RETURN QUERY SELECT 'Retired',standing.repository,standing.bound_at,
       standing.landing_mode,standing.pipelines_writable,standing.retired_at;
   END $$`,
    ...migration076Owned(retire, [apiRole]),
    `DROP FUNCTION ${setOld}`,
    `CREATE FUNCTION ${set} RETURNS TABLE(outcome text, repository text, bound_at timestamp with time zone, landing_mode text, pipelines_writable boolean, retired_at timestamp with time zone)
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
         NULL::text,NULL::boolean,NULL::timestamptz; RETURN;
     END IF;
     IF (standing.landing_mode<>in_expected_mode AND standing.landing_mode<>in_mode)
        OR (standing.pipelines_writable<>in_expected_pipelines_writable
            AND standing.pipelines_writable<>in_pipelines_writable) THEN
       RETURN QUERY SELECT 'LandingMoved',standing.repository,standing.bound_at,
         standing.landing_mode,standing.pipelines_writable,standing.retired_at; RETURN;
     END IF;
     UPDATE project_repository b
        SET landing_mode=in_mode,pipelines_writable=in_pipelines_writable
      WHERE b.tenant=in_tenant AND b.project=in_project
        AND b.repository=in_repository;
     RETURN QUERY SELECT 'Written',standing.repository,standing.bound_at,in_mode,
       in_pipelines_writable,standing.retired_at;
   END $$`,
    ...migration076Owned(set, [apiRole]),
  ],
};
