/**
 * A member's chat host polls the pool plane and claims their threads and
 * inquiries in every project they may read.
 *
 * A CHAT HOST IS A TENANT'S ROW, ONE PER MEMBER. It is keyed by its tenant and
 * its owner, names no project and keeps no allowlist: what it serves is every
 * project its owner may read, which the pool plane asks the authority at each
 * claim, as it asks for a personal runner's. Its principal is a client of the
 * same issuer as a runner's and of no relation, so `personal_runner` and
 * `worker_pool` never resolve it. Registering again replaces the row, and
 * the replacing registration fences what the replaced one held.
 *
 * A TOKEN NAMES WHAT IT REGISTERS. `personal_runner_registration_token.kind`
 * is `Runner` or `ChatHost`, written when it is minted; every token minted
 * before this is a runner's.
 *
 * A SESSION ATTEMPT NAMES ITS HOLDER'S KIND. `holder_kind` is `Pool`,
 * `Personal` or `ChatHost` where a runner holds the attempt and NULL where the
 * cluster does, so it is NULL exactly where `pool` is, and it replaces
 * `personal`, which this drops from `session_attempt` alone. Every attempt is
 * backfilled from what `personal` and `pool` said, finished ones included, so
 * the trigger that writes a finished attempt once is held off for that one
 * statement. An execution attempt keeps its `personal`.
 *
 * A CHAT HOST'S ATTEMPT IS NAMED BY ITS OWNER, as a personal runner's is:
 * `pool` records the owner and `pool_principal` the host's principal. Its
 * kind is what tells it apart, so the personal runner's fence and room, which
 * read `Personal` alone, pass over it, as a pool's read `Pool` alone; and its
 * own lock, room and fence read `ChatHost` alone, so a claim by the host waits
 * on no claim by its owner's runners.
 *
 * A HOST MAY DECLARE ITS IDLE BOUND, recorded as `idle_secs` at claim after
 * the pool plane capped it at the bound the scheduler publishes in
 * `session_launch.idle_secs_max`; the idle reaper ends an attempt by its own
 * bound where it has one and by the scheduler's otherwise.
 *
 * AN INQUIRY IS ITS MEMBER'S CHAT HOST'S. A pool claims its project's lead
 * alone; a chat host claims its owner's threads and inquiries; a personal runner
 * claims its owner's threads only while its owner's chat host is not live, by
 * the window that bounds a runner's standing, so a live host comes first and a
 * stopped one strands nothing. An inquiry a pool already holds is left to run
 * to its end. A member's standing for a thread is their chat host's and their
 * runners' together, and for an inquiry their chat host's.
 *
 * The bodies are written out rather than built from the helpers `041`, `049`,
 * `050` and `070` use, so this file goes on saying what it installed when those
 * change.
 */

import {
  apiRole,
  boundaryOwnerRole,
  chatHostFenceFunction,
  chatHostSessionAssignmentsFunction,
  chatHostSessionHeldFunction,
  chatHostSessionHoldingFunction,
  chatHostSessionImagesFunction,
  chatHostSessionOpenFunction,
  chatHostSessionRefuseFunction,
  chatHostSessionReleaseFunction,
  chatHostSessionRenewFunction,
  chatHostSessionsAwaitingFunction,
  personalRunnerFenceFunction,
  personalSessionAssignmentsFunction,
  personalSessionHoldingFunction,
  personalSessionOpenFunction,
  personalSessionsAwaitingFunction,
  poolPlaneRole,
  poolSessionOpenFunction,
  poolSessionsAwaitingFunction,
  sessionAttemptReapIdleFunction,
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

const personalAwaitingBefore = `public.${personalSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const personalAwaiting = `public.${personalSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_polled_secs_max bigint)`;

const personalOpenedBefore = `public.${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const personalOpened = `public.${personalSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_polled_secs_max bigint)`;

const personalAssignments = `public.${personalSessionAssignmentsFunction}(in_tenant text, in_owner text, in_principal text, in_assignments text[])`;

const personalHolding = `public.${personalSessionHoldingFunction}(in_tenant text, in_owner text, in_principal text)`;

const personalFenced = `public.${personalRunnerFenceFunction}(in_tenant text, in_owner text)`;

const standing = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

const idle = `public.${sessionAttemptReapIdleFunction}(in_epoch text, in_idle_secs bigint, in_max bigint)`;

const hostAwaiting = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

const hostAssignments = `public.${chatHostSessionAssignmentsFunction}(in_tenant text, in_owner text, in_principal text, in_assignments text[])`;

const hostHolding = `public.${chatHostSessionHoldingFunction}(in_tenant text, in_owner text, in_principal text)`;

const hostRenewed = `public.${chatHostSessionRenewFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_lease_secs bigint)`;

const hostHeld = `public.${chatHostSessionHeldFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`;

const hostRefused = `public.${chatHostSessionRefuseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text, in_evidence text)`;

const hostReleased = `public.${chatHostSessionReleaseFunction}(in_tenant text, in_owner text, in_principal text, in_assignment text)`;

const hostImages = `public.${chatHostSessionImagesFunction}(in_tenant text, in_owner text, in_principal text, in_max bigint)`;

const hostFenced = `public.${chatHostFenceFunction}(in_tenant text, in_owner text)`;

/** The definer boilerplate every function this adds ends with, granted to `role` or to nobody. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`]),
  ];
}

export const migration090: Migration = {
  version: 90,
  name: "a member's chat host claims their threads and inquiries",
  statements: [
    `CREATE TABLE public.chat_host (
       tenant text NOT NULL
         CONSTRAINT chat_host_names_a_tenant
         REFERENCES public.tenant(tenant),
       owner text NOT NULL
         CONSTRAINT chat_host_owner_is_bounded
         CHECK (length(owner) BETWEEN 1 AND 256),
       principal text NOT NULL UNIQUE
         CONSTRAINT chat_host_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       client_id text NOT NULL UNIQUE
         CONSTRAINT chat_host_client_id_is_bounded
         CHECK (length(client_id) BETWEEN 1 AND 256),
       registered_at timestamptz NOT NULL DEFAULT now(),
       last_polled_at timestamptz,
       runner_package text
         CONSTRAINT chat_host_runner_package_is_a_package
         CHECK (runner_package ~ '^[a-z][a-z0-9-]{0,62}$'),
       runner_version text
         CONSTRAINT chat_host_runner_version_is_a_release
         CHECK (runner_version
           ~ '^(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})$'),
       CONSTRAINT chat_host_runner_is_named_whole
         CHECK ((runner_package IS NULL) = (runner_version IS NULL)),
       PRIMARY KEY (tenant, owner))`,
    `GRANT SELECT,INSERT,DELETE ON TABLE public.chat_host TO ${apiRole}`,
    `GRANT SELECT(tenant,owner,principal,runner_package,runner_version)
       ON TABLE public.chat_host TO ${poolPlaneRole}`,
    `GRANT UPDATE(last_polled_at,runner_package,runner_version)
       ON TABLE public.chat_host TO ${poolPlaneRole}`,
    `GRANT SELECT(tenant,owner,principal,last_polled_at)
       ON TABLE public.chat_host TO ${boundaryOwnerRole}`,
    `ALTER TABLE public.personal_runner_registration_token
       ADD COLUMN kind text NOT NULL DEFAULT 'Runner'
         CONSTRAINT personal_runner_registration_token_kind_is_known
         CHECK (kind IN ('Runner','ChatHost'))`,
    `ALTER TABLE public.personal_runner_registration_token
       ALTER COLUMN kind DROP DEFAULT`,
    `ALTER TABLE public.session_launch
       ADD COLUMN idle_secs_max bigint
         CONSTRAINT session_launch_idle_is_positive CHECK (idle_secs_max>0)`,
    `ALTER TABLE public.session_attempt
       ADD COLUMN holder_kind text
         CONSTRAINT session_attempt_holder_kind_is_known
         CHECK (holder_kind IN ('Pool','Personal','ChatHost')),
       ADD COLUMN idle_secs bigint
         CONSTRAINT session_attempt_idle_is_positive CHECK (idle_secs>0)`,
    `ALTER TABLE public.session_attempt DISABLE TRIGGER session_attempt_is_fenced`,
    `UPDATE public.session_attempt
        SET holder_kind=CASE WHEN personal THEN 'Personal'
                             WHEN pool IS NOT NULL THEN 'Pool' END`,
    `ALTER TABLE public.session_attempt ENABLE TRIGGER session_attempt_is_fenced`,
    `ALTER TABLE public.session_attempt
       DROP CONSTRAINT session_attempt_personal_is_runner_held,
       ADD CONSTRAINT session_attempt_holder_is_runner_held
         CHECK ((holder_kind IS NULL) = (pool IS NULL)),
       DROP COLUMN personal`,
    `CREATE OR REPLACE FUNCTION ${idle} RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE idled record; reaped bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       reaped:=0;
       FOR idled IN SELECT a.tenant,a.project,a.session,a.attempt FROM session_attempt a
            WHERE a.state IN ('Placing','Running') AND a.recovery_epoch=in_epoch
              AND a.idle_since IS NOT NULL
              AND a.idle_since < now() - make_interval(
                    secs => coalesce(a.idle_secs,in_idle_secs)::double precision)
            ORDER BY a.tenant,a.project,a.session,a.attempt
            LIMIT in_max FOR UPDATE LOOP
         UPDATE session_attempt a
            SET state='Lost',evidence=CASE WHEN EXISTS(SELECT 1 FROM agent_session s
                  WHERE s.tenant=idled.tenant AND s.project=idled.project
                    AND s.session=idled.session AND s.state='Closed')
                 THEN 'SessionClosed' ELSE 'SessionIdle' END,
                ended_at=now(),
                lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
          WHERE a.attempt=idled.attempt;
         PERFORM release_session_attempt_turns(
           idled.tenant,idled.project,idled.session,idled.attempt);
         reaped:=reaped+1;
       END LOOP;
       RETURN reaped;
     END $$`,
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
          AND s.state='Open' AND s.kind='Lead'
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=s.tenant AND p.project=s.project
                        AND p.lifecycle='Active')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=s.tenant AND a.project=s.project
                    AND a.session=s.session
                    AND (a.state IN ('Placing','Running')
                         OR a.ended_at > now() - make_interval(
                              secs => in_backoff_secs::double precision)))
        ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),s.session
        LIMIT in_max
     $$`,
    `CREATE OR REPLACE FUNCTION ${poolOpened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing record; numbered bigint; current text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'pool session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       PERFORM 1 FROM worker_pool w
        WHERE w.tenant=in_tenant AND w.project=in_project
          AND w.pool=in_pool AND w.principal=in_principal
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=w.tenant AND p.project=w.project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.project=in_project AND h.pool=in_pool
              AND h.holder_kind='Pool'
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.capabilities,s.agent_reference
         INTO standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND OR standing.state<>'Open'
          OR standing.kind<>'Lead'
          OR standing.capabilities IS DISTINCT FROM in_capabilities
          OR standing.agent_reference IS DISTINCT FROM in_agent_reference
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND a.project=in_project
                       AND a.session=in_session
                       AND (a.state IN ('Placing','Running')
                            OR a.ended_at > now() - make_interval(
                                 secs => in_backoff_secs::double precision)))
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
          idle_since,pool,pool_principal,holder_kind,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_pool,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_pool,in_principal,'Pool',in_assignment,in_image,in_launch);
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
             AND NOT q.personal
             AND q.pool_principal<>w.principal
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
       FOR stale IN SELECT q.session,q.attempt FROM session_attempt q
            JOIN worker_pool w
              ON w.tenant=q.tenant AND w.project=q.project AND w.pool=q.pool
           WHERE w.tenant=in_tenant AND w.project=in_project AND w.pool=in_pool
             AND q.holder_kind='Pool'
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
    `DROP FUNCTION ${personalAwaitingBefore}`,
    `CREATE FUNCTION ${personalAwaiting}
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
          AND NOT EXISTS(SELECT 1 FROM chat_host h
                          WHERE h.tenant=r.tenant AND h.owner=r.owner
                            AND h.last_polled_at > now() - make_interval(
                                  secs => in_polled_secs_max::double precision))
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=s.tenant AND p.project=s.project
                        AND p.lifecycle='Active')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=s.tenant AND a.project=s.project
                    AND a.session=s.session
                    AND (a.state IN ('Placing','Running')
                         OR a.ended_at > now() - make_interval(
                              secs => in_backoff_secs::double precision)))
        ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),
                 s.project,s.session
        LIMIT in_max
     $$`,
    ...owned(personalAwaiting, poolPlaneRole),
    `DROP FUNCTION ${personalOpenedBefore}`,
    `CREATE FUNCTION ${personalOpened} RETURNS text
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
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0));
       PERFORM 1 FROM personal_runner r
         JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
        WHERE r.tenant=in_tenant AND r.owner=in_owner AND r.principal=in_principal
          AND l.project=in_project
          AND NOT EXISTS(SELECT 1 FROM chat_host h
                          WHERE h.tenant=r.tenant AND h.owner=r.owner
                            AND h.last_polled_at > now() - make_interval(
                                  secs => in_polled_secs_max::double precision))
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=l.tenant AND p.project=l.project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.holder_kind='Personal' AND h.pool=in_owner
              AND h.pool_principal=in_principal
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
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND a.project=in_project
                       AND a.session=in_session
                       AND (a.state IN ('Placing','Running')
                            OR a.ended_at > now() - make_interval(
                                 secs => in_backoff_secs::double precision)))
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
          idle_since,pool,pool_principal,holder_kind,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,'Personal',in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
    ...owned(personalOpened, poolPlaneRole),
    `CREATE OR REPLACE FUNCTION ${personalAssignments} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment FROM session_attempt a
        WHERE a.tenant=in_tenant AND a.holder_kind='Personal' AND a.pool=in_owner
          AND a.pool_principal=in_principal AND a.assignment=ANY(in_assignments)
     $$`,
    `CREATE OR REPLACE FUNCTION ${personalHolding}
       RETURNS TABLE(assignment text, project text, session text, attempt text, generation bigint, image text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment,a.project,a.session,a.attempt,a.generation,a.image
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.tenant=in_tenant AND a.holder_kind='Personal' AND a.pool=in_owner
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
    `CREATE OR REPLACE FUNCTION ${personalFenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'personal-runner-claim:' || in_tenant || '/' || in_owner, 0));
       UPDATE execution_attempt a SET capability_secret_digest=NULL
        WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
          SELECT q.tenant,q.project,q.execution,q.attempt
            FROM execution_attempt q
           WHERE q.tenant=in_tenant AND q.personal AND q.pool=in_owner
             AND NOT EXISTS(SELECT 1 FROM personal_runner r
                             WHERE r.tenant=in_tenant AND r.owner=in_owner
                               AND r.principal=q.pool_principal)
             AND q.state IN ('Placing','Running')
           ORDER BY q.tenant,q.project,q.execution,q.attempt
             FOR UPDATE OF q);
       FOR stale IN SELECT q.project,q.session,q.attempt FROM session_attempt q
           WHERE q.tenant=in_tenant AND q.holder_kind='Personal' AND q.pool=in_owner
             AND NOT EXISTS(SELECT 1 FROM personal_runner r
                             WHERE r.tenant=in_tenant AND r.owner=in_owner
                               AND r.principal=q.pool_principal)
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
    `CREATE FUNCTION ${hostAwaiting}
       RETURNS TABLE(project text, session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.session,s.kind,s.capabilities,s.agent_reference
         FROM chat_host h
         JOIN project p ON p.tenant=h.tenant AND p.lifecycle='Active'
         JOIN agent_session s ON s.tenant=p.tenant AND s.project=p.project
                             AND s.principal=h.owner
        WHERE h.tenant=in_tenant AND h.owner=in_owner AND h.principal=in_principal
          AND s.state='Open' AND s.kind IN ('Thread','Inquiry')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=s.tenant AND a.project=s.project
                    AND a.session=s.session
                    AND (a.state IN ('Placing','Running')
                         OR a.ended_at > now() - make_interval(
                              secs => in_backoff_secs::double precision)))
        ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),
                 s.project,s.session
        LIMIT in_max
     $$`,
    ...owned(hostAwaiting, poolPlaneRole),
    `CREATE FUNCTION ${hostOpened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing record; numbered bigint; current text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'chat host session attempt % is opened without the invocation and launch its host fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'chat-host-claim:' || in_tenant || '/' || in_owner, 0));
       PERFORM 1 FROM chat_host h
        WHERE h.tenant=in_tenant AND h.owner=in_owner AND h.principal=in_principal
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=h.tenant AND p.project=in_project
                        AND p.lifecycle='Active');
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.holder_kind='ChatHost' AND h.pool=in_owner
              AND h.pool_principal=in_principal
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.principal,s.capabilities,s.agent_reference
         INTO standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND OR standing.state<>'Open'
          OR standing.kind NOT IN ('Thread','Inquiry')
          OR standing.principal IS DISTINCT FROM in_owner
          OR standing.capabilities IS DISTINCT FROM in_capabilities
          OR standing.agent_reference IS DISTINCT FROM in_agent_reference
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND a.project=in_project
                       AND a.session=in_session
                       AND (a.state IN ('Placing','Running')
                            OR a.ended_at > now() - make_interval(
                                 secs => in_backoff_secs::double precision)))
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
          idle_since,pool,pool_principal,holder_kind,idle_secs,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,'ChatHost',in_idle_secs,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
    ...owned(hostOpened, poolPlaneRole),
    `CREATE FUNCTION ${hostAssignments} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment FROM session_attempt a
        WHERE a.tenant=in_tenant AND a.holder_kind='ChatHost' AND a.pool=in_owner
          AND a.pool_principal=in_principal AND a.assignment=ANY(in_assignments)
     $$`,
    ...owned(hostAssignments, poolPlaneRole),
    `CREATE FUNCTION ${hostHolding}
       RETURNS TABLE(assignment text, project text, session text, attempt text, generation bigint, image text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment,a.project,a.session,a.attempt,a.generation,a.image
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.tenant=in_tenant AND a.holder_kind='ChatHost' AND a.pool=in_owner
          AND a.pool_principal=in_principal
          AND EXISTS(SELECT 1 FROM chat_host h
                      WHERE h.tenant=a.tenant AND h.owner=in_owner
                        AND h.principal=in_principal)
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now()
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r
                                 ORDER BY r.ordinal DESC LIMIT 1)
          AND s.state='Open'
          AND EXISTS(SELECT 1 FROM project p
                      WHERE p.tenant=a.tenant AND p.project=a.project
                        AND p.lifecycle='Active')
     $$`,
    ...owned(hostHolding),
    `CREATE FUNCTION ${hostRenewed} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF in_lease_secs <= 0 THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET lease_expires_at=now()+make_interval(secs => in_lease_secs::double precision)
        WHERE a.attempt=(SELECT h.attempt
                           FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
                          WHERE h.assignment=in_assignment)
          AND a.state IN ('Placing','Running') AND a.lease_expires_at>now();
       RETURN FOUND;
     END $$`,
    ...owned(hostRenewed, poolPlaneRole),
    `CREATE FUNCTION ${hostHeld} RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT EXISTS(SELECT 1
                       FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
                      WHERE h.assignment=in_assignment)
     $$`,
    ...owned(hostHeld, poolPlaneRole),
    `CREATE FUNCTION ${hostRefused} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.project,h.session,h.attempt,h.generation INTO bound
         FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
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
    ...owned(hostRefused, poolPlaneRole),
    `CREATE FUNCTION ${hostReleased} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.project,h.session,h.attempt,h.generation INTO bound
         FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
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
    ...owned(hostReleased, poolPlaneRole),
    `CREATE FUNCTION ${hostImages} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT DISTINCT h.image
         FROM ${chatHostSessionHoldingFunction}(in_tenant,in_owner,in_principal) h
        ORDER BY h.image LIMIT in_max
     $$`,
    ...owned(hostImages, poolPlaneRole),
    `CREATE FUNCTION ${hostFenced} RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE stale record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'chat-host-claim:' || in_tenant || '/' || in_owner, 0));
       FOR stale IN SELECT q.project,q.session,q.attempt FROM session_attempt q
           WHERE q.tenant=in_tenant AND q.holder_kind='ChatHost' AND q.pool=in_owner
             AND q.pool_principal IS DISTINCT FROM (
               SELECT h.principal FROM chat_host h
                WHERE h.tenant=in_tenant AND h.owner=in_owner)
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
    ...owned(hostFenced, apiRole),
    `CREATE OR REPLACE FUNCTION ${standing}
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
       host AS (
         SELECT coalesce(h.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM chat_host h
          WHERE h.tenant=in_tenant AND h.owner=in_member),
       pools AS (
         SELECT coalesce(w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision), false) AS live
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project),
       member AS (SELECT live FROM personal UNION ALL SELECT live FROM host)
       SELECT (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM member),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM host),
              (SELECT CASE WHEN bool_or(live) THEN 'Live'
                           WHEN count(*)>0 THEN 'Offline'
                           ELSE 'Unregistered' END FROM pools)
     $$`,
  ],
};
