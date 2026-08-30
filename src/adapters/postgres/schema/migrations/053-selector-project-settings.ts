import {
  apiRole,
  boundaryOwnerRole,
  projectAuthorizationFunction,
  selectorControlRole,
  selectorProjectSettingsFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * A project's own selector settings, each column NULL where the project
 * inherits the installation default `selector_runtime_settings` holds. A
 * partial value cannot be a JSON document the way a total one can: the absent
 * key of a blob is untyped and unbounded, while an absent column is a NULL the
 * CHECKs beside it still answer for.
 *
 * `north_star` is here and not in a project's configuration because a
 * configuration is snapshotted into every execution's input bundle, which would
 * carry the project's goal into the scope of every task run under it. It is the
 * selector's input alone.
 */
const selectorProjectSettings = [
  `CREATE TABLE selector_project_settings (
     tenant text NOT NULL, project text NOT NULL,
     revision bigint NOT NULL DEFAULT 1,
     north_star text, mode text, dispatch_mode text, base_prompt text,
     model_allowlist text, tool_allowlist text,
     tokens_per_decision bigint, milliseconds_per_decision bigint,
     tool_calls_per_decision bigint, input_bytes_per_decision bigint,
     candidate_pages_per_decision bigint, operational_context_max_age_ms bigint,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project),
     FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
     CHECK (revision >= 1),
     CHECK (north_star IS NULL OR length(north_star) BETWEEN 1 AND 65536),
     CHECK (base_prompt IS NULL OR length(base_prompt) BETWEEN 1 AND 65536),
     CHECK (mode IS NULL OR mode IN ('Running','Paused')),
     CHECK (dispatch_mode IS NULL OR dispatch_mode IN ('Automatic','ApprovalRequired')),
     CHECK (model_allowlist IS NULL OR length(model_allowlist) BETWEEN 2 AND 65536),
     CHECK (tool_allowlist IS NULL OR length(tool_allowlist) BETWEEN 2 AND 65536),
     CHECK (tokens_per_decision IS NULL OR tokens_per_decision >= 1),
     CHECK (milliseconds_per_decision IS NULL OR milliseconds_per_decision >= 1),
     CHECK (tool_calls_per_decision IS NULL OR tool_calls_per_decision >= 1),
     CHECK (input_bytes_per_decision IS NULL OR input_bytes_per_decision >= 1),
     CHECK (candidate_pages_per_decision IS NULL OR candidate_pages_per_decision >= 1),
     CHECK (operational_context_max_age_ms IS NULL OR operational_context_max_age_ms >= 1)
   )`,
  `CREATE TABLE selector_project_settings_history (
     tenant text NOT NULL, project text NOT NULL, revision bigint NOT NULL,
     north_star text, mode text, dispatch_mode text, base_prompt text,
     model_allowlist text, tool_allowlist text,
     tokens_per_decision bigint, milliseconds_per_decision bigint,
     tool_calls_per_decision bigint, input_bytes_per_decision bigint,
     candidate_pages_per_decision bigint, operational_context_max_age_ms bigint,
     administrator_kind text NOT NULL, administrator_subject text NOT NULL,
     recorded_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant,project,revision),
     CHECK (revision >= 1),
     CHECK (length(administrator_kind) BETWEEN 1 AND 256),
     CHECK (length(administrator_subject) BETWEEN 1 AND 256)
   )`,
  `CREATE TRIGGER selector_project_automatic_readiness
     BEFORE INSERT OR UPDATE OF dispatch_mode ON selector_project_settings
     FOR EACH ROW EXECUTE FUNCTION enforce_selector_automatic_readiness()`,
];

/**
 * The whole override set is written at once under the revision the caller read
 * it at, so clearing an override and setting one are the same write and a
 * rollback is a replay of a historical row rather than a second verb. An absent
 * row is revision zero, which is the revision a first write expects.
 */
const selectorProjectSettingsWrite = [
  `CREATE FUNCTION ${selectorProjectSettingsFunction}(
     in_tenant text,in_project text,expected_revision bigint,
     new_north_star text,new_mode text,new_dispatch_mode text,new_base_prompt text,
     new_model_allowlist text,new_tool_allowlist text,
     new_tokens_per_decision bigint,new_milliseconds_per_decision bigint,
     new_tool_calls_per_decision bigint,new_input_bytes_per_decision bigint,
     new_candidate_pages_per_decision bigint,new_operational_context_max_age_ms bigint,
     in_administrator_kind text,in_administrator_subject text)
     RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
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
       IF written IS NULL THEN RETURN NULL; END IF;
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
       RETURN written;
     END $$`,
  `ALTER FUNCTION ${selectorProjectSettingsFunction}(
     text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,
     bigint,bigint,text,text) OWNER TO ${boundaryOwnerRole}`,
];

/**
 * The fence an in-flight decision is conditioned on becomes the pair of
 * revisions its settings were resolved from, because a project's row and the
 * installation's defaults each move on their own and either changes what the
 * policy was going to be run under.
 */
const selectorAttemptProjectFence = [
  `ALTER TABLE selector_attempt ADD COLUMN project_settings_revision bigint
     CHECK (project_settings_revision IS NULL OR project_settings_revision >= 0)`,
  `GRANT UPDATE (project_settings_revision) ON selector_attempt TO ${selectorServiceRole}`,
];

/**
 * A project's selector settings are a project resource, so the API serves them
 * under project membership and the installation defaults stay the selector
 * control role's alone. That is the separation that matters: a project
 * administrator may override for their own project and cannot move what every
 * other project inherits.
 */
const selectorProjectSettingsAccess = [
  `ALTER TABLE project_membership
     ADD COLUMN may_manage_selector boolean NOT NULL DEFAULT false,
     DROP CONSTRAINT project_membership_grants_something,
     ADD CONSTRAINT project_membership_grants_something CHECK (
       may_read OR may_mutate OR may_dispatch OR may_propose OR may_manage_selector)`,
  `CREATE OR REPLACE FUNCTION ${projectAuthorizationFunction}(
     in_principal text,in_tenant text,in_project text,in_access text)
     RETURNS TABLE (authority_kind text,authority_subject text)
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF in_access NOT IN ('Read','Mutate','DispatchTicket','ProposeDispatch','ManageSelector') THEN
         RAISE EXCEPTION 'unknown project access kind';
       END IF;
       RETURN QUERY
         SELECT membership.authority_kind,membership.authority_subject
           FROM project_membership membership
          WHERE membership.principal=in_principal
            AND membership.tenant=in_tenant AND membership.project=in_project
            AND CASE in_access
              WHEN 'Read' THEN membership.may_read
              WHEN 'Mutate' THEN membership.may_mutate
              WHEN 'DispatchTicket' THEN membership.may_dispatch
              WHEN 'ProposeDispatch' THEN membership.may_propose
              WHEN 'ManageSelector' THEN membership.may_manage_selector
            END;
     END $$`,
  `ALTER FUNCTION ${projectAuthorizationFunction}(text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
];

const selectorProjectSettingsGrants = [
  `GRANT SELECT,INSERT,UPDATE ON selector_project_settings TO ${boundaryOwnerRole}`,
  `GRANT INSERT ON selector_project_settings_history TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectSettingsFunction}(
     text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,
     bigint,bigint,text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorProjectSettingsFunction}(
     text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,
     bigint,bigint,text,text) TO ${apiRole},${selectorControlRole}`,
  `GRANT SELECT ON selector_project_settings
     TO ${apiRole},${selectorServiceRole},${selectorControlRole}`,
  `GRANT SELECT ON selector_project_settings_history TO ${apiRole},${selectorControlRole}`,
  `GRANT SELECT ON selector_runtime_settings TO ${apiRole}`,
];

export const migration053: Migration = {
  version: 53,
  name: "per-project selector settings",
  statements: [
    ...selectorProjectSettings,
    ...selectorProjectSettingsWrite,
    ...selectorAttemptProjectFence,
    ...selectorProjectSettingsAccess,
    ...selectorProjectSettingsGrants,
  ],
};
