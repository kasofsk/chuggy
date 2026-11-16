import {
  apiRole,
  boundaryOwnerRole,
  selectorProjectThreadSettingsFunction,
  type Migration,
} from "../shared.ts";

/**
 * A project's settings are written as its four thread settings alone.
 *
 * `update_selector_project_thread_settings` is
 * `update_selector_project_settings` as 133 left it, under the same revision
 * fence, lock and history row, with every other override column written NULL
 * and only the revision and the four thread columns answered. Its NULL
 * `dispatch_mode` is one the Automatic-readiness trigger never refuses, so the
 * door checks no readiness of its own. The old door stays installed and
 * granted.
 */

const signature = `public.${selectorProjectThreadSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_thread_model text, new_thread_effort text, in_administrator_kind text, in_administrator_subject text)`;

const threadSettingsWrite = `CREATE FUNCTION ${signature} RETURNS TABLE(revision bigint, north_star text, thread_standing_rules text, thread_model text, thread_effort text)
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
           mode=NULL,dispatch_mode=NULL,
           base_prompt=NULL,model_allowlist=NULL,
           tool_allowlist=NULL,tokens_per_decision=NULL,
           milliseconds_per_decision=NULL,
           tool_calls_per_decision=NULL,
           dispatches_per_decision=NULL,
           input_bytes_per_decision=NULL,
           candidate_pages_per_decision=NULL,
           auto_compact_window=NULL,
           operational_context_max_age_ms=NULL,
           lead_model=NULL,lead_effort=NULL,
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
         settings.thread_model,settings.thread_effort
    FROM selector_project_settings settings
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written;
     END $$`;

export const migration199: Migration = {
  version: 199,
  name: "a project's settings are written as its thread settings",
  statements: [
    threadSettingsWrite,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
