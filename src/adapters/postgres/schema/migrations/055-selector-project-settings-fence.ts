import {
  apiRole,
  boundaryOwnerRole,
  selectorControlRole,
  selectorProjectSettingsFunction,
  type Migration,
} from "../shared.ts";

const selectorProjectSettingsArguments =
  "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

const selectorProjectSettingsColumns = `
  revision bigint,north_star text,mode text,dispatch_mode text,base_prompt text,
  model_allowlist text,tool_allowlist text,tokens_per_decision bigint,
  milliseconds_per_decision bigint,tool_calls_per_decision bigint,
  input_bytes_per_decision bigint,candidate_pages_per_decision bigint,
  operational_context_max_age_ms bigint,installation_revision bigint,
  installation_mode text,installation_dispatch_mode text,
  installation_base_prompt text,installation_controls text`;

const selectorProjectSettingsProjection = `
  SELECT settings.revision,settings.north_star,settings.mode,settings.dispatch_mode,
         settings.base_prompt,settings.model_allowlist,settings.tool_allowlist,
         settings.tokens_per_decision,settings.milliseconds_per_decision,
         settings.tool_calls_per_decision,settings.input_bytes_per_decision,
         settings.candidate_pages_per_decision,
         settings.operational_context_max_age_ms,installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1`;

/**
 * The fence is answered before any row is offered, so a caller at a revision
 * the project has left is told that and nothing else. Revision zero is the
 * project that has no row, and it is checked by locking the row rather than by
 * letting an INSERT arbitrate: a `BEFORE INSERT` trigger runs ahead of `ON
 * CONFLICT`, so the readiness refusal would answer for a write the conflict was
 * going to reject anyway — and would answer differently depending on whether a
 * policy host happened to be ready.
 */
const selectorProjectSettingsFence = [
  `CREATE OR REPLACE FUNCTION ${selectorProjectSettingsFunction}(
     in_tenant text,in_project text,expected_revision bigint,
     new_north_star text,new_mode text,new_dispatch_mode text,new_base_prompt text,
     new_model_allowlist text,new_tool_allowlist text,
     new_tokens_per_decision bigint,new_milliseconds_per_decision bigint,
     new_tool_calls_per_decision bigint,new_input_bytes_per_decision bigint,
     new_candidate_pages_per_decision bigint,new_operational_context_max_age_ms bigint,
     in_administrator_kind text,in_administrator_subject text)
     RETURNS TABLE(${selectorProjectSettingsColumns})
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE written bigint; standing bigint;
     BEGIN
       SELECT settings.revision INTO standing FROM selector_project_settings settings
         WHERE settings.tenant=in_tenant AND settings.project=in_project FOR UPDATE;
       IF coalesce(standing,0)<>expected_revision THEN RETURN; END IF;
       IF expected_revision=0 THEN
         INSERT INTO selector_project_settings
           (tenant,project,revision,north_star,mode,dispatch_mode,base_prompt,
            model_allowlist,tool_allowlist,tokens_per_decision,
            milliseconds_per_decision,tool_calls_per_decision,
            input_bytes_per_decision,candidate_pages_per_decision,
            operational_context_max_age_ms)
           VALUES (in_tenant,in_project,1,new_north_star,new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_operational_context_max_age_ms)
           ON CONFLICT (tenant,project) DO NOTHING
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,mode=new_mode,dispatch_mode=new_dispatch_mode,
           base_prompt=new_base_prompt,model_allowlist=new_model_allowlist,
           tool_allowlist=new_tool_allowlist,tokens_per_decision=new_tokens_per_decision,
           milliseconds_per_decision=new_milliseconds_per_decision,
           tool_calls_per_decision=new_tool_calls_per_decision,
           input_bytes_per_decision=new_input_bytes_per_decision,
           candidate_pages_per_decision=new_candidate_pages_per_decision,
           operational_context_max_age_ms=new_operational_context_max_age_ms,
           updated_at=now()
         WHERE tenant=in_tenant AND project=in_project
           AND selector_project_settings.revision=expected_revision
         RETURNING selector_project_settings.revision INTO written;
       END IF;
       IF written IS NULL THEN RETURN; END IF;
       INSERT INTO selector_project_settings_history
         (tenant,project,revision,north_star,mode,dispatch_mode,base_prompt,
          model_allowlist,tool_allowlist,tokens_per_decision,
          milliseconds_per_decision,tool_calls_per_decision,
          input_bytes_per_decision,candidate_pages_per_decision,
          operational_context_max_age_ms,administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.input_bytes_per_decision,settings.candidate_pages_per_decision,
           settings.operational_context_max_age_ms,in_administrator_kind,
           in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY ${selectorProjectSettingsProjection};
     END $$`,
  `ALTER FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments})
     TO ${apiRole},${selectorControlRole}`,
];

export const migration055: Migration = {
  version: 55,
  name: "selector project settings answer their fence first",
  statements: [...selectorProjectSettingsFence],
};
