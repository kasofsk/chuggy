/**
 * A session waits on its account only while every Claude credential its
 * runner named is paused, as a job's claim does.
 *
 * `chat_host.credentials_named` IS WRITTEN BY EVERY POLL of a chat host, as
 * 164's and 165's columns are: an object keyed by agent, each holding the
 * names the poll gave that agent, or NULL where it named none, so a poll
 * naming none clears what an earlier one named. Adding it rewrites no row.
 *
 * `agent_account_session_paused` TAKES THE NAMES ITS CALLER'S RUNNER GAVE
 * CLAUDE. Where it gave some, the account is asked `agent_account_named_pause`
 * of them; where it gave none, `agent_account_pause` of the whole agent, which
 * is how every runner before the release that names them is read. Which kinds
 * pause is unchanged: a `Lead` always, a `Thread` or an `Inquiry` where its
 * owner's setting says so. Its arguments change, so it is dropped and
 * created, granted to nobody as 110 made it.
 *
 * ITS FIVE CALLERS HAND IT THEIR RUNNER'S NAMES: a pool's session reads and
 * `lead_runner_standing` the pool's, with the member who registered it as the
 * account, and a chat host's session reads its own, with its owner as the
 * account. `lead_runner_standing` counts a live pool paused only while that
 * rule pauses it, and where every live pool is paused answers the earliest end
 * among those pools' own pauses. Each keeps its signature, owner and grants,
 * and its body is 110's, 162's or 130's with the names added, written out
 * rather than built from theirs, so this file goes on saying what it installed
 * when those change.
 *
 * THE OWNER READS A CHAT HOST'S NAMES, so it is granted that column, as 166
 * granted it a pool's.
 */

import {
  agentAccountNamedPauseFunction,
  agentAccountPauseFunction,
  agentAccountSessionPausedFunction,
  agentAccountSettingsFunction,
  boundaryOwnerRole,
  chatHostSessionOpenFunction,
  chatHostSessionsAwaitingFunction,
  leadRunnerStandingFunction,
  memberScopeProjectFunction,
  poolPlaneRole,
  poolSessionOpenFunction,
  poolSessionsAwaitingFunction,
  sessionClaimableSinceFunction,
  sessionWaitingRouteFunction,
  type Migration,
} from "../shared.ts";

const sessionPausedOld = `public.${agentAccountSessionPausedFunction}(in_principal text, in_kind text)`;
const sessionPaused = `public.${agentAccountSessionPausedFunction}(in_principal text, in_kind text, in_credentials text[])`;

const poolAwaiting = `public.${poolSessionsAwaitingFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const poolOpened = `public.${poolSessionOpenFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb)`;

const hostAwaiting = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_member_scope boolean DEFAULT false)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

const leadRunners = `public.${leadRunnerStandingFunction}(in_tenant text, in_project text, in_polled_secs_max bigint)`;

/** The names a runner's kept `credentials_named`, `named`, gives Claude, as an array, empty where it gave none. */
function claudeNamed(named: string): string {
  return `ARRAY(SELECT jsonb_array_elements_text(${named}->'Claude'))`;
}

/** Until when `principal`'s Claude is paused for a runner that gave it `credentials`: the named rule where it gave some, the whole agent's where it gave none. */
function claudePause(principal: string, credentials: string): string {
  return `(SELECT h.paused_until
             FROM ${agentAccountPauseFunction}(${principal},'Claude') h
            WHERE COALESCE(cardinality(${credentials}),0)=0
           UNION ALL
           SELECT h.paused_until
             FROM ${agentAccountNamedPauseFunction}(${principal},'Claude',${credentials}) h
            WHERE COALESCE(cardinality(${credentials}),0)>0)`;
}

export const migration167: Migration = {
  version: 167,
  name: "a session waits on its account only while every credential its runner named is paused",
  statements: [
    `ALTER TABLE public.chat_host
       ADD COLUMN credentials_named jsonb
         CONSTRAINT chat_host_credentials_named_is_an_object
         CHECK (jsonb_typeof(credentials_named)='object')`,
    `GRANT SELECT(credentials_named),UPDATE(credentials_named)
       ON TABLE public.chat_host TO ${poolPlaneRole}`,
    `GRANT SELECT(credentials_named) ON TABLE public.chat_host TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${sessionPausedOld}`,
    `CREATE FUNCTION ${sessionPaused} RETURNS boolean
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT CASE WHEN in_kind='Lead' THEN true
                     WHEN in_kind IN ('Thread','Inquiry') THEN t.pauses_threads
                     ELSE false END
                AND held.paused_until IS NOT NULL
           FROM ${agentAccountSettingsFunction}(in_principal,'Claude') t
          CROSS JOIN ${claudePause("in_principal", "in_credentials")} held
       $$`,
    `ALTER FUNCTION ${sessionPaused} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${sessionPaused} FROM PUBLIC`,
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
          AND NOT ${agentAccountSessionPausedFunction}(w.registered_by,s.kind,
                ${claudeNamed("w.credentials_named")})
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
     DECLARE standing record; numbered bigint; current text; registrant text; named jsonb;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object'
          OR in_launch IS NULL OR jsonb_typeof(in_launch)<>'object' THEN
         RAISE EXCEPTION 'pool session attempt % is opened without the invocation and launch its runner fetches',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'worker-pool-claim:' || in_tenant || '/' || in_project || '/' || in_pool, 0));
       SELECT w.registered_by,w.credentials_named INTO registrant,named FROM worker_pool w
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
          OR ${agentAccountSessionPausedFunction}(registrant,standing.kind,
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
                      s.agent_reference,s.state,h.credentials_named
                 FROM chat_host h
                 JOIN project p ON p.tenant=h.tenant AND p.lifecycle='Active'
                 JOIN agent_session s ON s.tenant=p.tenant AND s.project=p.project
                                     AND s.principal=h.owner
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal
               UNION ALL
               SELECT s.tenant,s.project,s.session,s.kind,s.capabilities,
                      s.agent_reference,s.state,h.credentials_named
                 FROM chat_host h
                 JOIN agent_session s
                   ON s.tenant=h.tenant
                  AND s.project=${memberScopeProjectFunction}(h.owner)
                  AND s.principal=h.owner AND s.scope='Member'
                WHERE h.tenant=in_tenant AND h.owner=in_owner
                  AND h.principal=in_principal AND in_member_scope) s
        WHERE s.state='Open' AND s.kind IN ('Thread','Inquiry')
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='Pool'
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
     DECLARE standing record; numbered bigint; current text; named jsonb;
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
          OR ${agentAccountSessionPausedFunction}(in_owner,standing.kind,
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
    `CREATE OR REPLACE FUNCTION ${leadRunners}
       RETURNS TABLE(standing text, paused_until timestamp with time zone)
       LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH live AS (
         SELECT w.registered_by,${claudeNamed("w.credentials_named")} AS named
           FROM worker_pool w
          WHERE w.tenant=in_tenant AND w.project=in_project
            AND w.last_polled_at > now() - make_interval(
                  secs => in_polled_secs_max::double precision)),
       held AS (
         SELECT ${agentAccountSessionPausedFunction}(l.registered_by,'Lead',l.named) AS paused,
                (SELECT h.paused_until
                   FROM ${claudePause("l.registered_by", "l.named")} h) AS paused_until
           FROM live l)
       SELECT CASE WHEN bool_or(NOT h.paused) THEN 'Live'
                   WHEN bool_or(h.paused) THEN 'Paused'
                   ELSE 'Offline' END,
              CASE WHEN NOT COALESCE(bool_or(NOT h.paused),false)
                   THEN min(h.paused_until) END
         FROM held h
     $$`,
  ],
};
