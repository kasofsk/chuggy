/**
 * A chat host names the capabilities the threads it hosts may hold, and a
 * thread it claims holds its roster intersected with them.
 *
 * `chat_host.session_capabilities` IS WRITTEN BY EVERY POLL of a chat host, as
 * 167's `credentials_named` is: the set the poll named, or NULL where it named
 * none, so a poll naming none clears what an earlier one named. Its owner
 * reads it; nothing a session holds writes it.
 *
 * `session_attempt.host_capabilities` IS THE SET A CHAT HOST NAMED FOR THE
 * THREAD IT OPENED, recorded by `open_chat_host_session_attempt`, and NULL on
 * every other attempt, every one recorded before this included, which so keep
 * their roster. Only a chat host's attempt of a thread records one. The open
 * takes the set as one more argument, so it is dropped and created with 176's
 * body and the set added, written out rather than built from 176's, so this
 * file goes on saying what it installed when that changes; its owner and its
 * grant are given again.
 *
 * `authenticate_session_bearer` ANSWERS THE INTERSECTION: the session's roster,
 * read live as 178 reads it, less whatever its attempt's set leaves out, in the
 * roster's order. Its return type is 178's, so it is replaced in place.
 *
 * `thread_chat_host_capabilities` IS THE API'S READ OF THE SAME INTERSECTION
 * for a thread placed on a chat host now: NULL where no chat host holds a live
 * attempt of it, and its roster where the host named none.
 */

import {
  agentAccountSessionPausedFunction,
  apiRole,
  boundaryOwnerRole,
  chatHostSessionOpenFunction,
  memberScopeProjectFunction,
  poolPlaneRole,
  sessionBearerAuthenticateFunction,
  sessionWaitingRouteFunction,
  threadChatHostCapabilitiesFunction,
  type Migration,
} from "../shared.ts";

/** Every capability a session may hold, in the order the runtime names them. */
const sessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "TicketDispatch",
  "LeadDecision",
  "MemberRead",
  "ThreadOffer",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The CHECK that holds `column` to known capabilities, no more of them than there are, or to NULL. */
function capabilitySet(column: string): string {
  return `CHECK (cardinality(${column}) <= ${String(sessionCapabilities.length)}
                AND ${column} <@ ${textArray(sessionCapabilities)})`;
}

/** `roster` less what `named` leaves out, in `roster`'s order, and `roster` whole where `named` is NULL. */
function capabilitiesHeld(roster: string, named: string): string {
  return `CASE WHEN ${named} IS NULL THEN ${roster}
               ELSE ARRAY(SELECT c FROM unnest(${roster}) WITH ORDINALITY r(c,o)
                           WHERE c=ANY(${named}) ORDER BY o) END`;
}

const hostOpenedOld = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint, in_host_capabilities text[])`;

const bearer = `public.${sessionBearerAuthenticateFunction}(in_secret_digest text)`;

const threadHeld = `public.${threadChatHostCapabilitiesFunction}(in_tenant text, in_project text, in_session text)`;

/** The definer boilerplate every function this creates ends with, granted to `role` as that role's other doors are. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`,
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

export const migration179: Migration = {
  version: 179,
  name: "a chat host names the capabilities its threads may hold",
  statements: [
    `ALTER TABLE public.chat_host
       ADD COLUMN session_capabilities text[]
         CONSTRAINT chat_host_session_capabilities_are_known
         ${capabilitySet("session_capabilities")}`,
    `GRANT SELECT(session_capabilities),UPDATE(session_capabilities)
       ON TABLE public.chat_host TO ${poolPlaneRole}`,
    `ALTER TABLE public.session_attempt
       ADD COLUMN host_capabilities text[]
         CONSTRAINT session_attempt_host_capabilities_are_known
         ${capabilitySet("host_capabilities")},
       ADD CONSTRAINT session_attempt_host_capabilities_are_a_chat_hosts
         CHECK (host_capabilities IS NULL OR holder_kind='ChatHost')`,
    `DROP FUNCTION ${hostOpenedOld}`,
    `CREATE FUNCTION ${hostOpened} RETURNS text
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
       IF in_host_capabilities IS NOT NULL AND kept.kind<>'Thread' THEN
         RAISE EXCEPTION 'chat host session attempt % names its host''s capabilities for a session that is no thread',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
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
          assignment,image,launch,host_capabilities)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,current,
              'Running',in_owner,
              now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation,now(),
              in_owner,in_principal,'ChatHost',in_idle_secs,in_idle_secs IS NULL,
              in_assignment,in_image,in_launch,in_host_capabilities);
       RETURN 'Opened';
     END $$`,
    ...owned(hostOpened, poolPlaneRole),
    `CREATE OR REPLACE FUNCTION ${bearer}
       RETURNS TABLE(tenant text, project text, session text, kind text, principal text, scope text, capabilities text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,s.kind,s.principal,s.scope,
              ${capabilitiesHeld("s.capabilities", "a.host_capabilities")}
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.state IN ('Placing','Running') AND s.state='Open'
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
     $$`,
    `CREATE FUNCTION ${threadHeld} RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT ${capabilitiesHeld("s.capabilities", "a.host_capabilities")}
         FROM agent_session s
         JOIN session_attempt a ON a.tenant=s.tenant AND a.project=s.project
                               AND a.session=s.session
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
          AND a.holder_kind='ChatHost' AND a.state IN ('Placing','Running')
        ORDER BY a.attempt_number DESC
        LIMIT 1
     $$`,
    ...owned(threadHeld, apiRole),
  ],
};
