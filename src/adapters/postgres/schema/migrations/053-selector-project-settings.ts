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
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * A project's own selector settings, each column NULL where the project
 * inherits the installation default `selector_runtime_settings` holds.
 *
 * A PARTIAL VALUE CANNOT BE A JSON DOCUMENT the way a total one can. The absent
 * key of a blob is untyped and unbounded, while an absent column is a NULL the
 * CHECKs beside it still answer for, so the installation keeps its `controls`
 * blob and a project's overrides are columns.
 *
 * `north_star` IS HERE AND NOT IN A PROJECT'S CONFIGURATION, because a
 * configuration is snapshotted into every execution's input bundle and would
 * carry the project's goal into the scope of every task run under it. It is the
 * selector's input alone.
 *
 * A WRITE REPLACES THE WHOLE OVERRIDE SET and answers with the row it wrote,
 * joined to the defaults it resolves against — a second statement would report
 * the table's state by then rather than this write's own. The fence is answered
 * before any row is offered, under an advisory lock on the project: a row that
 * does not exist cannot be locked, and revision zero is exactly where it does
 * not, so without the lock two administrators both writing revision zero would
 * each pass the fence and the second would reach an INSERT whose `BEFORE
 * INSERT` trigger runs ahead of `ON CONFLICT` and answer for a policy host's
 * readiness rather than for the fence. That lock names the project by the
 * length of its tenant and then both parts, because a separator is only a
 * separator while no identity contains one and both halves here are opaque. The
 * insert under it carries no conflict arm: this function is the table's only
 * writer, and it has already read that the row does not exist while holding the
 * lock.
 *
 * THE FENCE AN IN-FLIGHT DECISION IS CONDITIONED ON becomes the pair of
 * revisions its settings were resolved from, because a project's row and the
 * installation's defaults each move on their own and either changes what the
 * policy was going to run under. `selector_attempt` records both.
 *
 * A PROJECT'S SETTINGS ARE A PROJECT RESOURCE, so the API serves them under
 * project membership while the installation defaults stay the selector control
 * role's alone, and `ManageProjectSelector` is named apart from the
 * installation-wide `ManageSelector` capability for the same reason.
 */

const selectorProjectSettingsArguments =
  "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

/** What a write answers with: the project's own columns beside the defaults they fall back to. */
const selectorProjectSettingsColumns = `
       revision bigint,north_star text,mode text,dispatch_mode text,
       base_prompt text,model_allowlist text,tool_allowlist text,
       tokens_per_decision bigint,milliseconds_per_decision bigint,
       tool_calls_per_decision bigint,input_bytes_per_decision bigint,
       candidate_pages_per_decision bigint,operational_context_max_age_ms bigint,
       installation_revision bigint,installation_mode text,
       installation_dispatch_mode text,installation_base_prompt text,
       installation_controls text`;

/** The written row read back at the revision this write produced, and no later one. */
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

/** The overrides a project holds, and the trigger that guards its dispatch mode. */
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
 * The readiness refusal carries a SQLSTATE of its own, because it is a condition
 * an administrator can fix rather than a fault. A caller that recognised it by
 * the text of a message would recognise it wrongly the first time that message
 * was reworded.
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
 * The write, whose whole shape the module header argues. Clearing an override
 * and setting one are the same statement, and a rollback is a replay of a
 * historical row rather than a second verb.
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
     RETURNS TABLE(${selectorProjectSettingsColumns})
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
];

/** The project half of the pair a decision is fenced on, beside the installation's. */
const selectorAttemptProjectFence = [
  `ALTER TABLE selector_attempt ADD COLUMN project_settings_revision bigint
     CHECK (project_settings_revision IS NULL OR project_settings_revision >= 0)`,
  `GRANT UPDATE (project_settings_revision) ON selector_attempt TO ${selectorServiceRole}`,
];

/**
 * The access a project's settings answer to. Both the accepted kinds and the
 * column each is granted by are rendered from `projectAccessColumns`, so a kind
 * added to the roster without a column beside it is a compile error rather than
 * a runtime refusal.
 */
const selectorProjectSettingsAccess = [
  `ALTER TABLE project_membership
     ADD COLUMN ${projectAccessColumns.ManageProjectSelector} boolean NOT NULL DEFAULT false,
     DROP CONSTRAINT project_membership_grants_something,
     ADD CONSTRAINT project_membership_grants_something CHECK (
       may_read OR may_mutate OR may_dispatch OR may_propose
         OR ${projectAccessColumns.ManageProjectSelector})`,
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

const selectorProjectSettingsGrants = [
  `GRANT SELECT,INSERT,UPDATE ON selector_project_settings TO ${boundaryOwnerRole}`,
  `GRANT INSERT ON selector_project_settings_history TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorProjectSettingsFunction}(${selectorProjectSettingsArguments})
     TO ${apiRole},${selectorControlRole}`,
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
    ...selectorAutomaticReadinessRefusal,
    ...selectorProjectSettingsWrite,
    ...selectorAttemptProjectFence,
    ...selectorProjectSettingsAccess,
    ...selectorProjectSettingsGrants,
  ],
};
