import {
  allProjectAccessKinds,
  type ProjectAccessKind,
} from "../../../../interpreter/nativeWeb.ts";
import {
  apiRole,
  boundaryOwnerRole,
  projectAccessColumns,
  projectAuthorizationFunction,
  schemaTextSet,
  selectorAutomaticReadinessErrorCode,
  selectorControlRole,
  selectorProjectSettingsFunction,
  type Migration,
} from "../shared.ts";

const selectorProjectSettingsArguments =
  "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

/**
 * What a project's settings resolve from, as one row: its own columns beside
 * the installation defaults they fall back to. The write returns it so a caller
 * reports the row it wrote rather than whatever a later read happens to find.
 */
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
 * A write that answers with the row it wrote. Reading the row back in a second
 * statement let a racing administrator's settings be reported as this one's
 * result, which is the same fence this function exists to hold, lost on the way
 * out; the `revision=written` predicate makes the answer provably that write's.
 */
const selectorProjectSettingsWrite = [
  `DROP FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments})`,
  `CREATE FUNCTION ${selectorProjectSettingsFunction}(
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
     DECLARE written bigint;
     BEGIN
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

/**
 * The readiness refusal carries a SQLSTATE of its own, because it is a normal
 * condition an administrator can fix rather than a fault: a caller that has to
 * recognise it by the text of a message recognises it wrongly the first time
 * the message is reworded.
 */
const selectorAutomaticReadinessRefusal = [
  `CREATE OR REPLACE FUNCTION enforce_selector_automatic_readiness() RETURNS trigger
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF NEW.dispatch_mode='Automatic' AND NOT EXISTS (
         SELECT 1 FROM selector_runtime_readiness
           WHERE singleton=1 AND production_host) THEN
         RAISE EXCEPTION 'automatic selector requires a production capability host'
           USING ERRCODE='${selectorAutomaticReadinessErrorCode}';
       END IF;
       RETURN NEW;
     END $$`,
  `ALTER FUNCTION enforce_selector_automatic_readiness() OWNER TO ${boundaryOwnerRole}`,
];

/**
 * `ManageProjectSelector` is the project-scoped kind, named apart from the
 * installation-wide `ManageSelector` capability because a project administrator
 * moves their own project's settings and never the defaults every other project
 * inherits. Both the accepted kinds and the column each is granted by are
 * rendered from `projectAccessColumns`, so a kind added to the roster without a
 * column beside it is a compile error rather than a runtime refusal.
 */
const projectAccessKindRename = [
  `ALTER TABLE project_membership
     RENAME COLUMN may_manage_selector TO ${projectAccessColumns.ManageProjectSelector}`,
  `CREATE OR REPLACE FUNCTION ${projectAuthorizationFunction}(
     in_principal text,in_tenant text,in_project text,in_access text)
     RETURNS TABLE (authority_kind text,authority_subject text)
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF in_access NOT IN (${schemaTextSet([...allProjectAccessKinds])}) THEN
         RAISE EXCEPTION 'unknown project access kind';
       END IF;
       RETURN QUERY
         SELECT membership.authority_kind,membership.authority_subject
           FROM project_membership membership
          WHERE membership.principal=in_principal
            AND membership.tenant=in_tenant AND membership.project=in_project
            AND CASE in_access
              ${allProjectAccessKinds
                .map(
                  (kind: ProjectAccessKind) =>
                    `WHEN '${kind}' THEN membership.${projectAccessColumns[kind]}`,
                )
                .join("\n              ")}
            END;
     END $$`,
  `ALTER FUNCTION ${projectAuthorizationFunction}(text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
];

export const migration054: Migration = {
  version: 54,
  name: "fenced per-project selector settings writes",
  statements: [
    ...selectorProjectSettingsWrite,
    ...selectorAutomaticReadinessRefusal,
    ...projectAccessKindRename,
  ],
};
