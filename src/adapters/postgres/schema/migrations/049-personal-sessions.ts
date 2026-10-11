/**
 * A member's personal runner claims their own threads, and a pool claims no
 * thread at all.
 *
 * A THREAD IS ITS MEMBER'S RUNNER'S. On route `Pool` a thread is read as waiting
 * and opened only by the personal runner of its own principal, in a project on
 * that runner's allowlist, and never a lead or an inquiry. A pool claims its
 * project's lead and its registrar's inquiries as before, and no thread. What a
 * runner's owner may read is the authority's, so the pool plane asks it before
 * an opening and nothing here does. Sessions are outside the model, and this
 * rule is held by the Postgres suites.
 *
 * A PERSONAL RUNNER'S ATTEMPT IS NAMED BY ITS OWNER. It spans its owner's
 * projects in one tenant, so `pool` records the owner, `personal` tells it
 * apart from any pool's name, and its room, its lock and its fence are the
 * runner's across those projects. A pool's own count and fence pass over it.
 *
 * WHAT IT HOLDS IS WHAT ITS REGISTRATION CLAIMED, IN A PROJECT IT STILL SERVES.
 * Renewing, settling and pulling for an attempt require the claim's principal
 * to be the runner's current one and the project to be on its allowlist, so a
 * project taken off it stops what the runner holds there. Replacing or
 * removing the runner fences what an older registration held.
 *
 * A MEMBER'S STANDING IS THEIR PERSONAL RUNNER'S. A thread is admitted where
 * the member has one allowlisting the project, an inquiry where a pool they
 * registered serves it, and a lead where any pool does.
 */

import {
  apiRole,
  boundaryOwnerRole,
  personalRunnerFenceFunction,
  personalSessionAssignmentsFunction,
  personalSessionHeldFunction,
  personalSessionHoldingFunction,
  personalSessionImagesFunction,
  personalSessionOpenFunction,
  personalSessionRefuseFunction,
  personalSessionReleaseFunction,
  personalSessionRenewFunction,
  personalSessionsAwaitingFunction,
  poolPlaneRole,
  poolSessionOpenFunction,
  poolSessionsAwaitingFunction,
  selectorServiceRole,
  sessionClaimableSinceFunction,
  sessionRunnerStandingFunction,
  sessionTurnReleaseFunction,
  sessionWaitingRouteFunction,
  workerPoolFenceFunction,
  type Migration,
} from "../shared.ts";

const poolAwaiting = `public.${poolSessionsAwaitingFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const poolOpened = `public.${poolSessionOpenFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const poolFenced = `public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text)`;

const standing = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

const awaiting = `public.${personalSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const opened = `public.${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const assignments = `public.${personalSessionAssignmentsFunction}(in_tenant text, in_owner text, in_principal text, in_assignments text[])`;

const holding = `public.${personalSessionHoldingFunction}(in_tenant text, in_owner text, in_principal text)`;

const renewed = `public.${personalSessionRenewFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_lease_secs bigint)`;

const held = `public.${personalSessionHeldFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`;

const refused = `public.${personalSessionRefuseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_evidence text)`;

const released = `public.${personalSessionReleaseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`;

const images = `public.${personalSessionImagesFunction}(in_tenant text, in_owner text, in_principal text, in_max bigint)`;

const fenced = `public.${personalRunnerFenceFunction}(in_tenant text, in_owner text)`;

/** The definer boilerplate every function here ends with, granted to `role` or to nobody. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`]),
  ];
}

/** Whether a session already has an attempt live, or one that ended inside the backoff. */
function sessionAttemptRecent(
  tenant: string,
  project: string,
  session: string,
): string {
  return `EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=${tenant} AND a.project=${project}
                    AND a.session=${session}
                    AND (a.state IN ('Placing','Running')
                         OR a.ended_at > now() - make_interval(
                              secs => in_backoff_secs::double precision)))`;
}

/** The lock every claim by one personal runner and its fence take, whichever of its projects the claim is in. */
const personalClaimLock = `PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0))`;

export const migration049: Migration = {
  version: 49,
  name: "a member's personal runner claims their own threads",
  statements: [
    `ALTER TABLE public.session_attempt
       ADD COLUMN personal boolean NOT NULL DEFAULT false,
       ADD CONSTRAINT session_attempt_personal_is_runner_held
         CHECK (NOT personal OR pool IS NOT NULL)`,
    `CREATE OR REPLACE FUNCTION ${poolAwaiting}
       RETURNS TABLE(session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.kind,s.capabilities,s.agent_reference
         FROM agent_session s
         JOIN worker_pool w ON w.tenant=s.tenant AND w.project=s.project
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND w.pool=in_pool AND w.principal=in_principal
          AND s.state='Open'
          AND (s.kind='Lead'
               OR (s.kind='Inquiry' AND s.principal=w.registered_by))
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=s.tenant AND p.project=s.project
                        AND p.lifecycle='Active')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT ${sessionAttemptRecent("s.tenant", "s.project", "s.session")}
        ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),s.session
        LIMIT in_max
     $$`,
    `CREATE OR REPLACE FUNCTION ${poolOpened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE registered record; standing record; numbered bigint; current text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'pool session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       SELECT w.registered_by INTO registered FROM worker_pool w
        WHERE w.tenant=in_tenant AND w.project=in_project
          AND w.pool=in_pool AND w.principal=in_principal
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=w.tenant AND p.project=w.project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.project=in_project AND h.pool=in_pool
              AND NOT h.personal
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.principal,s.capabilities,s.agent_reference
         INTO standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND OR standing.state<>'Open'
          OR standing.capabilities IS DISTINCT FROM in_capabilities
          OR standing.agent_reference IS DISTINCT FROM in_agent_reference
          OR NOT coalesce(standing.kind='Lead'
                          OR (standing.kind='Inquiry'
                              AND standing.principal=registered.registered_by),
                          false)
          OR ${sessionAttemptRecent("in_tenant", "in_project", "in_session")}
          OR ${sessionWaitingRouteFunction}(in_tenant,in_project,in_session)
               IS DISTINCT FROM 'Pool' THEN
         RETURN 'NotClaimable';
       END IF;
       SELECT r.epoch INTO current FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation,
          idle_since,pool,pool_principal,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_pool,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_pool,in_principal,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
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
    `CREATE FUNCTION ${awaiting}
       RETURNS TABLE(project text, session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.session,s.kind,s.capabilities,s.agent_reference
         FROM personal_runner r
         JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
         JOIN agent_session s ON s.tenant=l.tenant AND s.project=l.project
        WHERE r.tenant=in_tenant AND r.owner=in_owner AND r.principal=in_principal
          AND s.state='Open' AND s.kind='Thread' AND s.principal=r.owner
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=s.tenant AND p.project=s.project
                        AND p.lifecycle='Active')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT ${sessionAttemptRecent("s.tenant", "s.project", "s.session")}
        ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),
                 s.project,s.session
        LIMIT in_max
     $$`,
    ...owned(awaiting, poolPlaneRole),
    `CREATE FUNCTION ${opened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing record; numbered bigint; current text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'personal session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       ${personalClaimLock};
       PERFORM 1 FROM personal_runner r
         JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
        WHERE r.tenant=in_tenant AND r.owner=in_owner AND r.principal=in_principal
          AND l.project=in_project
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=l.tenant AND p.project=l.project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.personal AND h.pool=in_owner
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.principal,s.capabilities,s.agent_reference
         INTO standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND OR standing.state<>'Open'
          OR standing.kind<>'Thread'
          OR standing.principal IS DISTINCT FROM in_owner
          OR standing.capabilities IS DISTINCT FROM in_capabilities
          OR standing.agent_reference IS DISTINCT FROM in_agent_reference
          OR ${sessionAttemptRecent("in_tenant", "in_project", "in_session")}
          OR ${sessionWaitingRouteFunction}(in_tenant,in_project,in_session)
               IS DISTINCT FROM 'Pool' THEN
         RETURN 'NotClaimable';
       END IF;
       SELECT r.epoch INTO current FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation,
          idle_since,pool,pool_principal,personal,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,true,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
    ...owned(opened, poolPlaneRole),
    `CREATE FUNCTION ${assignments} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment FROM session_attempt a
        WHERE a.tenant=in_tenant AND a.personal AND a.pool=in_owner
          AND a.pool_principal=in_principal AND a.assignment=ANY(in_assignments)
     $$`,
    ...owned(assignments, poolPlaneRole),
    `CREATE FUNCTION ${holding}
       RETURNS TABLE(assignment text, project text, session text, attempt text, generation bigint, image text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment,a.project,a.session,a.attempt,a.generation,a.image
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.tenant=in_tenant AND a.personal AND a.pool=in_owner
          AND a.pool_principal=in_principal
          AND EXISTS(SELECT 1 FROM personal_runner r
                       JOIN personal_runner_project l
                         ON l.tenant=r.tenant AND l.owner=r.owner
                      WHERE r.tenant=a.tenant AND r.owner=in_owner
                        AND r.principal=in_principal AND l.project=a.project)
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now()
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r
                                 ORDER BY r.ordinal DESC LIMIT 1)
          AND s.state='Open'
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=a.tenant AND p.project=a.project
                        AND p.lifecycle='Active')
     $$`,
    ...owned(holding),
    `CREATE FUNCTION ${renewed} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF in_lease_secs <= 0 THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET lease_expires_at=now()+make_interval(secs => in_lease_secs::double precision)
        WHERE a.attempt=(SELECT h.attempt
                           FROM ${personalSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
                          WHERE h.assignment=in_assignment)
          AND a.state IN ('Placing','Running') AND a.lease_expires_at>now();
       RETURN FOUND;
     END $$`,
    ...owned(renewed, poolPlaneRole),
    `CREATE FUNCTION ${held} RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT EXISTS(SELECT 1
                       FROM ${personalSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
                      WHERE h.assignment=in_assignment)
     $$`,
    ...owned(held, poolPlaneRole),
    `CREATE FUNCTION ${refused} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.project,h.session,h.attempt,h.generation INTO bound
         FROM ${personalSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
        WHERE h.assignment=in_assignment;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Lost',evidence='PlacementDenied',pool_refusal=in_evidence,
              ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=bound.attempt AND a.generation=bound.generation
          AND a.state IN ('Placing','Running');
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM ${sessionTurnReleaseFunction}(in_tenant,bound.project,bound.session,bound.attempt);
       RETURN true;
     END $$`,
    ...owned(refused, poolPlaneRole),
    `CREATE FUNCTION ${released} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.project,h.session,h.attempt,h.generation INTO bound
         FROM ${personalSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
        WHERE h.assignment=in_assignment;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Withdrawn',evidence='PlacementUnavailable',ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=bound.attempt AND a.generation=bound.generation
          AND a.state IN ('Placing','Running');
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Queued',attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=in_tenant AND t.project=bound.project
          AND t.session=bound.session AND t.attempt=bound.attempt
          AND t.state='Claimed';
       RETURN true;
     END $$`,
    ...owned(released, poolPlaneRole),
    `CREATE FUNCTION ${images} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT DISTINCT h.image
         FROM ${personalSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
        ORDER BY h.image LIMIT in_max
     $$`,
    ...owned(images, poolPlaneRole),
    `CREATE FUNCTION ${fenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       ${personalClaimLock};
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
    ...owned(fenced, apiRole),
    `DROP FUNCTION ${standing}`,
    `CREATE FUNCTION ${standing}
       RETURNS TABLE(member_standing text, inquiry_standing text, project_standing text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH personal AS (
         SELECT coalesce(r.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM personal_runner r
           JOIN personal_runner_project l
             ON l.tenant=r.tenant AND l.owner=r.owner AND l.project=in_project
          WHERE r.tenant=in_tenant AND r.owner=in_member),
       pools AS (
         SELECT w.registered_by,
                coalesce(w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project)
       SELECT (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM personal),
              (SELECT CASE WHEN bool_or(registered_by=in_member AND live) THEN 'Live'
                           WHEN bool_or(registered_by=in_member) THEN 'Offline'
                           ELSE 'Unregistered' END FROM pools),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM pools)
     $$`,
    ...owned(standing, apiRole),
    `GRANT EXECUTE ON FUNCTION ${standing} TO ${selectorServiceRole}`,
  ],
};
