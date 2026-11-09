/**
 * A project chooses the model and the effort its lead and its threads run on,
 * and a session holds the pair it was opened under.
 *
 * `selector_project_settings` and its history gain `lead_model`,
 * `lead_effort`, `thread_model` and `thread_effort`, NULL where the project
 * takes the site's session model or the runtime's own effort. A model is held
 * to the door's rule — bounded as a run's reported model is, no whitespace or
 * control character, no leading `-` — and an effort to the agent SDK's roster.
 * `update_selector_project_settings` IS DROPPED AND RECREATED, because its
 * arguments and its result each gain the columns; the body is 113's with them
 * added.
 *
 * `agent_session` gains `model` and `effort` under the same rule, NULL where
 * none was chosen; every row already there keeps NULL, which is what an unset
 * override resolves to. `open_project_lead` and `open_member_thread` write
 * them beside the system prompt, `lead_session` answers them to the selector,
 * and `read_session_attempt` to the session plane. An inquiry holds none of
 * its own: it runs on its lead's, so `read_session_attempt` answers an
 * inquiry its parent's, as it answers the parent's reference as `fork_from`.
 * Each function is dropped and recreated with the grants it had, its body the
 * one 113 or 120 gave it with the columns added.
 *
 * The bound, the characters and the roster are written as literals, so this
 * file goes on saying what it installed when the contract's rules move.
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
  threadOpenFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/**
 * What a model name may not hold, as a bracket body: every control character,
 * and every character JavaScript's `\s` names.
 */
const modelRefused =
  "\\u0001-\\u0020\\u007f-\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/** Whether `column` is NULL or a model name the door would take. */
function modelChecked(column: string): string {
  return `${column} IS NULL
          OR (char_length(${column}) BETWEEN 1 AND 128
              AND ${column} ~ '^[^-${modelRefused}][^${modelRefused}]*$')`;
}

/** Whether `column` is NULL or an effort the agent SDK names. */
function effortChecked(column: string): string {
  return `${column} IS NULL
          OR ${column} IN ('low', 'medium', 'high', 'xhigh', 'max')`;
}

const settingsWithout = `public.${selectorProjectSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_auto_compact_window bigint, new_operational_context_max_age_ms bigint, in_administrator_kind text, in_administrator_subject text)`;

const settingsWith = `public.${selectorProjectSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_auto_compact_window bigint, new_operational_context_max_age_ms bigint, new_lead_model text, new_lead_effort text, new_thread_model text, new_thread_effort text, in_administrator_kind text, in_administrator_subject text)`;

const leadOpenWithout = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text, in_auto_compact_window bigint)`;

const leadOpenWith = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text, in_auto_compact_window bigint, in_model text, in_effort text)`;

const threadOpenWithout = `public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_key text, in_credential_slot text, in_system_prompt text)`;

const threadOpenWith = `public.${threadOpenFunction}(in_tenant text, in_project text, in_principal text, in_session text, in_key text, in_credential_slot text, in_system_prompt text, in_model text, in_effort text)`;

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

const settingsColumns = [
  `ALTER TABLE public.selector_project_settings
     ADD COLUMN lead_model text
       CONSTRAINT selector_project_lead_model_is_a_model
       CHECK (${modelChecked("lead_model")}),
     ADD COLUMN lead_effort text
       CONSTRAINT selector_project_lead_effort_is_known
       CHECK (${effortChecked("lead_effort")}),
     ADD COLUMN thread_model text
       CONSTRAINT selector_project_thread_model_is_a_model
       CHECK (${modelChecked("thread_model")}),
     ADD COLUMN thread_effort text
       CONSTRAINT selector_project_thread_effort_is_known
       CHECK (${effortChecked("thread_effort")})`,
  `ALTER TABLE public.selector_project_settings_history
     ADD COLUMN lead_model text,
     ADD COLUMN lead_effort text,
     ADD COLUMN thread_model text,
     ADD COLUMN thread_effort text`,
  `ALTER TABLE public.agent_session
     ADD COLUMN model text
       CONSTRAINT agent_session_model_is_a_model
       CHECK (${modelChecked("model")}),
     ADD COLUMN effort text
       CONSTRAINT agent_session_effort_is_known
       CHECK (${effortChecked("effort")})`,
];

const settingsWrite = `CREATE FUNCTION ${settingsWith} RETURNS TABLE(revision bigint, north_star text, thread_standing_rules text, mode text, dispatch_mode text, base_prompt text, model_allowlist text, tool_allowlist text, tokens_per_decision bigint, milliseconds_per_decision bigint, tool_calls_per_decision bigint, dispatches_per_decision bigint, input_bytes_per_decision bigint, candidate_pages_per_decision bigint, auto_compact_window bigint, operational_context_max_age_ms bigint, lead_model text, lead_effort text, thread_model text, thread_effort text, installation_revision bigint, installation_mode text, installation_dispatch_mode text, installation_base_prompt text, installation_controls text)
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
            operational_context_max_age_ms,
            lead_model,lead_effort,thread_model,thread_effort)
           VALUES (in_tenant,in_project,1,new_north_star,new_thread_standing_rules,
            new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_dispatches_per_decision,
            new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_auto_compact_window,
            new_operational_context_max_age_ms,
            new_lead_model,new_lead_effort,new_thread_model,new_thread_effort)
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
           lead_model=new_lead_model,lead_effort=new_lead_effort,
           thread_model=new_thread_model,thread_effort=new_thread_effort,
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
          lead_model,lead_effort,thread_model,thread_effort,
          administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.thread_standing_rules,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.dispatches_per_decision,settings.input_bytes_per_decision,
           settings.candidate_pages_per_decision,settings.auto_compact_window,
           settings.operational_context_max_age_ms,
           settings.lead_model,settings.lead_effort,
           settings.thread_model,settings.thread_effort,
           in_administrator_kind,in_administrator_subject
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
         settings.operational_context_max_age_ms,
         settings.lead_model,settings.lead_effort,
         settings.thread_model,settings.thread_effort,
         installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1;
     END $$`;

const leadOpen = `CREATE FUNCTION ${leadOpenWith} RETURNS TABLE(opened text, session text)
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
            account,cluster,system_prompt,auto_compact_window,model,effort)
         VALUES(in_tenant,in_project,in_session,'Lead',in_principal,
                ARRAY['RepositoryRead', 'ProjectRead', 'DraftAuthor', 'LeadDecision']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                in_auto_compact_window,in_model,in_effort);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Lead' AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`;

const threadOpen = `CREATE FUNCTION ${threadOpenWith} RETURNS TABLE(opened text, session text, threads_max bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; allowed bigint; drawn record;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'member-thread-open:' || in_tenant || '/' || in_project || '/' || in_principal, 0));
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.open_key=in_key;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held,NULL::bigint; RETURN;
       END IF;
       allowed := member_thread_limit(in_tenant,in_project,in_principal);
       IF (SELECT count(*) FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open')>=allowed THEN
         RETURN QUERY SELECT 'ThreadLimitReached'::text,NULL::text,allowed; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster,system_prompt,opened_after_sequence,open_key,
          model,effort)
       VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
              ARRAY['RepositoryRead'::text, 'RunCommands'::text, 'ProjectRead'::text, 'DraftAuthor'::text, 'DraftOriginate'::text, 'TicketDispatch'::text, 'ThreadOffer'::text],
              in_credential_slot,
              drawn.account,drawn.cluster,in_system_prompt,
              coalesce((SELECT max(head.sequence) FROM project_change head),0),
              in_key,in_model,in_effort);
       RETURN QUERY SELECT 'Opened'::text,in_session,NULL::bigint;
     END $$`;

const leadRead = `CREATE FUNCTION ${lead} RETURNS TABLE(session text, state text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, tokens bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference,s.system_prompt,
              s.auto_compact_window,s.model,s.effort,
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
     $$`;

const attemptRead = `CREATE FUNCTION ${attempt} RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, fork_from text, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,s.system_prompt,
              s.auto_compact_window,
              CASE WHEN s.kind='Inquiry' THEN p.model ELSE s.model END,
              CASE WHEN s.kind='Inquiry' THEN p.effort ELSE s.effort END,
              p.agent_reference,
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
         LEFT JOIN agent_session p ON p.tenant=s.tenant AND p.project=s.project
                                  AND p.session=s.parent_session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`;

export const migration133: Migration = {
  version: 133,
  name: "a project chooses the model and effort its lead and threads run on",
  statements: [
    ...settingsColumns,
    `DROP FUNCTION ${settingsWithout}`,
    settingsWrite,
    ...owned(settingsWith, [apiRole, selectorControlRole]),
    `DROP FUNCTION ${leadOpenWithout}`,
    leadOpen,
    ...owned(leadOpenWith, [selectorServiceRole]),
    `DROP FUNCTION ${threadOpenWithout}`,
    threadOpen,
    ...owned(threadOpenWith, [apiRole]),
    `DROP FUNCTION ${lead}`,
    leadRead,
    ...owned(lead, [selectorServiceRole]),
    `DROP FUNCTION ${attempt}`,
    attemptRead,
    ...owned(attempt, [workerPlaneRole]),
  ],
};
