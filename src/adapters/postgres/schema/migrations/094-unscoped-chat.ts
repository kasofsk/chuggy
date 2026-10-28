/**
 * A member's chat opened with no project selected is an unscoped thread: a
 * session of their own in their tenant, run on their chat host alone.
 *
 * A SESSION NAMES ITS SCOPE. `agent_session.scope` is `Project`, as every
 * session opened before this is, or `Member`. A member-scoped session's
 * partition is the member's reserved one, `@member-` and the hex SHA-256 of
 * their principal, which `member_scope_project` computes and a check holds the
 * row to, and which no project can take: `project` refuses an identity
 * beginning `@`. Its project key becomes `project_ref`, the partition where the
 * scope is `Project` and nothing where it is `Member`, so a member's session
 * names no project row and the tenant is held by a key of its own.
 *
 * A MEMBER'S SESSION DRAWS NO CAPACITY. Its `account` and `cluster` are absent
 * exactly where the scope is `Member`, because it runs on its owner's chat host
 * and never in cluster. `session_route` answers `Pool` for a reserved partition
 * before reading any override, and `enqueue_session_turn` refuses any other
 * route for a member's session, so no turn of one can reach the scheduler.
 *
 * IT IS A THREAD AND HOLDS `MemberRead` ALONE. A member's session is a thread,
 * its roster is `MemberRead` or nothing, and no project's session may hold
 * `MemberRead`, so neither scope's tools reach the other's sessions.
 * `open_unscoped_thread` opens one under the member's thread limit, which no
 * row can raise for a partition no project holds, idempotently by its key.
 *
 * ITS OWNER'S CHAT HOST CLAIMS IT, keyed by the owner and the reserved
 * partition rather than by a project row, and only where the host's caller
 * says it speaks a contract that runs one; a pool claims its project's lead
 * alone and a personal runner the threads of projects it allowlists, so
 * neither reaches one. A caller naming no scope is answered as it was before,
 * so a pool plane still running the earlier image goes on claiming project
 * sessions. A session bearer is answered with its session's scope.
 *
 * The bodies are written out rather than built from the helpers earlier
 * migrations use, so this file goes on saying what it installed when those
 * change.
 */

import {
  apiRole,
  boundaryOwnerRole,
  chatHostSessionHoldingFunction,
  chatHostSessionOpenFunction,
  chatHostSessionsAwaitingFunction,
  memberScopeProjectFunction,
  memberThreadsReadFunction,
  poolPlaneRole,
  sessionBearerAuthenticateFunction,
  sessionClaimableSinceFunction,
  sessionReferenceWrittenOnceFunction,
  sessionRouteFunction,
  sessionTurnEnqueueFunction,
  sessionWaitingRouteFunction,
  threadLimitFunction,
  unscopedThreadOpenFunction,
  type Migration,
} from "../shared.ts";

const memberProject = `public.${memberScopeProjectFunction}(in_principal text)`;

const unscopedOpened = `public.${unscopedThreadOpenFunction}(in_tenant text, in_principal text, in_session text, in_key text, in_credential_slot text, in_system_prompt text)`;

const memberThreads = `public.${memberThreadsReadFunction}(in_tenant text, in_principal text, in_max bigint)`;

const bearer = `public.${sessionBearerAuthenticateFunction}(in_secret_digest text)`;

const routed = `public.${sessionRouteFunction}(in_tenant text, in_project text, in_kind text)`;

const enqueued = `public.${sessionTurnEnqueueFunction}(in_tenant text, in_project text, in_session text, in_turn text, in_input_kind text, in_input text, in_route text)`;

const hostAwaitingBefore = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint)`;

const hostAwaiting = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_member_scope boolean)`;

/** The same signature as created: a caller that names no member scope is answered as before it existed. */
const hostAwaitingCreated = `public.${chatHostSessionsAwaitingFunction}(in_tenant text, in_owner text, in_principal text, in_backoff_secs bigint, in_max bigint, in_member_scope boolean DEFAULT false)`;

const hostOpened = `public.${chatHostSessionOpenFunction}(in_tenant text, in_owner text, in_principal text, in_project text, in_session text, in_capabilities text[], in_agent_reference text, in_attempt text, in_assignment text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_held_max bigint, in_invocation jsonb, in_image text, in_launch jsonb, in_idle_secs bigint)`;

const hostHolding = `public.${chatHostSessionHoldingFunction}(in_tenant text, in_owner text, in_principal text)`;

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

export const migration094: Migration = {
  version: 94,
  name: "a member's unscoped thread is a session of their own",
  statements: [
    `ALTER TABLE public.project
       ADD CONSTRAINT project_identity_is_not_reserved CHECK (project !~ '^@')`,
    `CREATE FUNCTION ${memberProject} RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT '@member-' || encode(sha256(convert_to(in_principal,'UTF8')),'hex')
     $$`,
    ...owned(memberProject),
    `ALTER TABLE public.agent_session
       ADD COLUMN scope text NOT NULL DEFAULT 'Project'
         CONSTRAINT agent_session_scope_is_known
         CHECK (scope IN ('Project','Member')),
       ADD COLUMN project_ref text
         GENERATED ALWAYS AS (CASE WHEN scope='Project' THEN project END) STORED,
       ALTER COLUMN account DROP NOT NULL,
       ALTER COLUMN cluster DROP NOT NULL`,
    `ALTER TABLE public.agent_session
       DROP CONSTRAINT agent_session_belongs_to_project,
       ADD CONSTRAINT agent_session_belongs_to_project
         FOREIGN KEY (tenant, project_ref) REFERENCES public.project(tenant, project),
       ADD CONSTRAINT agent_session_names_a_tenant
         FOREIGN KEY (tenant) REFERENCES public.tenant(tenant),
       ADD CONSTRAINT agent_session_member_scope_is_its_owners
         CHECK ((scope='Member') = (project=${memberScopeProjectFunction}(principal))),
       ADD CONSTRAINT agent_session_member_scope_draws_nothing
         CHECK ((scope='Member') = (account IS NULL AND cluster IS NULL)),
       ADD CONSTRAINT agent_session_member_scope_is_a_thread
         CHECK (scope='Project' OR kind='Thread'),
       DROP CONSTRAINT agent_session_capabilities_are_known,
       ADD CONSTRAINT agent_session_capabilities_are_known
         CHECK (cardinality(capabilities) BETWEEN 0 AND 16
                AND capabilities <@ ARRAY['RepositoryRead','RepositoryWrite',
                  'RunCommands','ProjectRead','DraftAuthor','DraftOriginate',
                  'TicketDispatch','LeadDecision','MemberRead']::text[]),
       ADD CONSTRAINT agent_session_member_read_is_member_scoped
         CHECK (CASE WHEN scope='Member'
                     THEN capabilities <@ ARRAY['MemberRead']::text[]
                     ELSE NOT 'MemberRead'=ANY(capabilities) END)`,
    `CREATE OR REPLACE FUNCTION public.${sessionReferenceWrittenOnceFunction}() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
     BEGIN
       IF (NEW.tenant,NEW.project,NEW.session,NEW.kind,NEW.principal,NEW.parent_session,
           NEW.credential_slot,NEW.account,NEW.cluster,NEW.opened_at,NEW.open_key,
           NEW.scope)
          IS DISTINCT FROM
          (OLD.tenant,OLD.project,OLD.session,OLD.kind,OLD.principal,OLD.parent_session,
           OLD.credential_slot,OLD.account,OLD.cluster,OLD.opened_at,OLD.open_key,
           OLD.scope) THEN
         RAISE EXCEPTION 'session % would change what it was opened as', OLD.session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.agent_reference IS NOT NULL
          AND NEW.agent_reference IS DISTINCT FROM OLD.agent_reference THEN
         RAISE EXCEPTION
           'session % already runs under a runtime session, and a second is a second transcript',
           OLD.session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF OLD.state = 'Closed' AND NEW.state <> 'Closed' THEN
         RAISE EXCEPTION 'session % is closed, and a closed session takes no more turns',
           OLD.session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF NEW.turn_next < OLD.turn_next OR NEW.attempt_next < OLD.attempt_next THEN
         RAISE EXCEPTION 'session % would reuse an ordinal or an attempt number', OLD.session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${routed} RETURNS TABLE(route text, source text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE routed text; overridden text; published text; placed text;
     BEGIN
       routed := CASE in_kind WHEN 'Thread' THEN 'Thread'
                              WHEN 'Lead' THEN 'Lead'
                              WHEN 'Inquiry' THEN 'Lead' END;
       IF routed IS NULL THEN
         RAISE EXCEPTION 'session kind % has no route', in_kind
           USING ERRCODE = 'invalid_parameter_value';
       END IF;
       IF left(in_project,1)='@' THEN
         RETURN QUERY SELECT 'Pool'::text,'Default'::text; RETURN;
       END IF;
       SELECT r.project_routes #>> ARRAY[in_tenant,in_project,routed],
              CASE routed WHEN 'Thread' THEN r.thread_route ELSE r.lead_route END
         INTO overridden,published FROM session_routing r;
       IF overridden IS NOT NULL THEN
         RETURN QUERY SELECT overridden,'Override'::text; RETURN;
       END IF;
       SELECT CASE routed WHEN 'Thread' THEN p.thread_route ELSE p.lead_route END
         INTO placed FROM project_session_placement p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF placed IS NOT NULL THEN
         RETURN QUERY SELECT placed,'Project'::text; RETURN;
       END IF;
       RETURN QUERY SELECT coalesce(published,'InCluster'),'Default'::text;
     END $$`,
    `CREATE OR REPLACE FUNCTION ${enqueued} RETURNS TABLE(enqueued text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; minted bigint;
     BEGIN
       SELECT s.state,s.turn_next,s.scope INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND THEN
         RAISE EXCEPTION 'there is no session % to enqueue a turn for', in_session
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF held.scope='Member' AND in_route IS DISTINCT FROM 'Pool' THEN
         RAISE EXCEPTION 'session % is its member''s own and runs on their chat host alone',
           in_session USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing; RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND project=in_project AND session=in_session AND t.state='Queued';
       IF queued>=256 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET turn_next=s.turn_next+1
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session RETURNING s.turn_next-1 INTO minted;
       INSERT INTO session_turn (tenant,project,session,turn,ordinal,input_kind,input,route)
         VALUES(in_tenant,in_project,in_session,in_turn,minted,in_input_kind,in_input,in_route);
       RETURN QUERY SELECT 'Enqueued'::text,minted;
     END $$`,
    `CREATE FUNCTION ${unscopedOpened}
       RETURNS TABLE(opened text, session text, threads_max bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE reserved text; held text; allowed bigint;
     BEGIN
       reserved := ${memberScopeProjectFunction}(in_principal);
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'member-thread-open:' || in_tenant || '/' || reserved || '/' || in_principal, 0));
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=reserved
          AND s.kind='Thread' AND s.principal=in_principal AND s.open_key=in_key;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held,NULL::bigint; RETURN;
       END IF;
       allowed := ${threadLimitFunction}(in_tenant,reserved,in_principal);
       IF (SELECT count(*) FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=reserved AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open')>=allowed THEN
         RETURN QUERY SELECT 'ThreadLimitReached'::text,NULL::text,allowed; RETURN;
       END IF;
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster,system_prompt,opened_after_sequence,open_key,scope)
       VALUES(in_tenant,reserved,in_session,'Thread',in_principal,
              ARRAY['MemberRead']::text[],in_credential_slot,
              NULL,NULL,in_system_prompt,
              coalesce((SELECT max(head.sequence) FROM project_change head),0),
              in_key,'Member');
       RETURN QUERY SELECT 'Opened'::text,in_session,NULL::bigint;
     END $$`,
    ...owned(unscopedOpened, apiRole),
    `CREATE FUNCTION ${memberThreads}
       RETURNS TABLE(project text, scope text, session text, principal text, state text, agent_reference text, turns bigint, first_message text, member_title text, opened_at timestamp with time zone, last_activity_at timestamp with time zone, hidden_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.project,s.scope,s.session,s.principal,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              (SELECT left(CASE WHEN strpos(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10))>0
                  THEN split_part(t.input,chr(10)||chr(10)||'# What your owner says'||chr(10)||chr(10),-1)
                  ELSE split_part(t.input,'- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.'||chr(10)||chr(10),-1) END,80)
         FROM session_turn t
        WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
          AND t.input_kind='UserMessage'
        ORDER BY t.ordinal
        LIMIT 1),
              s.member_title,s.opened_at,moved.at,s.hidden_at
         FROM agent_session s
         CROSS JOIN LATERAL (
           SELECT greatest(s.opened_at,s.closed_at,
                    (SELECT max(greatest(t.enqueued_at,t.ended_at))
                       FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session)) AS at) moved
        WHERE s.tenant=in_tenant AND s.principal=in_principal AND s.kind='Thread'
        ORDER BY (s.scope='Member' AND s.state='Open') DESC,
                 (s.state='Open') DESC,moved.at DESC,s.project,s.session
        LIMIT least(coalesce(in_max,64),64)
     $$`,
    ...owned(memberThreads, apiRole),
    `CREATE INDEX agent_session_threads_by_member ON public.agent_session
       USING btree (tenant, principal) WHERE kind='Thread'`,
    `DROP FUNCTION ${bearer}`,
    `CREATE FUNCTION ${bearer}
       RETURNS TABLE(tenant text, project text, session text, kind text, principal text, scope text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,s.kind,s.principal,s.scope
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
          AND a.state IN ('Placing','Running') AND s.state='Open'
          AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
     $$`,
    ...owned(bearer, apiRole),
    `DROP FUNCTION ${hostAwaitingBefore}`,
    `CREATE FUNCTION ${hostAwaitingCreated}
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
    `CREATE OR REPLACE FUNCTION ${hostHolding}
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
          AND (a.project=${memberScopeProjectFunction}(in_owner)
               OR EXISTS(SELECT 1 FROM project p
                          WHERE p.tenant=a.tenant AND p.project=a.project
                            AND p.lifecycle='Active'))
     $$`,
  ],
};
