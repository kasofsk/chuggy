/**
 * An account's agent is paused until an instant, and a runner of that account
 * is handed no new work that would spend it.
 *
 * THE RULE IS `agent_account_pause`, AND IT IS STATED NOWHERE ELSE. It reads
 * the readings and the limit 109 keeps, the person's settings and their
 * presses, at the database's own `now()`, and answers until when the agent is
 * paused, each reason that holds it, and whether a press lets one claim
 * through. Nothing about a pause is stored, so a changed threshold or a reset
 * that passed is the answer at the next claim.
 *
 * - A reading pauses until its reset while the reset is ahead and its
 *   utilization is at or over that window's threshold. One whose reset has
 *   passed counts for nothing.
 * - A limit pauses until its reset, or an hour after it was received where
 *   its reset is unknown, unless a reading was observed after it: the account
 *   answered again.
 * - A press made after the limit, and not yet spent, lets one claim through
 *   the limit and no other pause. The claim it lets through spends it, by a
 *   conditional write on its row in the claim's own statement, so of two
 *   claims racing for one account the second waits on that row and finds it
 *   spent. No other lock serializes one account's claims.
 * - Where several hold, the pause lasts until the latest ends.
 * - An account no person holds is never paused.
 *
 * A PERSON'S SETTINGS ARE THEIR ROW, OR THE DEFAULTS `agent_account_settings`
 * NAMES WHERE THEY WROTE NONE: a threshold for each window as a whole
 * percentage, whether their threads and inquiries pause, and whether the lead
 * of a pool they registered pauses. Both relations are keyed by principal and
 * agent, as the readings are.
 *
 * A SESSION SPENDS CLAUDE, since a session's container runs Claude Code
 * through the SDK. A pool's claim of its project's lead, and a chat host's of
 * its owner's threads and inquiries, pass over a session its account has
 * paused where that account's option says the kind pauses, both where a
 * session is read as waiting and again under the lock that opens it. A press
 * lets no session through. A turn nothing takes is withdrawn once its dwell
 * runs, as any unserved turn is.
 *
 * The session bodies are 090's and 094's with the pause added, written out
 * rather than built from theirs, so this file goes on saying what it installed
 * when those change.
 */

import {
  agentAccountPauseFunction,
  agentAccountSessionPausedFunction,
  agentAccountSettingsFunction,
  boundaryOwnerRole,
  chatHostSessionOpenFunction,
  chatHostSessionsAwaitingFunction,
  memberScopeProjectFunction,
  poolPlaneRole,
  poolSessionOpenFunction,
  poolSessionsAwaitingFunction,
  sessionClaimableSinceFunction,
  sessionWaitingRouteFunction,
  type Migration,
} from "../shared.ts";

const settings = `public.${agentAccountSettingsFunction}(in_principal text, in_agent text)`;

const pause = `public.${agentAccountPauseFunction}(in_principal text, in_agent text)`;

const sessionPaused = `public.${agentAccountSessionPausedFunction}(in_principal text, in_kind text)`;

const poolAwaiting = `public.${poolSessionsAwaitingFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const poolOpened = `public.${poolSessionOpenFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const hostAwaiting = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_member_scope boolean DEFAULT false)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

/** The key both relations open with: whose account, and which agent of it. */
function accountKey(relation: string): string {
  return `principal text NOT NULL
         CONSTRAINT ${relation}_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       agent text NOT NULL
         CONSTRAINT ${relation}_agent_is_known CHECK (agent IN ('Claude','Codex'))`;
}

/** The owner a function is installed under, callable by `role` or by nobody but its owner. */
function owned(signature: string, role?: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...(role === undefined
      ? []
      : [`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`]),
  ];
}

export const migration110: Migration = {
  version: 110,
  name: "an account's agent is paused, and its runners claim nothing that spends it",
  statements: [
    `CREATE TABLE public.agent_account_setting (
       ${accountKey("agent_account_setting")},
       five_hour_percent smallint NOT NULL
         CONSTRAINT agent_account_setting_five_hour_is_a_percentage
         CHECK (five_hour_percent BETWEEN 1 AND 100),
       seven_day_percent smallint NOT NULL
         CONSTRAINT agent_account_setting_seven_day_is_a_percentage
         CHECK (seven_day_percent BETWEEN 1 AND 100),
       pauses_threads boolean NOT NULL,
       pauses_lead boolean NOT NULL,
       PRIMARY KEY (principal,agent))`,
    `CREATE TABLE public.agent_account_press (
       ${accountKey("agent_account_press")},
       pressed_at timestamp with time zone NOT NULL,
       spent_at timestamp with time zone,
       CONSTRAINT agent_account_press_is_spent_after_it_is_pressed
         CHECK (spent_at IS NULL OR spent_at >= pressed_at),
       PRIMARY KEY (principal,agent))`,
    `GRANT SELECT ON TABLE public.agent_account_setting TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.agent_account_press TO ${boundaryOwnerRole}`,
    `GRANT SELECT(registered_by) ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(principal,agent,spent_at),UPDATE(spent_at)
       ON TABLE public.agent_account_press TO ${poolPlaneRole}`,
    `CREATE FUNCTION ${settings}
       RETURNS TABLE(five_hour_percent smallint, seven_day_percent smallint, pauses_threads boolean, pauses_lead boolean)
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT COALESCE(s.five_hour_percent,80::smallint),
                COALESCE(s.seven_day_percent,90::smallint),
                COALESCE(s.pauses_threads,false),
                COALESCE(s.pauses_lead,true)
           FROM (SELECT 1) one
           LEFT JOIN agent_account_setting s
             ON s.principal=in_principal AND s.agent=in_agent
       $$`,
    ...owned(settings),
    `CREATE FUNCTION ${pause}
       RETURNS TABLE(paused_until timestamp with time zone, reasons text[], admitted_by_press boolean)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         WITH holding AS (
           SELECT u.usage_window AS reason, u.resets_at AS until
             FROM agent_account_usage u
            CROSS JOIN ${agentAccountSettingsFunction}(in_principal,in_agent) t
            WHERE u.principal=in_principal AND u.agent=in_agent
              AND u.resets_at>now()
              AND u.utilization>=(CASE u.usage_window
                                    WHEN 'five_hour' THEN t.five_hour_percent
                                    WHEN 'seven_day' THEN t.seven_day_percent
                                  END)::double precision/100
           UNION ALL
           SELECT 'limit', COALESCE(l.resets_at,l.observed_at+interval '1 hour')
             FROM agent_account_limit l
            WHERE l.principal=in_principal AND l.agent=in_agent
              AND COALESCE(l.resets_at,l.observed_at+interval '1 hour')>now()
              AND NOT EXISTS(SELECT 1 FROM agent_account_usage u
                              WHERE u.principal=l.principal AND u.agent=l.agent
                                AND u.observed_at>l.observed_at))
         SELECT max(h.until),
                COALESCE(array_agg(h.reason ORDER BY h.reason),'{}'::text[]),
                COALESCE(bool_and(h.reason='limit'),false)
                  AND EXISTS(SELECT 1 FROM agent_account_press p
                               JOIN agent_account_limit l
                                 ON l.principal=p.principal AND l.agent=p.agent
                              WHERE p.principal=in_principal AND p.agent=in_agent
                                AND p.spent_at IS NULL
                                AND p.pressed_at>l.observed_at)
           FROM holding h
       $$`,
    ...owned(pause, poolPlaneRole),
    `CREATE FUNCTION ${sessionPaused} RETURNS boolean
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT CASE WHEN in_kind='Lead' THEN t.pauses_lead
                     WHEN in_kind IN ('Thread','Inquiry') THEN t.pauses_threads
                     ELSE false END
                AND held.paused_until IS NOT NULL
           FROM ${agentAccountSettingsFunction}(in_principal,'Claude') t
          CROSS JOIN ${agentAccountPauseFunction}(in_principal,'Claude') held
       $$`,
    ...owned(sessionPaused),
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
          AND NOT ${agentAccountSessionPausedFunction}(w.registered_by,s.kind)
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
     DECLARE standing record; numbered bigint; current text; registrant text;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'pool session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       SELECT w.registered_by INTO registrant FROM worker_pool w
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
               IS DISTINCT FROM 'Pool'
          OR ${agentAccountSessionPausedFunction}(registrant,standing.kind) THEN
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
    `CREATE OR REPLACE FUNCTION ${hostAwaiting}
       RETURNS TABLE(project text, session text, kind text, capabilities text[], agent_reference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.session,s.kind,s.capabilities,s.agent_reference
         FROM (SELECT s.tenant,s.project,s.session,s.kind,s.capabilities,
                      s.agent_reference,s.state
                 FROM chat_host h
                 JOIN project p ON p.tenant=h.tenant AND p.lifecycle='Active'
                 JOIN agent_session s ON s.tenant=p.tenant AND s.project=p.project
                                     AND s.principal=h.owner
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal
               UNION ALL
               SELECT s.tenant,s.project,s.session,s.kind,s.capabilities,
                      s.agent_reference,s.state
                 FROM chat_host h
                 JOIN agent_session s
                   ON s.tenant=h.tenant
                  AND s.project=${memberScopeProjectFunction}(h.owner)
                  AND s.principal=h.owner AND s.scope='Member'
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal AND in_member_scope) s
        WHERE s.state='Open' AND s.kind IN ('Thread','Inquiry')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
          AND NOT ${agentAccountSessionPausedFunction}(in_owner,s.kind)
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
          idle_since,pool,pool_principal,holder_kind,idle_secs,assignment,image,launch)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,'ChatHost',in_idle_secs,in_assignment,in_image,in_launch);
       RETURN 'Opened';
     END $$`,
  ],
};
