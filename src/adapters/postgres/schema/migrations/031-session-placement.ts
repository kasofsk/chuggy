import {
  apiRole,
  boundaryOwnerRole,
  leadInquiryOpenFunction,
  leadTurnEnqueueFunction,
  schedulerRole,
  selectorServiceRole,
  sessionAttemptCleanupFunction,
  sessionAttemptObservationFunction,
  sessionAttemptOpenFunction,
  sessionPlacementSetFunction,
  sessionRouteFunction,
  sessionRunnerStandingFunction,
  sessionsAwaitingPlacementFunction,
  sessionTurnClaimFunction,
  sessionTurnEnqueueFunction,
  sessionWaitingRouteFunction,
  threadMessageEnqueueFunction,
  threadWakeFunction,
  type Migration,
} from "../shared.ts";

const placementSet = `public.${sessionPlacementSetFunction}(in_tenant text, in_project text, in_thread text, in_lead text, in_authority_kind text, in_authority_subject text)`;

const route = `public.${sessionRouteFunction}(in_tenant text, in_project text, in_kind text)`;

const runnerStanding = `public.${sessionRunnerStandingFunction}(in_tenant text, in_project text, in_member text, in_polled_secs_max bigint)`;

const turnEnqueue = `public.${sessionTurnEnqueueFunction}(in_tenant text, in_project text, in_session text, in_turn text, in_input_kind text, in_input text, in_route text)`;

const leadTurnEnqueue = `public.${leadTurnEnqueueFunction}(in_tenant text, in_project text, in_turn text, in_input text, in_route text)`;

const threadMessageEnqueue = `public.${threadMessageEnqueueFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_input text, in_route text)`;

const threadWake = `public.${threadWakeFunction}(in_tenant text, in_project text, in_principal text, in_turn text, in_input text, in_route text)`;

const inquiryOpen = `public.${leadInquiryOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text, in_route text)`;

const waitingRoute = `public.${sessionWaitingRouteFunction}(in_tenant text, in_project text, in_session text)`;

const opened = `public.${sessionAttemptOpenFunction}(in_tenant text, in_project text, in_session text, in_epoch text, in_attempt text, in_bearer text, in_secret_digest text, in_lease_secs bigint, in_backoff_secs bigint, in_account_max bigint, in_cluster_max bigint, in_invocation jsonb)`;

/**
 * Where a project's sessions run is the project's own row beside the routing
 * the scheduler publishes, and `session_route` is the one resolution of the
 * two, which the API and the selector ask when they admit a turn. Every
 * existing project is backfilled in cluster with no setter; no routing row is
 * seeded, so a database no scheduler has published to resolves every session
 * in cluster, which is where every session ran before.
 *
 * A turn carries the route it was admitted on: each door that enqueues one
 * stamps the resolution it checked the hosted grant against, and a turn
 * already queued keeps it. The cluster places a session, and its attempt claims
 * a turn, only where the oldest queued turn was admitted in cluster, so a route
 * changed later moves the next turn admitted and never one queued before it.
 * Every turn queued before this migration ran in cluster and is stamped so.
 *
 * A session attempt gains the columns a pool holds one by, as an execution
 * attempt's in 002 and 022; the cluster's counts, observation and cleanup
 * leave such an attempt out. A pool records who minted the token it was
 * registered with and when it last polled.
 */
export const migration031: Migration = {
  version: 31,
  name: "where a project's sessions run is the project's own row",
  statements: [
    `CREATE TABLE public.project_session_placement (
       tenant text NOT NULL,
       project text NOT NULL,
       thread_route text NOT NULL
         CONSTRAINT project_session_placement_thread_is_known
         CHECK (thread_route IN ('InCluster','Pool')),
       lead_route text NOT NULL
         CONSTRAINT project_session_placement_lead_is_known
         CHECK (lead_route IN ('InCluster','Pool')),
       set_by_kind text,
       set_by_subject text,
       set_at timestamp with time zone,
       CONSTRAINT project_session_placement_setter_is_whole CHECK (
         (set_by_kind IS NULL AND set_by_subject IS NULL AND set_at IS NULL)
         OR (length(set_by_kind) BETWEEN 1 AND 256
             AND length(set_by_subject) BETWEEN 1 AND 256
             AND set_at IS NOT NULL)),
       PRIMARY KEY (tenant,project),
       CONSTRAINT project_session_placement_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `INSERT INTO public.project_session_placement
       (tenant,project,thread_route,lead_route)
       SELECT tenant,project,'InCluster','InCluster' FROM public.project`,
    `CREATE TABLE public.session_routing (
       singleton integer PRIMARY KEY DEFAULT 1
         CONSTRAINT session_routing_is_one_row CHECK (singleton=1),
       thread_route text NOT NULL
         CONSTRAINT session_routing_thread_is_known
         CHECK (thread_route IN ('InCluster','Pool')),
       lead_route text NOT NULL
         CONSTRAINT session_routing_lead_is_known
         CHECK (lead_route IN ('InCluster','Pool')),
       project_routes jsonb NOT NULL
         CONSTRAINT session_routing_overrides_are_an_object
         CHECK (jsonb_typeof(project_routes)='object'),
       published_at timestamp with time zone DEFAULT now() NOT NULL)`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.project_session_placement TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.session_routing TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.session_routing TO ${schedulerRole}`,
    `CREATE FUNCTION ${placementSet} RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing project_session_placement%ROWTYPE;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT * INTO standing FROM project_session_placement x
        WHERE x.tenant=in_tenant AND x.project=in_project FOR UPDATE;
       IF FOUND AND standing.thread_route=in_thread
          AND standing.lead_route=in_lead THEN
         RETURN 'Unchanged';
       END IF;
       INSERT INTO project_session_placement
         (tenant,project,thread_route,lead_route,
          set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_thread,in_lead,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project) DO UPDATE
           SET thread_route=EXCLUDED.thread_route,
               lead_route=EXCLUDED.lead_route,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`,
    `ALTER FUNCTION ${placementSet} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${placementSet} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${placementSet} TO ${apiRole}`,
    `CREATE FUNCTION ${route} RETURNS TABLE(route text, source text)
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
    `ALTER FUNCTION ${route} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${route} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${route} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${route} TO ${selectorServiceRole}`,
    `ALTER TABLE public.worker_pool
       ADD COLUMN registered_by text
         CONSTRAINT worker_pool_registered_by_is_bounded
         CHECK (registered_by IS NULL OR length(registered_by) BETWEEN 1 AND 256),
       ADD COLUMN last_polled_at timestamp with time zone`,
    `ALTER TABLE public.worker_pool_registration_token
       ADD COLUMN minted_by text
         CONSTRAINT worker_pool_registration_token_minted_by_is_bounded
         CHECK (minted_by IS NULL OR length(minted_by) BETWEEN 1 AND 256)`,
    `GRANT SELECT(registered_by,last_polled_at) ON TABLE public.worker_pool TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${runnerStanding}
       RETURNS TABLE(member_standing text, project_standing text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT CASE WHEN bool_or(w.registered_by=in_member AND polled.live) THEN 'Live'
                   WHEN bool_or(w.registered_by=in_member) THEN 'Offline'
                   ELSE 'Unregistered' END,
              CASE WHEN bool_or(polled.live) THEN 'Live'
                   WHEN count(*)>0 THEN 'Offline'
                   ELSE 'Unregistered' END
         FROM worker_pool w
        CROSS JOIN LATERAL (SELECT coalesce(w.last_polled_at > now() - make_interval(
                              secs => in_polled_secs_max::double precision),
                              false) AS live) polled
        WHERE w.tenant=in_tenant AND w.project=in_project
     $$`,
    `ALTER FUNCTION ${runnerStanding} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${runnerStanding} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${runnerStanding} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${runnerStanding} TO ${selectorServiceRole}`,
    `ALTER TABLE public.session_attempt
       ADD COLUMN pool text
         CONSTRAINT session_attempt_pool_is_bounded
         CHECK (pool IS NULL OR length(pool) BETWEEN 1 AND 256),
       ADD COLUMN pool_principal text
         CONSTRAINT session_attempt_pool_principal_is_bounded
         CHECK (pool_principal IS NULL OR length(pool_principal) BETWEEN 1 AND 256),
       ADD COLUMN assignment text UNIQUE
         CONSTRAINT session_attempt_assignment_is_bounded
         CHECK (assignment IS NULL OR length(assignment) BETWEEN 1 AND 256),
       ADD COLUMN pool_refusal text
         CONSTRAINT session_attempt_pool_refusal_is_bounded
         CHECK (pool_refusal IS NULL OR length(pool_refusal) BETWEEN 1 AND 4096),
       ADD CONSTRAINT session_attempt_assignment_is_a_pool_s
         CHECK ((pool IS NULL) = (assignment IS NULL)),
       ADD CONSTRAINT session_attempt_pool_principal_is_a_pool_s
         CHECK ((pool IS NULL) = (pool_principal IS NULL))`,
    `ALTER TABLE public.session_turn
       ADD COLUMN route text NOT NULL DEFAULT 'InCluster'
         CONSTRAINT session_turn_route_is_known
         CHECK (route IN ('InCluster','Pool'))`,
    `ALTER TABLE public.session_turn ALTER COLUMN route DROP DEFAULT`,
    `DROP FUNCTION public.${leadTurnEnqueueFunction}(text,text,text,text)`,
    `DROP FUNCTION public.${threadMessageEnqueueFunction}(text,text,text,text,text,text)`,
    `DROP FUNCTION public.${threadWakeFunction}(text,text,text,text,text)`,
    `DROP FUNCTION public.${leadInquiryOpenFunction}(text,text,text,text,text,text)`,
    `DROP FUNCTION public.${sessionTurnEnqueueFunction}(text,text,text,text,text,text)`,
    `CREATE FUNCTION ${turnEnqueue} RETURNS TABLE(enqueued text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; minted bigint;
     BEGIN
       SELECT s.state,s.turn_next INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND THEN
         RAISE EXCEPTION 'there is no session % to enqueue a turn for', in_session
           USING ERRCODE = 'integrity_constraint_violation';
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
    `ALTER FUNCTION ${turnEnqueue} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${turnEnqueue} FROM PUBLIC`,
    `CREATE FUNCTION ${leadTurnEnqueue} RETURNS TABLE(enqueued text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; answered record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1);
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held,in_turn,'Observation',in_input,in_route);
       RETURN QUERY SELECT answered.enqueued,answered.ordinal;
     END $$`,
    `ALTER FUNCTION ${leadTurnEnqueue} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${leadTurnEnqueue} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${leadTurnEnqueue} TO ${selectorServiceRole}`,
    `CREATE FUNCTION ${threadMessageEnqueue} RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal
        ORDER BY (s.state='Open') DESC,s.opened_at DESC
        LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF held.session<>in_session THEN
         RETURN QUERY SELECT 'NotYourThread'::text,NULL::bigint,held.session;
         RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyEnqueued'::text,standing,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=8 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held.session,in_turn,'UserMessage',in_input,in_route);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Enqueued'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyEnqueued'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$`,
    `ALTER FUNCTION ${threadMessageEnqueue} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${threadMessageEnqueue} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${threadMessageEnqueue} TO ${apiRole}`,
    `CREATE FUNCTION ${threadWake} RETURNS TABLE(enqueued text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; standing bigint; queued bigint; answered record;
     BEGIN
       SELECT s.session,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal
        ORDER BY (s.state='Open') DESC,s.opened_at DESC
        LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoThread'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF held.state<>'Open' THEN
         RETURN QUERY SELECT 'Closed'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT t.ordinal INTO standing FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyWoken'::text,standing,held.session; RETURN;
       END IF;
       SELECT count(*) INTO queued FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=held.session AND t.state='Queued';
       IF queued>=8 THEN
         RETURN QUERY SELECT 'Backlogged'::text,NULL::bigint,held.session; RETURN;
       END IF;
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,held.session,in_turn,'Wake',in_input,in_route);
       RETURN QUERY SELECT CASE answered.enqueued
                             WHEN 'Enqueued' THEN 'Woken'
                             WHEN 'AlreadyEnqueued' THEN 'AlreadyWoken'
                             ELSE answered.enqueued END,
                          answered.ordinal,held.session;
     END $$`,
    `ALTER FUNCTION ${threadWake} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${threadWake} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${threadWake} TO ${selectorServiceRole}`,
    `CREATE FUNCTION ${inquiryOpen} RETURNS TABLE(opened text, ordinal bigint, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE standing bigint; parent record; head bigint; held bigint; answered record;
     BEGIN
       SELECT t.ordinal INTO standing FROM session_turn t
         JOIN agent_session s ON s.tenant=t.tenant AND s.project=t.project
                             AND s.session=t.session
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Inquiry' AND s.principal=in_principal AND t.turn=in_turn;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,standing,in_session; RETURN;
       END IF;
       SELECT s.session,s.state,s.agent_reference,s.credential_slot,
              s.account,s.cluster,s.system_prompt
         INTO parent FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
        FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'NoLead'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       IF parent.state<>'Open' THEN
         RETURN QUERY SELECT 'LeadClosed'::text,NULL::bigint,parent.session; RETURN;
       END IF;
       SELECT (SELECT coalesce(max(t.batch_last),0) FROM session_turn t
                WHERE t.tenant=in_tenant AND t.project=in_project AND t.session=parent.session
                  AND t.state IN ('Answered','Failed')) INTO head;
       IF parent.agent_reference IS NULL OR head=0 THEN
         RETURN QUERY SELECT 'LeadNotStarted'::text,NULL::bigint,parent.session;
         RETURN;
       END IF;
       SELECT count(*) INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Inquiry' AND s.principal=in_principal AND s.state='Open';
       IF held>=2 THEN
         RETURN QUERY SELECT 'InFlight'::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,parent_session,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,'Inquiry',in_principal,parent.session,
              ARRAY['ProjectRead']::text[],parent.credential_slot,parent.account,parent.cluster,
              parent.system_prompt || $inquiry_objectives$

# Why this session exists

You are a fork of this project's lead, opened to answer one question a member
asked aside. Answer it from what the lead already holds, and stop.

This is a question asked aside: nothing you say here reaches the lead's record, and no tool you hold writes.$inquiry_objectives$);
       SELECT * INTO answered FROM enqueue_session_turn(
         in_tenant,in_project,in_session,in_turn,'Inquiry',in_question,in_route);
       RETURN QUERY SELECT 'Opened'::text,answered.ordinal,in_session;
     END $_$`,
    `ALTER FUNCTION ${inquiryOpen} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${inquiryOpen} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${inquiryOpen} TO ${apiRole}`,
    `CREATE FUNCTION ${waitingRoute} RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT t.route FROM session_turn t
        WHERE t.tenant=in_tenant AND t.project=in_project
          AND t.session=in_session AND t.state='Queued'
        ORDER BY t.ordinal LIMIT 1
     $$`,
    `ALTER FUNCTION ${waitingRoute} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${waitingRoute} FROM PUBLIC`,
    `CREATE OR REPLACE FUNCTION public.${sessionsAwaitingPlacementFunction}(in_epoch text, in_max bigint) RETURNS TABLE(tenant text, project text, session text, kind text, principal text, parent_session text, agent_reference text, capabilities text[], credential_slot text, account text, cluster text, state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.tenant,s.project,s.session,s.kind,s.principal,s.parent_session,
              s.agent_reference,s.capabilities,s.credential_slot,s.account,s.cluster,s.state
         FROM agent_session s
        WHERE s.state='Open'
          AND in_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
          AND ${sessionWaitingRouteFunction}(s.tenant,s.project,s.session)='InCluster'
          AND NOT EXISTS(SELECT 1 FROM session_attempt a
                      WHERE a.tenant=s.tenant AND a.project=s.project
                        AND a.session=s.session AND a.state IN ('Placing','Running'))
        ORDER BY s.tenant,s.project,s.session
        LIMIT in_max
     $$`,
    `CREATE OR REPLACE FUNCTION public.${sessionAttemptObservationFunction}(in_epoch text, in_max bigint) RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation
         FROM session_attempt a
        WHERE a.state='Running' AND a.placement IS NOT NULL AND a.pool IS NULL
          AND a.recovery_epoch=in_epoch AND in_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$`,
    `CREATE OR REPLACE FUNCTION public.${sessionAttemptCleanupFunction}(in_max bigint) RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation FROM session_attempt a
        WHERE a.state NOT IN ('Placing','Running') AND a.placement IS NOT NULL
          AND a.pool IS NULL AND a.cleanup_completed_at IS NULL
        ORDER BY a.tenant,a.project,a.session,a.attempt
        LIMIT in_max
     $$`,
    `CREATE OR REPLACE FUNCTION ${opened} RETURNS TABLE(opened text, attempt text, generation bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held record; numbered bigint;
     BEGIN
       IF in_invocation IS NULL OR jsonb_typeof(in_invocation)<>'object' THEN
         RAISE EXCEPTION 'session attempt % is opened without an invocation, and its pod fetches the one recorded here',
           in_attempt USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       IF in_epoch<>(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       SELECT s.state,s.account,s.cluster INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session FOR UPDATE;
       IF NOT FOUND OR held.state<>'Open'
          OR EXISTS(SELECT 1 FROM session_attempt a
                     WHERE a.tenant=in_tenant AND project=in_project AND session=in_session AND a.state IN ('Placing','Running'))
          OR ${sessionWaitingRouteFunction}(in_tenant,in_project,in_session) IS DISTINCT FROM 'InCluster' THEN
         RETURN QUERY SELECT 'NotLaunchable'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF EXISTS(SELECT 1 FROM session_attempt a
                  WHERE a.tenant=in_tenant AND project=in_project AND session=in_session
                    AND a.ended_at > now() - make_interval(
                          secs => in_backoff_secs::double precision)) THEN
         RETURN QUERY SELECT 'BackingOff'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.account=held.account AND a.state IN ('Placing','Running')
              AND a.pool IS NULL)>=in_account_max THEN
         RETURN QUERY SELECT 'AccountAtMaximum'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       IF (SELECT count(*) FROM session_attempt a
             JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                                 AND s.session=a.session
            WHERE s.cluster=held.cluster AND a.state IN ('Placing','Running')
              AND a.pool IS NULL)>=in_cluster_max THEN
         RETURN QUERY SELECT 'ClusterFull'::text,NULL::text,NULL::bigint; RETURN;
       END IF;
       UPDATE agent_session s SET attempt_next=s.attempt_next+1
        WHERE s.tenant=in_tenant AND project=in_project AND session=in_session RETURNING s.attempt_next-1 INTO numbered;
       INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,generation,recovery_epoch,
          state,lease_owner,lease_expires_at,bearer,bearer_secret_digest,invocation)
       VALUES(in_tenant,in_project,in_session,in_attempt,numbered,1,in_epoch,'Placing',
              in_attempt,now()+make_interval(secs => in_lease_secs::double precision),
              in_bearer,in_secret_digest,in_invocation);
       RETURN QUERY SELECT 'Opened'::text,in_attempt,1::bigint;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.${sessionTurnClaimFunction}(in_secret_digest text, in_generation bigint) RETURNS TABLE(turn text, ordinal bigint, input_kind text, input text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; standing record; picked record;
     BEGIN
       SELECT * INTO bound FROM session_attempt_binding(
         in_secret_digest,in_generation);
       IF NOT FOUND THEN RETURN; END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input,t.attempt INTO standing
         FROM session_turn t WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.state='Claimed' FOR UPDATE;
       IF FOUND THEN
         IF standing.attempt=bound.attempt THEN
           RETURN QUERY SELECT standing.turn,standing.ordinal,
                               standing.input_kind,standing.input;
         END IF;
         RETURN;
       END IF;
       SELECT t.turn,t.ordinal,t.input_kind,t.input,t.route INTO picked FROM session_turn t
        WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.state='Queued'
        ORDER BY t.ordinal LIMIT 1 FOR UPDATE;
       IF NOT FOUND THEN RETURN; END IF;
       IF picked.route IS DISTINCT FROM (
            SELECT CASE WHEN a.pool IS NULL THEN 'InCluster' ELSE 'Pool' END
              FROM session_attempt a
             WHERE a.tenant=bound.tenant AND a.project=bound.project
               AND a.session=bound.session AND a.attempt=bound.attempt) THEN
         RETURN;
       END IF;
       UPDATE session_turn t
          SET state='Claimed',attempt=bound.attempt,claim_generation=in_generation,
              claimed_at=now()
        WHERE t.tenant=bound.tenant AND project=bound.project AND session=bound.session AND t.turn=picked.turn;
       UPDATE session_attempt a SET idle_since=NULL WHERE a.attempt=bound.attempt;
       RETURN QUERY SELECT picked.turn,picked.ordinal,picked.input_kind,picked.input;
     END $$`,
  ],
};
