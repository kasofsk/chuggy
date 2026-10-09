/**
 * A member's personal runner claims the executions of tickets they created, in
 * projects that allow it.
 *
 * AN EXECUTION CARRIES ITS OWNER AND ITS PROJECT'S FALLBACK, BOTH PINNED. The
 * scheduler writes `owner` from the member authority the ticket's first draft
 * revision was written under, and `owner_fallback` from the project's setting,
 * when it registers the execution and never after, as it writes `placement`:
 * they are the model's `ExecutionProfile.ownerOf`, `personalRunnerAllowed` and
 * `ownerFallback`, which no placement changes. `owner_fallback` NULL is
 * `personalRunnerAllowed` false, and an execution registered before this
 * migration keeps NULL in both, so it never runs on a personal runner.
 *
 * THE SETTING IS THE PROJECT'S OWN ROW, ABSENT UNTIL AN ADMINISTRATOR WRITES
 * IT. A project with no row, or a row naming no fallback, registers executions
 * as before, so its placement does not change.
 *
 * A PERSONAL RUNNER'S EXECUTION ATTEMPT IS NAMED BY ITS OWNER, as its session
 * attempt is in `047`: `pool` records the owner and `personal` tells it apart,
 * so its room, its lock and its fence are the runner's across the projects it
 * serves, and a pool's own count and fence pass over it. Its release is a
 * function of its own for the reason `023` gives a pool's.
 *
 * ONE INVENTORY MATCH. A pool's claim, a personal runner's, and the fallback a
 * pool's claim reads all ask whether declared capabilities run a requirement,
 * so the match is one function rather than three copies of a CASE.
 *
 * A RUNNER IS LIVE FOR EXECUTIONS BY A POLL THAT COULD TAKE ONE. Its
 * `executions_polled_at` is stamped by a poll with room for an execution or
 * holding one, beside the `last_polled_at` a poll that could take a session
 * stamps, so neither kind of work reads the runner live by the other's poll.
 *
 * THE POOL PLANE READS WHAT ITS CLAIMS DECIDE BY: an execution's owner and
 * fallback, a personal runner's execution poll, and whether an attempt is
 * personal.
 * The scheduler reads the ticket's first authority and the setting, and a
 * member's runner, which is what it asks an execution's outcome of.
 */

import {
  apiRole,
  boundaryOwnerRole,
  personalExecutionReleaseFunction,
  personalRunnerFenceFunction,
  poolPlaneRole,
  projectOwnerFallbackSetFunction,
  schedulerRole,
  sessionTurnReleaseFunction,
  workerPoolFenceFunction,
  workerPoolInventoryFunction,
  type Migration,
} from "../shared.ts";

const inventory = `public.${workerPoolInventoryFunction}(in_requirement jsonb, in_capabilities text[])`;

const fallbackSet = `public.${projectOwnerFallbackSetFunction}(in_tenant text, in_project text, in_fallback text, in_authority_kind text, in_authority_subject text)`;

const released = `public.${personalExecutionReleaseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`;

const poolFenced = `public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text)`;

const personalFenced = `public.${personalRunnerFenceFunction}(in_tenant text, in_owner text)`;

/** The owner and the one grant every function here ends with, `role` the only caller. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
  ];
}

/** The lock every claim by one personal runner and its fence take, as `047` takes it. */
const personalClaimLock = `PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0))`;

export const migration048: Migration = {
  version: 48,
  name: "a member's personal runner claims their own executions",
  statements: [
    `ALTER TABLE public.execution
       ADD COLUMN owner text
         CONSTRAINT execution_owner_is_bounded
         CHECK (owner IS NULL OR length(owner) BETWEEN 1 AND 256),
       ADD COLUMN owner_fallback text
         CONSTRAINT execution_owner_fallback_is_known
         CHECK (owner_fallback IS NULL OR owner_fallback IN ('Strict','Preferred'))`,
    `ALTER TABLE public.execution_attempt
       ADD COLUMN personal boolean NOT NULL DEFAULT false,
       ADD CONSTRAINT execution_attempt_personal_is_runner_held
         CHECK (NOT personal OR pool IS NOT NULL)`,
    `CREATE TABLE public.project_owner_fallback (
       tenant text NOT NULL,
       project text NOT NULL,
       fallback text
         CONSTRAINT project_owner_fallback_is_known
         CHECK (fallback IS NULL OR fallback IN ('Strict','Preferred')),
       set_by_kind text NOT NULL
         CONSTRAINT project_owner_fallback_setter_kind_is_bounded
         CHECK (length(set_by_kind) BETWEEN 1 AND 256),
       set_by_subject text NOT NULL
         CONSTRAINT project_owner_fallback_setter_subject_is_bounded
         CHECK (length(set_by_subject) BETWEEN 1 AND 256),
       set_at timestamp with time zone NOT NULL,
       PRIMARY KEY (tenant,project),
       CONSTRAINT project_owner_fallback_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.project_owner_fallback TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.project_owner_fallback TO ${schedulerRole}`,
    `GRANT SELECT ON TABLE public.project_owner_fallback TO ${apiRole}`,
    `CREATE FUNCTION ${fallbackSet} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing text;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT f.fallback INTO standing FROM project_owner_fallback f
        WHERE f.tenant=in_tenant AND f.project=in_project FOR UPDATE;
       IF standing IS NOT DISTINCT FROM in_fallback THEN
         RETURN 'Unchanged';
       END IF;
       INSERT INTO project_owner_fallback
         (tenant,project,fallback,set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_fallback,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project) DO UPDATE
           SET fallback=EXCLUDED.fallback,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`,
    ...owned(fallbackSet, apiRole),
    `GRANT SELECT(tenant,project,ticket,authoring_version,authority_kind,authority_subject)
       ON TABLE public.draft_revision TO ${schedulerRole}`,
    `GRANT INSERT(owner,owner_fallback) ON TABLE public.execution TO ${schedulerRole}`,
    `GRANT SELECT(owner,owner_fallback) ON TABLE public.execution TO ${poolPlaneRole}`,
    `GRANT SELECT(personal),UPDATE(personal) ON TABLE public.execution_attempt TO ${poolPlaneRole}`,
    `ALTER TABLE public.personal_runner ADD COLUMN executions_polled_at timestamp with time zone`,
    `GRANT SELECT(executions_polled_at),UPDATE(executions_polled_at)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT UPDATE(executions_polled_at) ON TABLE public.personal_runner TO ${apiRole}`,
    `GRANT SELECT(tenant,owner,capabilities,principal) ON TABLE public.personal_runner TO ${schedulerRole}`,
    `GRANT SELECT(tenant,owner,project) ON TABLE public.personal_runner_project TO ${schedulerRole}`,
    `CREATE FUNCTION ${inventory} RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
       SELECT CASE in_requirement->>'mode'
         WHEN 'Container' THEN
           'Platform:' || (in_requirement->>'operatingSystem') || ':' || (in_requirement->>'architecture')
             = ANY(in_capabilities)
         WHEN 'ContainerCapability' THEN
           'Platform:' || (in_requirement->>'operatingSystem') || ':' || (in_requirement->>'architecture')
             = ANY(in_capabilities)
           AND ARRAY(SELECT jsonb_array_elements_text(in_requirement->'capabilities')) <@ in_capabilities
         ELSE false END
     $$`,
    ...owned(inventory, poolPlaneRole),
    `CREATE FUNCTION ${released} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.project,a.execution INTO bound FROM execution_attempt a
        WHERE a.tenant=in_tenant AND a.assignment=in_assignment;
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM 1 FROM execution e
        WHERE e.tenant=in_tenant AND e.project=bound.project
          AND e.execution=bound.execution
          FOR UPDATE;
       UPDATE execution_attempt a
          SET state='Withdrawn',evidence='PlacementUnavailable',ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,capability_secret_digest=NULL
        WHERE a.tenant=in_tenant AND a.project=bound.project
          AND a.assignment=in_assignment AND a.personal AND a.pool=in_owner
          AND a.pool_principal=in_principal AND a.state='Placing'
          AND EXISTS(SELECT 1 FROM personal_runner r
                       JOIN personal_runner_project l
                         ON l.tenant=r.tenant AND l.owner=r.owner
                      WHERE r.tenant=a.tenant AND r.owner=in_owner
                        AND r.principal=in_principal AND l.project=a.project)
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1);
       RETURN FOUND;
     END $$`,
    ...owned(released, poolPlaneRole),
    `CREATE OR REPLACE FUNCTION ${poolFenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
            JOIN worker_pool w
              ON w.tenant=q.tenant AND w.project=q.project AND w.pool=q.pool
           WHERE w.tenant=in_tenant AND w.project=in_project AND w.pool=in_pool
             AND NOT q.personal
             AND q.pool_principal<>w.principal
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
       FOR stale IN SELECT q.session,q.attempt FROM session_attempt q
            JOIN worker_pool w
              ON w.tenant=q.tenant AND w.project=q.project AND w.pool=q.pool
           WHERE w.tenant=in_tenant AND w.project=in_project AND w.pool=in_pool
             AND NOT q.personal
             AND q.pool_principal<>w.principal
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.session,q.attempt
             FOR UPDATE OF q LOOP
         UPDATE session_attempt a
            SET state='Superseded',generation=a.generation+1,evidence='Fenced',
                ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=stale.attempt;
         PERFORM ${sessionTurnReleaseFunction}(in_tenant,in_project,stale.session,stale.attempt);
       END LOOP;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${personalFenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       ${personalClaimLock};
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND q.pool_principal IS DISTINCT FROM (
               SELECT r.principal FROM personal_runner r
                WHERE r.tenant=in_tenant AND r.owner=in_owner)
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
       FOR stale IN SELECT q.project,q.session,q.attempt FROM session_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND q.pool_principal IS DISTINCT FROM (
               SELECT r.principal FROM personal_runner r
                WHERE r.tenant=in_tenant AND r.owner=in_owner)
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.session,q.attempt
             FOR UPDATE OF q LOOP
         UPDATE session_attempt a
            SET state='Superseded',generation=a.generation+1,evidence='Fenced',
                ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=stale.attempt;
         PERFORM ${sessionTurnReleaseFunction}(in_tenant,stale.project,stale.session,stale.attempt);
       END LOOP;
     END $$`,
  ],
};
