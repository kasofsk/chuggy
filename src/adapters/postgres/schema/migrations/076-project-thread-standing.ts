/**
 * The standing rules a project's threads act under, as one more column of the
 * override set 053 shaped.
 *
 * IT SITS BESIDE `north_star` AND NOT ON THE INSTALLATION ROW. The default is a
 * TypeScript constant the composition reads, so there is nothing for an
 * installation row to hold: a project either states its own rules or runs under
 * the ones the code ships. That is the shape `north_star` already has, and it
 * takes the same CHECK.
 *
 * THE WRITE CHANGES SIGNATURE, SO IT IS DROPPED AND CREATED. Dropping takes the
 * owner, the revoke and every grant with it, and all three are re-issued below.
 * Nothing else about the write moves: it still replaces the whole override set
 * under an advisory lock on the project, and clearing this override is the same
 * statement as setting it.
 */

import {
  apiRole,
  boundaryOwnerRole,
  selectorControlRole,
  selectorProjectSettingsFunction,
  type Migration,
} from "../shared.ts";

const projectThreadStanding = [
  `ALTER TABLE selector_project_settings
     ADD COLUMN thread_standing text,
     ADD CONSTRAINT selector_project_thread_standing_is_bounded CHECK (
       thread_standing IS NULL OR length(thread_standing) BETWEEN 1 AND 65536)`,
  `ALTER TABLE selector_project_settings_history ADD COLUMN thread_standing text`,
];

const projectSettingsArgumentsBefore =
  "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

const projectSettingsArguments =
  "text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

/** What a write answers with: the project's own columns beside the defaults they fall back to. */
const projectSettingsColumns = `
       revision bigint,north_star text,thread_standing text,mode text,
       dispatch_mode text,
       base_prompt text,model_allowlist text,tool_allowlist text,
       tokens_per_decision bigint,milliseconds_per_decision bigint,
       tool_calls_per_decision bigint,dispatches_per_decision bigint,
       input_bytes_per_decision bigint,
       candidate_pages_per_decision bigint,operational_context_max_age_ms bigint,
       installation_revision bigint,installation_mode text,
       installation_dispatch_mode text,installation_base_prompt text,
       installation_controls text`;

/** The written row read back at the revision this write produced, and no later one. */
const projectSettingsProjection = `
  SELECT settings.revision,settings.north_star,settings.thread_standing,
         settings.mode,settings.dispatch_mode,
         settings.base_prompt,settings.model_allowlist,settings.tool_allowlist,
         settings.tokens_per_decision,settings.milliseconds_per_decision,
         settings.tool_calls_per_decision,settings.dispatches_per_decision,
         settings.input_bytes_per_decision,
         settings.candidate_pages_per_decision,
         settings.operational_context_max_age_ms,installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1`;

const projectSettingsWriteTakesTheStanding = [
  `DROP FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArgumentsBefore})`,
  `CREATE FUNCTION ${selectorProjectSettingsFunction}(
     in_tenant text,in_project text,expected_revision bigint,
     new_north_star text,new_thread_standing text,new_mode text,
     new_dispatch_mode text,new_base_prompt text,
     new_model_allowlist text,new_tool_allowlist text,
     new_tokens_per_decision bigint,new_milliseconds_per_decision bigint,
     new_tool_calls_per_decision bigint,new_dispatches_per_decision bigint,
     new_input_bytes_per_decision bigint,
     new_candidate_pages_per_decision bigint,new_operational_context_max_age_ms bigint,
     in_administrator_kind text,in_administrator_subject text)
     RETURNS TABLE(${projectSettingsColumns})
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE written bigint; standing bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'selector-settings:'||length(in_tenant)||':'||in_tenant||in_project,0));
       SELECT settings.revision INTO standing FROM selector_project_settings settings
         WHERE settings.tenant=in_tenant AND settings.project=in_project;
       IF coalesce(standing,0)<>expected_revision THEN RETURN; END IF;
       IF expected_revision=0 THEN
         INSERT INTO selector_project_settings
           (tenant,project,revision,north_star,thread_standing,mode,dispatch_mode,
            base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
            milliseconds_per_decision,tool_calls_per_decision,
            dispatches_per_decision,input_bytes_per_decision,
            candidate_pages_per_decision,operational_context_max_age_ms)
           VALUES (in_tenant,in_project,1,new_north_star,new_thread_standing,
            new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_dispatches_per_decision,
            new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_operational_context_max_age_ms)
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,thread_standing=new_thread_standing,
           mode=new_mode,dispatch_mode=new_dispatch_mode,
           base_prompt=new_base_prompt,model_allowlist=new_model_allowlist,
           tool_allowlist=new_tool_allowlist,tokens_per_decision=new_tokens_per_decision,
           milliseconds_per_decision=new_milliseconds_per_decision,
           tool_calls_per_decision=new_tool_calls_per_decision,
           dispatches_per_decision=new_dispatches_per_decision,
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
         (tenant,project,revision,north_star,thread_standing,mode,dispatch_mode,
          base_prompt,model_allowlist,tool_allowlist,tokens_per_decision,
          milliseconds_per_decision,tool_calls_per_decision,
          dispatches_per_decision,input_bytes_per_decision,
          candidate_pages_per_decision,operational_context_max_age_ms,
          administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.thread_standing,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.dispatches_per_decision,settings.input_bytes_per_decision,
           settings.candidate_pages_per_decision,
           settings.operational_context_max_age_ms,in_administrator_kind,
           in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY ${projectSettingsProjection};
     END $$`,
  `ALTER FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments})
     TO ${apiRole},${selectorControlRole}`,
];

/** A project states the standing rules its threads act under. */
export const migration076: Migration = {
  version: 76,
  name: "a project's threads act under its own standing rules",
  statements: [
    ...projectThreadStanding,
    ...projectSettingsWriteTakesTheStanding,
  ],
};
