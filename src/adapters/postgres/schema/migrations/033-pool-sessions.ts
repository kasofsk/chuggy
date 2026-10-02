/**
 * A pool's claim opens a session attempt. The scheduler publishes what a
 * session is launched with beside its routing, and the pool plane claims a
 * session whose oldest queued turn was admitted for runners, under the same
 * advisory lock an execution claim and a registration's fence take, and under
 * the session's row lock, which the withdrawal of an unserved turn takes too:
 * a claimed session's turn is never withdrawn, and a withdrawn turn is never
 * the one a claim opened for. A thread or an inquiry is claimed only by a pool
 * its own member registered, and a lead by any of its project's pools.
 *
 * A pool-held attempt records the image and the launch its runner fetches, and
 * every call the plane makes on one is scoped, as an execution's, to the
 * registration that claimed it and to the one its name is registered under
 * now. Its runner's heartbeat answers whether the pool's lease still holds it
 * and renews nothing, as 025 answers a pool's harness. Registering the name
 * again ends what an older registration held.
 *
 * An unserved turn's dwell runs from when it could first be claimed: its
 * enqueue, the end of the turn before it, or its return to the queue by an
 * attempt that had claimed it. An attempt that never claimed it restarts
 * nothing, so a turn no runner can serve is withdrawn at the first moment past
 * its dwell that no attempt holds its session; and only a session no attempt
 * holds is withdrawn from, so a runner serving a session never has the turn
 * behind the one it is answering withdrawn under it.
 */

import {
  boundaryOwnerRole,
  poolPlaneRole,
  poolSessionAssignmentsFunction,
  poolSessionHeldFunction,
  poolSessionHoldingFunction,
  poolSessionImagesFunction,
  poolSessionOpenFunction,
  poolSessionRefuseFunction,
  poolSessionReleaseFunction,
  poolSessionRenewFunction,
  poolSessionsAwaitingFunction,
  repositoryBindingReadFunction,
  schedulerRole,
  sessionAttemptHeartbeatFunction,
  sessionClaimableSinceFunction,
  sessionPoolTurnWithdrawFunction,
  sessionTaskReadFunction,
  sessionTurnReleaseFunction,
  sessionWaitingRouteFunction,
  workerPlaneRole,
  workerPoolFenceFunction,
  type Migration,
} from "../shared.ts";

/** The longest launch a pool-held attempt records, in bytes of its text. */
export const sessionAttemptLaunchBytesMax = 8_192;

const claimableSince = `public.${sessionClaimableSinceFunction}(in_tenant text, in_project text, in_session text)`;

const awaiting = `public.${poolSessionsAwaitingFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const opened = `public.${poolSessionOpenFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const assignments = `public.${poolSessionAssignmentsFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignments text[])`;

const releaseStamped = "public.session_turn_release_stamped()";

const holding = `public.${poolSessionHoldingFunction}(in_tenant text, in_project text, in_pool text, in_principal text)`;

const renewed = `public.${poolSessionRenewFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text, in_lease_secs bigint)`;

const held = `public.${poolSessionHeldFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text)`;

const refused = `public.${poolSessionRefuseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text, in_evidence text)`;

const released = `public.${poolSessionReleaseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text)`;

const images = `public.${poolSessionImagesFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_max bigint)`;

const fenced = `public.${workerPoolFenceFunction}(in_tenant text, in_project text, in_pool text)`;

const unserved = `public.${sessionPoolTurnWithdrawFunction}(in_epoch text, in_dwell_secs bigint, in_max bigint)`;

const heartbeat = `public.${sessionAttemptHeartbeatFunction}(in_secret_digest text, in_generation bigint, in_lease_secs bigint)`;

const readTask = `public.${sessionTaskReadFunction}(in_secret_digest text)`;

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

export const migration033: Migration = {
  version: 33,
  name: "a pool's claim opens a session attempt",
  statements: [
    `CREATE TABLE public.session_launch (
       singleton integer PRIMARY KEY DEFAULT 1
         CONSTRAINT session_launch_is_one_row CHECK (singleton=1),
       image text NOT NULL
         CONSTRAINT session_launch_image_is_bounded
         CHECK (length(image) BETWEEN 1 AND 512),
       authority jsonb NOT NULL
         CONSTRAINT session_launch_authority_is_an_object
         CHECK (jsonb_typeof(authority)='object'),
       mirrors jsonb NOT NULL
         CONSTRAINT session_launch_mirrors_are_an_object
         CHECK (jsonb_typeof(mirrors)='object'),
       bounds jsonb NOT NULL
         CONSTRAINT session_launch_bounds_are_an_object
         CHECK (jsonb_typeof(bounds)='object'),
       model text NOT NULL
         CONSTRAINT session_launch_model_is_bounded
         CHECK (length(model) BETWEEN 1 AND 256),
       deadline_secs bigint NOT NULL
         CONSTRAINT session_launch_deadline_is_positive CHECK (deadline_secs>0),
       backoff_secs bigint NOT NULL
         CONSTRAINT session_launch_backoff_is_whole CHECK (backoff_secs>=0),
       published_at timestamp with time zone DEFAULT now() NOT NULL)`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.session_launch TO ${schedulerRole}`,
    `GRANT SELECT ON TABLE public.session_launch TO ${poolPlaneRole}`,
    `ALTER TABLE public.session_attempt
       ADD COLUMN image text
         CONSTRAINT session_attempt_image_is_bounded
         CHECK (image IS NULL OR length(image) BETWEEN 1 AND 512),
       ADD COLUMN launch jsonb
         CONSTRAINT session_attempt_launch_is_bounded
         CHECK (launch IS NULL OR (jsonb_typeof(launch)='object'
           AND octet_length(launch::text) <= ${String(sessionAttemptLaunchBytesMax)})),
       ADD CONSTRAINT session_attempt_image_is_a_pool_s
         CHECK ((pool IS NULL) = (image IS NULL)),
       ADD CONSTRAINT session_attempt_launch_is_a_pool_s
         CHECK ((pool IS NULL) = (launch IS NULL))`,
    `GRANT UPDATE(pool_refusal) ON TABLE public.session_attempt TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(last_polled_at) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT EXECUTE ON FUNCTION public.${repositoryBindingReadFunction}(in_tenant text, in_project text, in_repository text) TO ${poolPlaneRole}`,
    `ALTER TABLE public.session_turn ADD COLUMN released_at timestamp with time zone`,
    `CREATE FUNCTION ${releaseStamped} RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       NEW.released_at := now();
       RETURN NEW;
     END $$`,
    ...owned(releaseStamped),
    `CREATE TRIGGER session_turn_records_its_release BEFORE UPDATE OF state ON public.session_turn
       FOR EACH ROW WHEN (OLD.state='Claimed' AND NEW.state='Queued')
       EXECUTE FUNCTION ${releaseStamped}`,
    `CREATE FUNCTION ${claimableSince} RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT greatest(h.enqueued_at,h.released_at,
                (SELECT max(e.ended_at) FROM session_turn e
                  WHERE e.tenant=h.tenant AND e.project=h.project
                    AND e.session=h.session AND e.ordinal<h.ordinal))
         FROM session_turn h
        WHERE h.tenant=in_tenant AND h.project=in_project
          AND h.session=in_session AND h.state='Queued'
        ORDER BY h.ordinal LIMIT 1
     $$`,
    ...owned(claimableSince),
    `CREATE FUNCTION ${awaiting}
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
          AND (s.kind='Lead' OR s.principal=w.registered_by)
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
    ...owned(awaiting, poolPlaneRole),
    `CREATE FUNCTION ${opened} RETURNS text
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
          OR (standing.kind<>'Lead'
              AND standing.principal IS DISTINCT FROM registered.registered_by)
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
          idle_since,pool,pool_principal,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_pool,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_pool,in_principal,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
    ...owned(opened, poolPlaneRole),
    `CREATE FUNCTION ${assignments} RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment FROM session_attempt a
        WHERE a.tenant=in_tenant AND a.project=in_project AND a.pool=in_pool
          AND a.pool_principal=in_principal AND a.assignment=ANY(in_assignments)
     $$`,
    ...owned(assignments, poolPlaneRole),
    `CREATE FUNCTION ${holding}
       RETURNS TABLE(assignment text, session text, attempt text, generation bigint, image text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.assignment,a.session,a.attempt,a.generation,a.image
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.tenant=in_tenant AND a.project=in_project
          AND a.pool=in_pool AND a.pool_principal=in_principal
          AND EXISTS(SELECT 1 FROM worker_pool w
                      WHERE w.tenant=a.tenant AND w.project=a.project
                        AND w.pool=a.pool AND w.principal=in_principal)
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
                           FROM ${poolSessionHoldingFunction}(in_tenant,in_project,in_pool,in_principal) h
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
                       FROM ${poolSessionHoldingFunction}(in_tenant,in_project,in_pool,in_principal) h
                      WHERE h.assignment=in_assignment)
     $$`,
    ...owned(held, poolPlaneRole),
    `CREATE FUNCTION ${refused} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.session,h.attempt,h.generation INTO bound
         FROM ${poolSessionHoldingFunction}(in_tenant,in_project,in_pool,in_principal) h
        WHERE h.assignment=in_assignment;
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET state='Lost',evidence='PlacementDenied',pool_refusal=in_evidence,
              ended_at=now(),lease_owner=NULL,lease_expires_at=NULL,idle_since=NULL
        WHERE a.attempt=bound.attempt AND a.generation=bound.generation
          AND a.state IN ('Placing','Running');
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM ${sessionTurnReleaseFunction}(in_tenant,in_project,bound.session,bound.attempt);
       RETURN true;
     END $$`,
    ...owned(refused, poolPlaneRole),
    `CREATE FUNCTION ${released} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT h.session,h.attempt,h.generation INTO bound
         FROM ${poolSessionHoldingFunction}(in_tenant,in_project,in_pool,in_principal) h
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
        WHERE t.tenant=in_tenant AND t.project=in_project
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
         FROM ${poolSessionHoldingFunction}(in_tenant,in_project,in_pool,in_principal) h
        ORDER BY h.image LIMIT in_max
     $$`,
    ...owned(images, poolPlaneRole),
    `CREATE OR REPLACE FUNCTION ${fenced} RETURNS void
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
    `CREATE OR REPLACE FUNCTION ${unserved} RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE dwelt record; withdrawn bigint;
     BEGIN
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN RETURN 0; END IF;
       withdrawn:=0;
       FOR dwelt IN SELECT s.tenant,s.project,s.session FROM agent_session s
            WHERE s.state='Open'
              AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
              AND NOT EXISTS(SELECT 1 FROM session_attempt a
                              WHERE a.tenant=s.tenant AND a.project=s.project
                                AND a.session=s.session
                                AND a.state IN ('Placing','Running'))
              AND ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session)
                    < now() - make_interval(secs => in_dwell_secs::double precision)
            ORDER BY ${sessionClaimableSinceFunction}(s.tenant,s.project,s.session),
                     s.tenant,s.project,s.session
            LIMIT in_max LOOP
         PERFORM 1 FROM agent_session s
          WHERE s.tenant=dwelt.tenant AND s.project=dwelt.project
            AND s.session=dwelt.session
            FOR UPDATE;
         UPDATE session_turn t
            SET state='Abandoned',failure='TurnWithdrawn',ended_at=now()
          WHERE t.tenant=dwelt.tenant AND t.project=dwelt.project
            AND t.session=dwelt.session AND t.route='Pool'
            AND t.turn=(SELECT h.turn FROM session_turn h
                         WHERE h.tenant=dwelt.tenant AND h.project=dwelt.project
                           AND h.session=dwelt.session AND h.state='Queued'
                         ORDER BY h.ordinal LIMIT 1)
            AND EXISTS(SELECT 1 FROM agent_session s
                        WHERE s.tenant=dwelt.tenant AND s.project=dwelt.project
                          AND s.session=dwelt.session AND s.state='Open')
            AND NOT EXISTS(SELECT 1 FROM session_attempt a
                            WHERE a.tenant=dwelt.tenant AND a.project=dwelt.project
                              AND a.session=dwelt.session
                              AND a.state IN ('Placing','Running'))
            AND ${sessionClaimableSinceFunction}(dwelt.tenant,dwelt.project,dwelt.session)
                  < now() - make_interval(secs => in_dwell_secs::double precision);
         IF FOUND THEN withdrawn:=withdrawn+1; END IF;
       END LOOP;
       RETURN withdrawn;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${heartbeat} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN false; END IF;
       UPDATE session_attempt a
          SET lease_expires_at=now()+make_interval(
                secs => in_lease_secs::double precision)
        WHERE a.attempt=bound.attempt AND a.state IN ('Placing','Running')
          AND a.pool IS NULL;
       IF FOUND THEN RETURN true; END IF;
       RETURN EXISTS(SELECT 1 FROM session_attempt a
                      WHERE a.attempt=bound.attempt AND a.pool IS NOT NULL
                        AND a.lease_expires_at>now());
     END $$`,
    `DROP FUNCTION ${readTask}`,
    `CREATE FUNCTION ${readTask}
       RETURNS TABLE(tenant text, project text, session text, attempt text,
         generation bigint, kind text, credential_slot text, live boolean,
         invocation jsonb, launch jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT a.tenant,a.project,a.session,a.attempt,a.generation,
                s.kind,s.credential_slot,
                (a.state IN ('Placing','Running') AND s.state='Open'
                 AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                        ORDER BY ordinal DESC LIMIT 1)),
                a.invocation,a.launch
           FROM session_attempt a
           JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                               AND s.session=a.session
          WHERE a.bearer_secret_digest=in_secret_digest
       $$`,
    `ALTER FUNCTION ${readTask} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${readTask} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${readTask} TO ${workerPlaneRole}`,
  ],
};
