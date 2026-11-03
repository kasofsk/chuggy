/**
 * A project may set the context its lead's runtime compacts at, and the lead
 * holds the window it was opened under.
 *
 * `selector_project_settings` and its history gain `auto_compact_window`, NULL
 * where the project takes the installation's, bounded where it is a value as
 * the runtime's own setting is. `update_selector_project_settings` IS DROPPED
 * AND RECREATED, because its arguments and its result each gain the column; the
 * body is the baseline's with the column added, written out so this file goes
 * on saying what it installed.
 *
 * `agent_session` gains `auto_compact_window`, which only a `Lead` may hold.
 * `open_project_lead` writes it beside the system prompt, `lead_session`
 * answers it to the selector, and `read_session_attempt` to the session plane,
 * which hands it to the pod. Each is dropped and recreated for the same reason,
 * the bodies the baseline's and 042's with the column added. A lead opened
 * before this holds none, which the selector reads as a window other than any
 * it resolves, so that lead is replaced at its next decision.
 */

import {
  apiRole,
  boundaryOwnerRole,
  leadOpenFunction,
  leadSessionFunction,
  selectorControlRole,
  selectorProjectSettingsFunction,
  selectorServiceRole,
  sessionAttemptReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const settingsWithout = `public.${selectorProjectSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text)`;

const settingsWith = `public.${selectorProjectSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_auto_compact_window bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text)`;

const openedWithout = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text)`;

const openedWith = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text, in_auto_compact_window bigint)`;

const lead = `public.${leadSessionFunction}(in_tenant text, in_project text)`;

const attempt = `public.${sessionAttemptReadFunction}(in_secret_digest text)`;

/** The owner a function is installed under, callable by each of `roles` and by nobody else but its owner. */
function owned(signature: string, roles: readonly string[]): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    ...roles.map((role) => `GRANT ALL ON FUNCTION ${signature} TO ${role}`),
  ];
}

export const migration113: Migration = {
  version: 113,
  name: "a project sets the window its lead compacts at, and the lead holds it",
  statements: [
    `ALTER TABLE public.selector_project_settings
       ADD COLUMN auto_compact_window bigint
         CONSTRAINT selector_project_auto_compact_window_is_bounded
         CHECK (auto_compact_window IS NULL
                OR auto_compact_window BETWEEN 100000 AND 1000000)`,
    `ALTER TABLE public.selector_project_settings_history
       ADD COLUMN auto_compact_window bigint`,
    `ALTER TABLE public.agent_session
       ADD COLUMN auto_compact_window bigint
         CONSTRAINT agent_session_auto_compact_window_is_a_leads
         CHECK (auto_compact_window IS NULL
                OR (kind='Lead'
                    AND auto_compact_window BETWEEN 100000 AND 1000000))`,
    `DROP FUNCTION ${settingsWithout}`,
    `CREATE FUNCTION ${settingsWith} RETURNS TABLE(revision bigint, north_star text, thread_standing_rules text, mode text, dispatch_mode text, base_prompt text, model_allowlist text, tool_allowlist text, tokens_per_decision bigint, milliseconds_per_decision bigint, tool_calls_per_decision bigint, dispatches_per_decision bigint, input_bytes_per_decision bigint, candidate_pages_per_decision bigint, auto_compact_window bigint, operational_context_max_age_ms bigint, installation_revision bigint, installation_mode text, installation_dispatch_mode text, installation_base_prompt text, installation_controls text)
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
           (tenant,project,revision,north_star,thread_standing_rules,mode,dispatch_mode,
            base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
            milliseconds_per_decision,tool_calls_per_decision,
            dispatches_per_decision,input_bytes_per_decision,
            candidate_pages_per_decision,auto_compact_window,
            operational_context_max_age_ms)
           VALUES (in_tenant,in_project,1,new_north_star,new_thread_standing_rules,
            new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_dispatches_per_decision,
            new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_auto_compact_window,
            new_operational_context_max_age_ms)
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,thread_standing_rules=new_thread_standing_rules,
           mode=new_mode,dispatch_mode=new_dispatch_mode,
           base_prompt=new_base_prompt,model_allowlist=new_model_allowlist,
           tool_allowlist=new_tool_allowlist,tokens_per_decision=new_tokens_per_decision,
           milliseconds_per_decision=new_milliseconds_per_decision,
           tool_calls_per_decision=new_tool_calls_per_decision,
           dispatches_per_decision=new_dispatches_per_decision,
           input_bytes_per_decision=new_input_bytes_per_decision,
           candidate_pages_per_decision=new_candidate_pages_per_decision,
           auto_compact_window=new_auto_compact_window,
           operational_context_max_age_ms=new_operational_context_max_age_ms,
           updated_at=now()
         WHERE tenant=in_tenant AND project=in_project
           AND selector_project_settings.revision=expected_revision
         RETURNING selector_project_settings.revision INTO written;
       END IF;
       IF written IS NULL THEN RETURN; END IF;
       INSERT INTO selector_project_settings_history
         (tenant,project,revision,north_star,thread_standing_rules,mode,dispatch_mode,
          base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
          milliseconds_per_decision,tool_calls_per_decision,
          dispatches_per_decision,input_bytes_per_decision,
          candidate_pages_per_decision,auto_compact_window,
          operational_context_max_age_ms,
          administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.thread_standing_rules,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.dispatches_per_decision,settings.input_bytes_per_decision,
           settings.candidate_pages_per_decision,settings.auto_compact_window,
           settings.operational_context_max_age_ms,in_administrator_kind,
           in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY
  SELECT settings.revision,settings.north_star,settings.thread_standing_rules,
         settings.mode,settings.dispatch_mode,
         settings.base_prompt,settings.model_allowlist,settings.tool_allowlist,
         settings.tokens_per_decision,settings.milliseconds_per_decision,
         settings.tool_calls_per_decision,settings.dispatches_per_decision,
         settings.input_bytes_per_decision,
         settings.candidate_pages_per_decision,settings.auto_compact_window,
         settings.operational_context_max_age_ms,installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1;
     END $$`,
    ...owned(settingsWith, [apiRole, selectorControlRole]),
    `DROP FUNCTION ${openedWithout}`,
    `CREATE FUNCTION ${openedWith} RETURNS TABLE(opened text, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Lead' AND s.state='Open'
        FOR UPDATE;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       BEGIN
         INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt,auto_compact_window)
         VALUES(in_tenant,in_project,in_session,'Lead',in_principal,
                ARRAY['RepositoryRead', 'ProjectRead', 'DraftAuthor', 'LeadDecision']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                in_auto_compact_window);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Lead' AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`,
    ...owned(openedWith, [selectorServiceRole]),
    `DROP FUNCTION ${lead}`,
    `CREATE FUNCTION ${lead} RETURNS TABLE(session text, state text, agent_reference text, system_prompt text, auto_compact_window bigint, tokens bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference,s.system_prompt,
              s.auto_compact_window,
              (SELECT t.tokens FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session AND t.state='Answered'
                  AND t.input_kind='Observation'
                ORDER BY t.ordinal DESC LIMIT 1)
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
     $$`,
    ...owned(lead, [selectorServiceRole]),
    `DROP FUNCTION ${attempt}`,
    `CREATE FUNCTION ${attempt} RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, auto_compact_window bigint, fork_from text, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,s.system_prompt,
              s.auto_compact_window,
              (SELECT p.agent_reference FROM agent_session p
                WHERE p.tenant=s.tenant AND p.project=s.project
                  AND p.session=s.parent_session),
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`,
    ...owned(attempt, [workerPlaneRole]),
  ],
};
