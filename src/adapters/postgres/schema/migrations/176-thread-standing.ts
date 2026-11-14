/**
 * A thread whose chat host restarts jobs for it is standing, and the plane
 * keeps an attempt placed for it on the host that ran its last one.
 *
 * `agent_session.standing` IS THE THREAD'S, NOT AN ATTEMPT'S. An attempt on a
 * chat host reports it through `report_session_standing`, under its bearer, and
 * the report outlives the attempt: only the thread's close, which
 * `close_agent_session` makes, or a later attempt reporting it false clears it.
 * A lead, an inquiry and a thread held anywhere but a chat host are refused
 * `NotChatHostThread`, so only an open thread is ever standing, which its
 * check holds.
 *
 * A STANDING THREAD IS CLAIMABLE WITH AN EMPTY MAILBOX, by the chat host its
 * last attempt ran on and by no other: the same owner, under the same
 * principal, so a host registered in its place starts nothing the replaced one
 * kept. Its claim is the waiting thread's in every other respect — its backoff,
 * its account's pause and the host's room — and ranks after every thread a
 * turn waits on. A thread with a turn queued is claimed by that turn's route
 * as before.
 *
 * THE IDLE REAPER PASSES OVER A STANDING THREAD'S ATTEMPT. Its lease, its own
 * end, a stop and its host's end still end it.
 *
 * `chat_host_threads_closed` NAMES WHAT A HOST MAY REMOVE: its owner's closed
 * threads whose last attempt that same principal ran, the most recently closed
 * first, to the bound its caller names. The index beside it is what that read
 * walks.
 *
 * `thread_jobs_standing` is the API's read of the column, for a thread alone.
 *
 * The bodies of 162's reaper, 167's awaiting read and chat host open and the
 * baseline's close are written out with the standing added, rather than built
 * from theirs, so this file goes on saying what it installed when those change.
 */

import {
  agentAccountSessionPausedFunction,
  apiRole,
  boundaryOwnerRole,
  chatHostSessionOpenFunction,
  chatHostSessionsAwaitingFunction,
  chatHostThreadsClosedFunction,
  memberScopeProjectFunction,
  poolPlaneRole,
  sessionAttemptReapIdleFunction,
  sessionClaimableSinceFunction,
  sessionCloseFunction,
  sessionStandingReportFunction,
  sessionWaitingRouteFunction,
  threadStandingFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const report = `public.${sessionStandingReportFunction}(in_secret_digest text, in_generation bigint, in_standing boolean)`;

const close = `public.${sessionCloseFunction}(in_tenant text, in_project text, in_session text)`;

const idle = `public.${sessionAttemptReapIdleFunction}(in_epoch text, in_idle_secs bigint, in_max bigint)`;

const hostAwaiting = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_member_scope boolean DEFAULT false)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

const threadsClosed = `public.${chatHostThreadsClosedFunction}(in_tenant text, in_owner text, in_principal text, in_max bigint)`;

const jobsStanding = `public.${threadStandingFunction}(in_tenant text, in_project text, in_session text)`;

/** The definer boilerplate every function this adds ends with, granted to `role` as that role's other doors are. */
function owned(
  signature: string,
  role: string,
  privilege: "ALL" | "EXECUTE" = "EXECUTE",
): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ${privilege} ON FUNCTION ${signature} TO ${role}`,
  ];
}

/** The names a runner's kept `credentials_named`, `named`, gives Claude, as an array, empty where it gave none. */
function claudeNamed(named: string): string {
  return `ARRAY(SELECT jsonb_array_elements_text(${named}->'Claude'))`;
}

/** Whether the newest attempt of the session `tenant`, `project`, `session` name was held by `owner`'s chat host under `principal`. */
function lastHostedBy(
  tenant: string,
  project: string,
  session: string,
  owner: string,
  principal: string,
): string {
  return `EXISTS(SELECT 1 FROM (SELECT a.holder_kind,a.pool,a.pool_principal
                   FROM session_attempt a
                  WHERE a.tenant=${tenant} AND a.project=${project}
                    AND a.session=${session}
                  ORDER BY a.attempt_number DESC LIMIT 1) last
                WHERE last.holder_kind='ChatHost' AND last.pool=${owner}
                  AND last.pool_principal=${principal})`;
}

export const migration176: Migration = {
  version: 176,
  name: "a chat host's thread with restartable jobs is standing, and kept placed",
  statements: [
    `ALTER TABLE public.agent_session
       ADD COLUMN standing boolean NOT NULL DEFAULT false,
       ADD CONSTRAINT agent_session_standing_is_an_open_threads
         CHECK (NOT standing OR (kind='Thread' AND state='Open'))`,
    `GRANT UPDATE(standing) ON TABLE public.agent_session TO ${boundaryOwnerRole}`,
    `CREATE INDEX agent_session_closed_threads
       ON public.agent_session (tenant,principal,closed_at DESC)
       WHERE kind='Thread' AND state='Closed'`,
    `CREATE FUNCTION ${report} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; held text;
     BEGIN
       IF in_standing IS NULL THEN
         RAISE EXCEPTION 'a thread is reported neither standing nor not'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN 'Fenced'; END IF;
       IF bound.kind<>'Thread' OR NOT EXISTS(SELECT 1 FROM session_attempt a
            WHERE a.attempt=bound.attempt AND a.holder_kind='ChatHost') THEN
         RETURN 'NotChatHostThread';
       END IF;
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=bound.tenant AND s.project=bound.project
          AND s.session=bound.session
          FOR UPDATE;
       IF held<>'Open' THEN RETURN 'Fenced'; END IF;
       UPDATE agent_session s SET standing=in_standing
        WHERE s.tenant=bound.tenant AND s.project=bound.project
          AND s.session=bound.session AND s.standing<>in_standing;
       RETURN 'Recorded';
     END $$`,
    ...owned(report, workerPlaneRole, "ALL"),
    `CREATE OR REPLACE FUNCTION ${close} RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text;
     BEGIN
       SELECT s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND OR held<>'Open' THEN RETURN false; END IF;
       UPDATE session_turn t
          SET state='Abandoned',failure='SessionClosed',ended_at=now(),
              attempt=NULL,claim_generation=NULL,claimed_at=NULL
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state IN ('Queued','Claimed');
       UPDATE agent_session s SET state='Closed',closed_at=now(),standing=false
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session;
       RETURN true;
     END $$`,
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
              AND a.idle_since IS NOT NULL AND NOT a.idle_unbounded
              AND a.idle_since < now() - make_interval(
                    secs => coalesce(a.idle_secs,in_idle_secs)::double precision)
              AND NOT EXISTS(SELECT 1 FROM agent_session s
                    WHERE s.tenant=a.tenant AND s.project=a.project
                      AND s.session=a.session AND s.standing)
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
    `CREATE OR REPLACE FUNCTION ${hostAwaiting}
       RETURNS TABLE(project text, session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.session,s.kind,s.capabilities,s.agent_reference
         FROM (SELECT s.tenant,s.project,s.session,s.kind,s.capabilities,
                      s.agent_reference,s.state,s.standing,h.credentials_named
                 FROM chat_host h
                 JOIN project p ON p.tenant=h.tenant AND p.lifecycle='Active'
                 JOIN agent_session s ON s.tenant=p.tenant AND s.project=p.project
                                     AND s.principal=h.owner
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal
               UNION ALL
               SELECT s.tenant,s.project,s.session,s.kind,s.capabilities,
                      s.agent_reference,s.state,s.standing,h.credentials_named
                 FROM chat_host h
                 JOIN agent_session s
                   ON s.tenant=h.tenant
                  AND s.project=${memberScopeProjectFunction}(h.owner)
                  AND s.principal=h.owner AND s.scope='Member'
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal AND in_member_scope) s
        WHERE s.state='Open' AND s.kind IN ('Thread','Inquiry')
          AND (${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
               OR (s.standing
                   AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session) IS NULL
                   AND ${lastHostedBy("s.tenant", "s.project", "s.session", "in_owner", "in_principal")}))
          AND NOT ${agentAccountSessionPausedFunction}(in_owner,s.kind,
                ${claudeNamed("s.credentials_named")})
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
    `CREATE OR REPLACE FUNCTION ${hostOpened} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE kept record; numbered bigint; current text; named jsonb; routed text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'chat host session attempt % is opened without the invocation and launch its host fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'chat-host-claim:' || in_tenant || '/' || in_owner, 0));
       SELECT h.credentials_named INTO named FROM chat_host h
        WHERE h.tenant=in_tenant AND h.owner=in_owner AND h.principal=in_principal
          AND (in_project=${memberScopeProjectFunction}(in_owner)
               OR EXISTS(SELECT 1 FROM project p
                          WHERE p.tenant=h.tenant AND p.project=in_project
                            AND p.lifecycle='Active'));
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       IF (SELECT count(*) FROM session_attempt h
            WHERE h.tenant=in_tenant AND h.holder_kind='ChatHost' AND h.pool=in_owner
              AND h.pool_principal=in_principal
              AND h.state IN ('Placing','Running'))>=in_held_max THEN
         RETURN 'PoolFull';
       END IF;
       SELECT s.state,s.kind,s.principal,s.capabilities,s.agent_reference,s.standing
         INTO kept FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NotClaimable'; END IF;
       routed:=${sessionWaitingRouteFunction}(in_tenant,in_project,in_session);
       IF kept.state<>'Open'
          OR kept.kind NOT IN ('Thread','Inquiry')
          OR kept.principal IS DISTINCT FROM in_owner
          OR kept.capabilities IS DISTINCT FROM in_capabilities
          OR kept.agent_reference IS DISTINCT FROM in_agent_reference
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND a.project=in_project
                       AND a.session=in_session
                       AND (a.state IN ('Placing','Running')
                            OR a.ended_at > now() - make_interval(
                                 secs => in_backoff_secs::double precision)))
          OR NOT (routed IS NOT DISTINCT FROM 'Pool'
                  OR (routed IS NULL AND kept.standing
                      AND ${lastHostedBy("in_tenant", "in_project", "in_session", "in_owner", "in_principal")}))
          OR ${agentAccountSessionPausedFunction}(in_owner,kept.kind,
               ${claudeNamed("named")}) THEN
         RETURN 'NotClaimable';
       END IF;
       SELECT r.epoch INTO current FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation,
          idle_since,pool,pool_principal,holder_kind,idle_secs,idle_unbounded,
          assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,'ChatHost',in_idle_secs,in_idle_secs IS NULL,
              in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
    `CREATE FUNCTION ${threadsClosed}
       RETURNS TABLE(project text, session text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.session
         FROM chat_host h
         JOIN agent_session s ON s.tenant=h.tenant AND s.principal=h.owner
        WHERE h.tenant=in_tenant AND h.owner=in_owner AND h.principal=in_principal
          AND s.kind='Thread' AND s.state='Closed'
          AND ${lastHostedBy("s.tenant", "s.project", "s.session", "h.owner", "h.principal")}
        ORDER BY s.closed_at DESC,s.project,s.session
        LIMIT in_max
     $$`,
    ...owned(threadsClosed, poolPlaneRole),
    `CREATE FUNCTION ${jobsStanding} RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.standing FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
     $$`,
    ...owned(jobsStanding, apiRole),
  ],
};
