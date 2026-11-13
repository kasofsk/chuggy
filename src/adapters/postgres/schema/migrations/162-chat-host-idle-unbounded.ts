/**
 * A chat host's session sits idle as long as its host named, and without limit
 * where it named none.
 *
 * AN ATTEMPT RECORDS WHETHER IT HAS AN IDLE BOUND. `idle_unbounded` is true
 * where a chat host claimed it naming no bound, and false for every other
 * attempt; `idle_secs` stays the bound a chat host named, no longer capped at
 * the scheduler's. So NULL `idle_secs` alone still means "no bound of its own
 * recorded", which the reaper reads as the scheduler's window, and every
 * attempt recorded before this is false and keeps the bound it was recorded
 * with. An unbounded attempt is a chat host's and names no bound of its own.
 * A bound is held to what the poll admits, `workerPoolPollIdleSecsMax`, so
 * the reaper's arithmetic on it stays inside what a timestamp holds.
 *
 * THE IDLE REAPER PASSES OVER AN UNBOUNDED ATTEMPT. Its lease, its own end, a
 * stop and its host's end still end it.
 *
 * `session_launch.idle_secs_max` IS DROPPED: it was published only for the
 * pool plane to cap a host's bound by, and nothing caps one now.
 *
 * The bodies are 090's reaper and 110's chat host open with the bound added,
 * written out rather than built from theirs, so this file goes on saying what
 * it installed when those change.
 */

import {
  agentAccountSessionPausedFunction,
  chatHostSessionOpenFunction,
  memberScopeProjectFunction,
  sessionAttemptReapIdleFunction,
  sessionWaitingRouteFunction,
  type Migration,
} from "../shared.ts";

const idle = `public.${sessionAttemptReapIdleFunction}(in_epoch text, in_idle_secs bigint, in_max bigint)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

export const migration162: Migration = {
  version: 162,
  name: "a chat host's session has no idle bound unless its host names one",
  statements: [
    `ALTER TABLE public.session_attempt
       ADD COLUMN idle_unbounded boolean NOT NULL DEFAULT false,
       ADD CONSTRAINT session_attempt_unbounded_is_a_chat_hosts
         CHECK (NOT idle_unbounded
                OR (holder_kind='ChatHost' AND idle_secs IS NULL)),
       ADD CONSTRAINT session_attempt_idle_secs_admitted
         CHECK (idle_secs<=2147483)`,
    `ALTER TABLE public.session_launch DROP COLUMN idle_secs_max`,
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
    `CREATE OR REPLACE FUNCTION ${hostOpened} RETURNS text
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
               IS DISTINCT FROM 'Pool'
          OR ${agentAccountSessionPausedFunction}(in_owner,standing.kind) THEN
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
  ],
};
