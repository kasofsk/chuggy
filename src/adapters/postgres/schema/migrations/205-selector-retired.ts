/**
 * The selector's persistence, the refusal ledger and the decision log are
 * dropped, and the selector's roles are left standing with nothing granted.
 * Nothing reads any of it: the selector service, its review, its context
 * route, the ledger's routes and the lead's runtime settings are gone, and
 * the rows go with their tables unarchived.
 *
 * THE TABLES DROPPED are the attempt and what hangs from it
 * (`selector_attempt`, `selector_decision_permit`, `selector_observation`),
 * the decision log (`selector_interaction`, `selector_interaction_resource`,
 * `selector_planning_intent`), held decisions (`selector_proposal_delivery`,
 * `selector_proposal_review`), the refusal ledgers
 * (`selector_agentic_refusal`, `selector_lead_refusal`), the selector's own
 * state (`selector_inventory_state`, `selector_project_state`,
 * `selector_runtime_readiness`) and the installation's lead settings
 * (`selector_runtime_settings`, `selector_runtime_settings_history`). Their
 * triggers, sequences and grants go with them.
 *
 * THE FUNCTIONS DROPPED are every door, trigger body and read over those
 * tables, named in `droppedFunctions` and `droppedTriggerFunctions`. The
 * Automatic-readiness trigger on the kept `selector_project_settings` read
 * `selector_runtime_readiness`, so it goes first.
 *
 * TWO KEPT FUNCTIONS ARE REPLACED. `delete_unrun_project` is 174's without the
 * selector relations, emptying `projectDeletionRelationsAt205`;
 * `update_selector_project_settings` is 133's without the installation
 * columns its result joined from `selector_runtime_settings`, which changes
 * its result type, so it is dropped and created again. Each is given its owner
 * and its API grant again.
 *
 * THE SELECTOR ROLES LOSE EVERY TABLE, COLUMN, SEQUENCE AND ROUTINE PRIVILEGE
 * they hold in `public`, and keep the schema's `USAGE` and their existence,
 * which the deployment's role file names.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectDeleteFunction,
  projectDeletionHoldsFunction,
  selectorControlRole,
  selectorProjectSettingsFunction,
  selectorReviewRole,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";
import { migration133 } from "./133-session-model-effort.ts";
import { projectDeletionRelationsAt174 } from "./174-unrun-deletion.ts";

/** Every table dropped, children before the tables they point at. */
export const selectorRetiredTables = [
  "selector_agentic_refusal",
  "selector_interaction_resource",
  "selector_planning_intent",
  "selector_proposal_review",
  "selector_proposal_delivery",
  "selector_interaction",
  "selector_decision_permit",
  "selector_observation",
  "selector_attempt",
  "selector_inventory_state",
  "selector_lead_refusal",
  "selector_project_state",
  "selector_runtime_readiness",
  "selector_runtime_settings_history",
  "selector_runtime_settings",
] as const;

/** The functions over the dropped tables that no trigger calls, each by its newest signature. */
const droppedFunctions = [
  "advance_selector_attempt(text,text,text)",
  "advance_selector_delivery(text,bigint,text,text)",
  "allocate_selector_attempt(text,text,text,integer,integer,integer)",
  "claim_selector_attempt_reconciliation(integer)",
  "claim_selector_deliveries(integer)",
  "claim_selector_proposal_reconciliation(integer)",
  "retire_moved_selector_proposals(text,text)",
  "review_selector_proposal(text,text,text,text,text,text,text)",
  "set_selector_host_readiness(boolean)",
  "selector_project_dispatch_mode(text,text)",
  "update_selector_runtime_settings(bigint,text,text,text,text,text,text)",
  "record_agentic_refusals(text,text,text,jsonb,jsonb)",
  "standing_agentic_refusals(text,text,bigint)",
  "standing_agentic_refusals_among(text,text,bigint[])",
  "read_agentic_refusals(text,text,bigint,bigint)",
  "read_standing_agentic_refusals(text,text,bigint)",
  "read_binding_agentic_refusals(text,text,bigint)",
  "read_thread_agentic_refusals(text,text,bigint[],bigint)",
  "read_selector_interactions(text,text,bigint,bigint,boolean)",
  "read_selector_planning_intent(text,text)",
  "read_lead_standing(text,text,bigint)",
  "read_lead_refusal(text,text,bigint)",
] as const;

/** The trigger bodies, dropped once the tables their triggers stood on are. */
const droppedTriggerFunctions = [
  "enforce_selector_proposal_attempt()",
  "enforce_selector_proposal_initial_state()",
  "enforce_selector_automatic_readiness()",
  "selector_refusal_is_immutable()",
] as const;

const selectorRoles = [
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
] as const;

/** Every relation keyed by a project that its deletion empties, children before the relations they point at. */
export const projectDeletionRelationsAt205 =
  projectDeletionRelationsAt174.filter(
    (relation) =>
      !(selectorRetiredTables as readonly string[]).includes(relation),
  );

const projectDelete = `public.${projectDeleteFunction}(in_tenant text, in_project text)`;

const projectDeletion = `CREATE OR REPLACE FUNCTION ${projectDelete} RETURNS TABLE(outcome text, held text[])
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE holdings text[];
         BEGIN
           PERFORM 1 FROM public.project p
             WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;
           IF NOT FOUND THEN
             RETURN QUERY SELECT 'NotFound'::text, ARRAY[]::text[];
             RETURN;
           END IF;
           holdings := public.${projectDeletionHoldsFunction}(in_tenant, in_project);
           IF cardinality(holdings) > 0 THEN
             RETURN QUERY SELECT 'Held'::text, holdings;
             RETURN;
           END IF;
           UPDATE public.project p SET lifecycle='Deleting'
            WHERE p.tenant=in_tenant AND p.project=in_project;
           DELETE FROM public.project_creation_grant g WHERE g.operation IN (
             SELECT o.operation FROM public.project_creation_operation o
              WHERE o.tenant=in_tenant AND o.project=in_project);
           ${projectDeletionRelationsAt205
             .map(
               (relation) =>
                 `DELETE FROM public.${relation} d WHERE d.tenant=in_tenant AND d.project=in_project;`,
             )
             .join("\n           ")}
           DELETE FROM public.invite_link l WHERE l.tenant=in_tenant
              AND l.projects @> jsonb_build_array(jsonb_build_object('project', in_project));
           DELETE FROM public.project p WHERE p.tenant=in_tenant AND p.project=in_project;
           INSERT INTO public.project_vacancy(tenant,project) VALUES(in_tenant,in_project)
             ON CONFLICT DO NOTHING;
           DELETE FROM public.capacity_account c
            WHERE c.account=public.project_capacity_account(in_tenant, in_project);
           RETURN QUERY SELECT 'Deleted'::text, ARRAY[]::text[];
         END $$`;

const settings = `public.${selectorProjectSettingsFunction}(in_tenant text, in_project text, expected_revision bigint, new_north_star text, new_thread_standing_rules text, new_mode text, new_dispatch_mode text, new_base_prompt text, new_model_allowlist text, new_tool_allowlist text, new_tokens_per_decision bigint, new_milliseconds_per_decision bigint, new_tool_calls_per_decision bigint, new_dispatches_per_decision bigint, new_input_bytes_per_decision bigint, new_candidate_pages_per_decision bigint, new_auto_compact_window bigint, new_operational_context_max_age_ms bigint, new_lead_model text, new_lead_effort text, new_thread_model text, new_thread_effort text, in_administrator_kind text, in_administrator_subject text)`;

/** Each part of 133's settings door naming the installation, and what it is without it. */
const settingsInstallationParts = [
  [
    ", installation_revision bigint, installation_mode text, installation_dispatch_mode text, installation_base_prompt text, installation_controls text)",
    ")",
  ],
  [
    `settings.thread_model,settings.thread_effort,
         installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls`,
    "settings.thread_model,settings.thread_effort",
  ],
  ["\n    CROSS JOIN selector_runtime_settings installation", ""],
  [" AND installation.singleton=1;", ";"],
] as const;

/** 133's settings door, with the installation taken out of its result. */
function migration205SettingsDoor(): string {
  const stood = migration133.statements.find((statement) =>
    statement.startsWith(`CREATE FUNCTION ${settings} RETURNS TABLE(`),
  );
  if (stood === undefined)
    throw new Error("migration 205: 133 no longer installs the settings door");
  const narrowed = settingsInstallationParts.reduce((door, [from, to]) => {
    if (!door.includes(from))
      throw new Error(
        `migration 205: 133's settings door no longer reads ${from.trim()}`,
      );
    return door.replace(from, to);
  }, stood);
  if (narrowed.includes("installation"))
    throw new Error(
      "migration 205: 133's settings door names the installation outside what this takes out",
    );
  return narrowed;
}

/** The owner a door is installed under, and the API its only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ];
}

export const migration205: Migration = {
  version: 205,
  name: "the selector's persistence, refusal ledger and decision log are dropped",
  statements: [
    `DROP TRIGGER selector_project_automatic_readiness ON public.selector_project_settings`,
    ...droppedFunctions.map((signature) => `DROP FUNCTION public.${signature}`),
    `DROP FUNCTION ${settings}`,
    migration205SettingsDoor(),
    ...owned(settings),
    projectDeletion,
    ...owned(projectDelete),
    ...selectorRetiredTables.map((table) => `DROP TABLE public.${table}`),
    ...droppedTriggerFunctions.map(
      (signature) => `DROP FUNCTION public.${signature}`,
    ),
    ...selectorRoles.flatMap((role) => [
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
      `REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM ${role}`,
    ]),
  ],
};
