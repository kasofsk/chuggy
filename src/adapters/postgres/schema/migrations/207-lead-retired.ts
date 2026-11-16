/**
 * The lead, its inquiries and the subsidy are closed and dropped, and a
 * project's placement and settings keep their thread columns alone.
 *
 * EVERY OPEN LEAD AND INQUIRY IS CLOSED through `close_agent_session`, which
 * abandons its queued and claimed turns and appends the `Session` change its
 * close appends for a thread. Its rows, turns and batches stay. A live attempt
 * on one is ended by the reapers, as a closed thread's is.
 *
 * THE LEAD'S DOORS ARE DROPPED, with its runner standing and the system prompt
 * door only its mailbox called; so are the inquiry doors, the two triggers
 * that closed an inquiry with its turn and refused it a store batch, and their
 * bodies.
 *
 * THE SUBSIDY IS DROPPED: `subsidized_lead`, and the reads of a lead's
 * offering, profile and spend over it.
 *
 * THE POOL'S LEAD CLAIM IS DROPPED, `pool_sessions_awaiting_claim` and
 * `open_pool_session_attempt` at 167's signatures. The pool's hold doors stay.
 *
 * `set_project_session_placement` KEEPS 145's SIGNATURE AND WRITES THE THREAD
 * ROUTE ALONE, ignoring the lead route and offering it is still given, and is
 * `Unchanged` where the thread route is. `session_route` keeps 094's signature
 * and routes a thread alone, raising for any other kind. Both keep their owner
 * and grants. Then `project_session_placement.lead_route` and `lead_offering`
 * and `session_routing.lead_route` are dropped, with their checks.
 *
 * `update_selector_project_settings` IS DROPPED, and
 * `update_selector_project_thread_settings` keeps 200's signature, writing and
 * recording the thread columns alone. Then every override column of
 * `selector_project_settings` and its history but the four thread settings is
 * dropped, with its checks.
 */

import type { Migration } from "../shared.ts";

/** Every function dropped, each by its signature now. */
const droppedFunctions = [
  "open_project_lead(text,text,text,text,text,text,bigint,text,text,boolean)",
  "lead_session(text,text)",
  "close_project_lead(text,text,text)",
  "enqueue_lead_turn(text,text,text,text,text)",
  "read_lead_turn(text)",
  "withdraw_lead_turn(text)",
  "set_session_system_prompt(text,text,text)",
  "lead_runner_standing(text,text,bigint)",
  "open_lead_inquiry(text,text,text,text,text,text,text,boolean)",
  "read_lead_inquiries(text,text,bigint)",
  "read_lead_inquiry(text,text,text)",
  "read_subsidized_lead()",
  "session_lead_profile(text,text)",
  "subsidized_lead_spend(text,text)",
  "session_lead_offering(text,text)",
  "stored_lead_offering(text,text)",
  "pool_sessions_awaiting_claim(text,text,text,text,bigint,bigint)",
  "open_pool_session_attempt(text,text,text,text,text,text[],text,text,text,text,text,bigint,bigint,bigint,jsonb,text,jsonb)",
  "update_selector_project_settings(text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,text,text,text,text)",
] as const;

/** The settings columns dropped from the row and its history alike. */
export const selectorSettingsColumnsRetiredAt207 = [
  "mode",
  "dispatch_mode",
  "base_prompt",
  "model_allowlist",
  "tool_allowlist",
  "tokens_per_decision",
  "milliseconds_per_decision",
  "tool_calls_per_decision",
  "dispatches_per_decision",
  "input_bytes_per_decision",
  "candidate_pages_per_decision",
  "operational_context_max_age_ms",
  "auto_compact_window",
  "lead_model",
  "lead_effort",
] as const;

const placementWrite = `CREATE OR REPLACE FUNCTION public.set_project_session_placement(in_tenant text, in_project text, in_thread text, in_lead text, in_lead_offering text, in_authority_kind text, in_authority_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE standing text;
     BEGIN
       PERFORM 1 FROM project p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF NOT FOUND THEN RETURN 'NotFound'; END IF;
       SELECT x.thread_route INTO standing FROM project_session_placement x
        WHERE x.tenant=in_tenant AND x.project=in_project FOR UPDATE;
       IF FOUND AND standing=in_thread THEN RETURN 'Unchanged'; END IF;
       INSERT INTO project_session_placement
         (tenant,project,thread_route,set_by_kind,set_by_subject,set_at)
         VALUES (in_tenant,in_project,in_thread,
                 in_authority_kind,in_authority_subject,now())
         ON CONFLICT (tenant,project) DO UPDATE
           SET thread_route=EXCLUDED.thread_route,
               set_by_kind=EXCLUDED.set_by_kind,
               set_by_subject=EXCLUDED.set_by_subject,
               set_at=EXCLUDED.set_at;
       RETURN 'Written';
     END $$`;

const route = `CREATE OR REPLACE FUNCTION public.session_route(in_tenant text, in_project text, in_kind text) RETURNS TABLE(route text, source text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE overridden text; published text; placed text;
     BEGIN
       IF in_kind IS DISTINCT FROM 'Thread' THEN
         RAISE EXCEPTION 'session kind % has no route', in_kind
           USING ERRCODE = 'invalid_parameter_value';
       END IF;
       IF left(in_project,1)='@' THEN
         RETURN QUERY SELECT 'Pool'::text,'Default'::text; RETURN;
       END IF;
       SELECT r.project_routes #>> ARRAY[in_tenant,in_project,'Thread'],
              r.thread_route
         INTO overridden,published FROM session_routing r;
       IF overridden IS NOT NULL THEN
         RETURN QUERY SELECT overridden,'Override'::text; RETURN;
       END IF;
       SELECT p.thread_route INTO placed FROM project_session_placement p
        WHERE p.tenant=in_tenant AND p.project=in_project;
       IF placed IS NOT NULL THEN
         RETURN QUERY SELECT placed,'Project'::text; RETURN;
       END IF;
       RETURN QUERY SELECT coalesce(published,'InCluster'),'Default'::text;
     END $$`;

const threadSettingsWrite = `CREATE OR REPLACE FUNCTION public.update_selector_project_thread_settings(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_thread_model text, new_thread_effort text, in_administrator_kind text, in_administrator_subject text) RETURNS TABLE(revision bigint, north_star text, thread_standing_rules text, thread_model text, thread_effort text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE written bigint; standing bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'selector-settings:'||length(in_tenant)||':'||in_tenant||in_project,0));
       SELECT settings.revision INTO standing FROM selector_project_settings settings
         WHERE settings.tenant=in_tenant AND settings.project=in_project;
       IF coalesce(standing,0)<>expected_revision THEN RETURN; END IF;
       IF expected_revision=0 THEN
         INSERT INTO selector_project_settings
           (tenant,project,revision,north_star,thread_standing_rules,
            thread_model,thread_effort)
           VALUES (in_tenant,in_project,1,new_north_star,new_thread_standing_rules,
            new_thread_model,new_thread_effort)
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,thread_standing_rules=new_thread_standing_rules,
           thread_model=new_thread_model,thread_effort=new_thread_effort,
           updated_at=now()
         WHERE tenant=in_tenant AND project=in_project
           AND selector_project_settings.revision=expected_revision
         RETURNING selector_project_settings.revision INTO written;
       END IF;
       IF written IS NULL THEN RETURN; END IF;
       INSERT INTO selector_project_settings_history
         (tenant,project,revision,north_star,thread_standing_rules,
          thread_model,thread_effort,administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.thread_standing_rules,settings.thread_model,settings.thread_effort,
           in_administrator_kind,in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY
  SELECT settings.revision,settings.north_star,settings.thread_standing_rules,
         settings.thread_model,settings.thread_effort
    FROM selector_project_settings settings
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written;
     END $$`;

export const migration207: Migration = {
  version: 207,
  name: "the lead, its inquiries and the subsidy are closed and dropped",
  statements: [
    `SELECT close_agent_session(s.tenant,s.project,s.session)
       FROM agent_session s
      WHERE s.kind IN ('Lead','Inquiry') AND s.state='Open'`,
    `DROP TRIGGER inquiry_closes_when_its_turn_ends ON public.session_turn`,
    `DROP TRIGGER session_store_batch_is_never_an_inquiry_s ON public.session_store_batch`,
    `DROP FUNCTION public.inquiry_closes_with_its_turn()`,
    `DROP FUNCTION public.inquiry_writes_no_store_batch()`,
    ...droppedFunctions.map((signature) => `DROP FUNCTION public.${signature}`),
    `DROP TABLE public.subsidized_lead`,
    placementWrite,
    route,
    `ALTER TABLE public.project_session_placement
       DROP CONSTRAINT project_session_placement_subsidized_lead_is_in_cluster,
       DROP CONSTRAINT project_session_placement_lead_offering_is_known,
       DROP CONSTRAINT project_session_placement_lead_is_known,
       DROP COLUMN lead_offering,
       DROP COLUMN lead_route`,
    `ALTER TABLE public.session_routing
       DROP CONSTRAINT session_routing_lead_is_known,
       DROP COLUMN lead_route`,
    threadSettingsWrite,
    ...["selector_project_settings", "selector_project_settings_history"].map(
      (table) =>
        `ALTER TABLE public.${table}\n       ${selectorSettingsColumnsRetiredAt207
          .map((column) => `DROP COLUMN ${column}`)
          .join(",\n       ")}`,
    ),
  ],
};
