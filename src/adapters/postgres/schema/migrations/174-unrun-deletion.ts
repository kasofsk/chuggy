/**
 * A project that never ran work is deleted, and then a tenant that holds no
 * project, so a name an onboarding rehearsal took is free for the next.
 *
 * NEVER RAN IS WHAT THE DOOR CAN SEE IN ITS OWN ROWS. A released ticket is a
 * journal entry, and everything run beneath one — an execution, a session, a
 * pool registered for the project, an action reported done — points at the
 * project row, so `project_deletion_holds` names each of those the project
 * holds, and `delete_unrun_project` deletes nothing while it names any. Every
 * relation beneath those is reached only through one of them, so a project
 * that holds none holds no run history and no journal, and deleting it is
 * nothing the journal or the model has to express.
 *
 * WHAT IS DELETED IS EVERYTHING A PROJECT IS rather than anything it did: its
 * drafts and epics, its bound repositories, the operations that bound them and
 * the configurations imported from them, its settings and placements, its
 * readiness, its change log, the operations accepted for it, the record of its
 * creation and its capacity account. Every invite link naming it goes too,
 * open or used, since a used link can be given back and a redeemed one would
 * grant a role on whichever project next takes the name. A member's runner
 * serving it stops serving it; the runner stays the member's.
 *
 * A DELETED PROJECT LEAVES ITS NAME VACANT, a `project_vacancy` row that names
 * no row and outlives its tenant. A grant can still land on the project's
 * object after its erasure, from a redemption spent before the deletion or an
 * erasure lost, and a project later made under the name would inherit it. The
 * API asks `project_vacated` before it grants on a new project, erases the
 * object where the name is vacant, and only then calls `fill_project_vacancy`,
 * which removes the row only while the project stands.
 *
 * THE DOOR MOVES THE PROJECT TO `Deleting` FIRST, under its row lock, and the
 * triggers that hold a binding, a bind operation, an epic's revision and a
 * creation record immutable let a row go only while its project stands there.
 * Every decision and acceptance already refuses that lifecycle, and the row
 * lock is what a release, an execution, a session and a pool each take as
 * they point at the project, so none lands between the check and the delete.
 *
 * A TENANT IS DELETED ONCE IT HOLDS NO PROJECT, no member's runner or chat
 * host, and no session: `delete_unrun_tenant` deletes its registration tokens,
 * the forge installations it claimed, every invite link it minted and the
 * workspace link that made it, and its row. The triggers that keep a tenant and
 * a forge claim let one go only once no project names the tenant, so a claim a
 * project could be using is never released. Its tuples are the authority's,
 * which the API erases after this door answers.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectDeleteFunction,
  projectDeletionHoldsFunction,
  projectVacancyFillFunction,
  projectVacatedFunction,
  tenantDeleteFunction,
  tenantDeletionHoldsFunction,
  type Migration,
} from "../shared.ts";

const projectHolds = `public.${projectDeletionHoldsFunction}(in_tenant text, in_project text)`;
const projectDelete = `public.${projectDeleteFunction}(in_tenant text, in_project text)`;
const projectVacated = `public.${projectVacatedFunction}(in_tenant text, in_project text)`;
const projectVacancyFill = `public.${projectVacancyFillFunction}(in_tenant text, in_project text)`;
const tenantHolds = `public.${tenantDeletionHoldsFunction}(in_tenant text)`;
const tenantDelete = `public.${tenantDeleteFunction}(in_tenant text)`;

/** What keeps a project from deletion, each by the relation that holds it. */
export const projectDeletionHoldingsAt174 = {
  ReleasedTicket: "journal_entry",
  Execution: "execution",
  Session: "agent_session",
  WorkerPool: "worker_pool",
  ActionObservation: "action_observation",
} as const;

/** What keeps a tenant from deletion, each by the relation that holds it. */
export const tenantDeletionHoldingsAt174 = {
  Project: "project",
  PersonalRunner: "personal_runner",
  ChatHost: "chat_host",
  Session: "agent_session",
} as const;

/**
 * Every relation keyed by a project that its deletion empties, children before
 * the relations they point at.
 */
export const projectDeletionRelationsAt174 = [
  "draft_brief_check",
  "draft_brief_image",
  "draft_brief_link",
  "draft_revision",
  "draft_brief",
  "draft",
  "epic_ticket",
  "epic",
  "epic_change",
  "dispatch_candidate_dependency",
  "dispatch_candidate",
  "dispatch_view",
  "selector_planning_intent",
  "selector_proposal_delivery",
  "selector_proposal_review",
  "selector_agentic_refusal",
  "selector_interaction",
  "selector_attempt",
  "selector_project_settings",
  "selector_project_settings_history",
  "selector_project_state",
  "selector_lead_refusal",
  "scheduler_incident",
  "decision_input",
  "operation",
  "project_readiness",
  "project_change",
  "project_notification",
  "member_thread_limit",
  "project_execution_placement",
  "project_owner_fallback",
  "project_session_placement",
  "personal_runner_project",
  "ticket_projection",
  "ticket_definition",
  "ticket_source",
  "input_bundle_reference",
  "input_bundle",
  "worker_pool_registration_token",
  "repository_action",
  "repository_configuration_import",
  "project_repository_bind_operation",
  "project_repository",
  "repository_configuration_workload_path",
  "repository_configuration_provenance",
  "repository_configuration_version",
  "configuration_revision",
  "project_creation_operation",
] as const;

/** The relations beneath a selector attempt that name it by its attempt alone. */
const selectorAttemptRelations = [
  "selector_interaction_resource",
  "selector_decision_permit",
  "selector_observation",
] as const;

/** What a tenant's deletion empties beside its row. */
const tenantDeletionRelations = [
  "personal_runner_registration_token",
  "forge_installation",
  "invite_link",
  "tenant",
] as const;

/** One `CASE` naming a holding where its relation holds a row of the key `where` names. */
function holdingCase(holding: string, relation: string, where: string): string {
  return `CASE WHEN EXISTS(SELECT 1 FROM public.${relation} h WHERE ${where}) THEN '${holding}' END`;
}

function holdingsArray(
  holdings: Readonly<Record<string, string>>,
  where: string,
): string {
  const cases = Object.entries(holdings).map(([holding, relation]) =>
    holdingCase(holding, relation, where),
  );
  return `array_remove(ARRAY[${cases.join(",\n")}]::text[], NULL)`;
}

function projectRowsDeleted(relation: string): string {
  return `DELETE FROM public.${relation} d WHERE d.tenant=in_tenant AND d.project=in_project;`;
}

function selectorAttemptRowsDeleted(relation: string): string {
  const key =
    relation === "selector_interaction_resource"
      ? "selector_decision"
      : "attempt";
  return `DELETE FROM public.${relation} d WHERE d.${key} IN (
             SELECT a.attempt FROM public.selector_attempt a
              WHERE a.tenant=in_tenant AND a.project=in_project);`;
}

/** The owner and the one grant every door here ends with, the API its only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ];
}

const projectDeleting = `EXISTS(SELECT 1 FROM public.project p
                 WHERE p.tenant=OLD.tenant AND p.project=OLD.project
                   AND p.lifecycle='Deleting')`;

export const migration174: Migration = {
  version: 174,
  name: "a project that never ran work is deleted, and then a tenant that holds no project",
  statements: [
    `CREATE OR REPLACE FUNCTION public.project_creation_is_immutable() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         IF TG_OP='DELETE' THEN
           IF TG_TABLE_NAME='tenant' THEN
             IF NOT EXISTS(SELECT 1 FROM public.project p WHERE p.tenant=OLD.tenant) THEN
               RETURN OLD;
             END IF;
           ELSIF TG_TABLE_NAME='project_creation_grant' THEN
             IF EXISTS(SELECT 1 FROM public.project_creation_operation o
                         JOIN public.project p ON p.tenant=o.tenant AND p.project=o.project
                        WHERE o.operation=OLD.operation AND p.lifecycle='Deleting') THEN
               RETURN OLD;
             END IF;
           ELSIF ${projectDeleting} THEN
             RETURN OLD;
           END IF;
         END IF;
         RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
           USING ERRCODE='integrity_constraint_violation'; END $$`,
    `CREATE OR REPLACE FUNCTION public.project_repository_is_immutable() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         IF TG_OP='UPDATE'
            AND to_jsonb(NEW)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'retired_at'
              = to_jsonb(OLD)-'landing_kind'-'landing_mode'-'landing_policy'-'pipelines_writable'-'retired_at'
           THEN RETURN NEW; END IF;
         IF TG_OP='DELETE' AND ${projectDeleting} THEN RETURN OLD; END IF;
         RAISE EXCEPTION 'repository bindings are immutable but for their landing, their pipeline definitions and their retirement'
           USING ERRCODE='integrity_constraint_violation'; END $$`,
    `CREATE OR REPLACE FUNCTION public.project_repository_bind_operation_is_immutable() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         IF TG_OP='DELETE' AND ${projectDeleting} THEN RETURN OLD; END IF;
         RAISE EXCEPTION 'repository bind operations are immutable'
           USING ERRCODE='integrity_constraint_violation'; END $$`,
    `CREATE OR REPLACE FUNCTION public.forge_installation_keeps_its_claim() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         IF TG_OP = 'DELETE' THEN
           IF NOT EXISTS(SELECT 1 FROM public.project p WHERE p.tenant=OLD.tenant) THEN
             RETURN OLD;
           END IF;
           RAISE EXCEPTION 'a forge installation claim is released only with a tenant that holds no project'
             USING ERRCODE='integrity_constraint_violation';
         END IF;
         IF NEW.forge IS DISTINCT FROM OLD.forge
            OR NEW.app IS DISTINCT FROM OLD.app
            OR NEW.account IS DISTINCT FROM OLD.account
            OR NEW.tenant IS DISTINCT FROM OLD.tenant THEN
           RAISE EXCEPTION 'a forge installation does not change hands'
             USING ERRCODE='integrity_constraint_violation';
         END IF;
         RETURN NEW; END $$`,
    `CREATE TABLE public.project_vacancy (
       tenant text NOT NULL,
       project text NOT NULL,
       PRIMARY KEY (tenant,project))`,
    `GRANT SELECT, INSERT, DELETE ON public.project_vacancy TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${projectHolds} RETURNS text[]
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT ${holdingsArray(projectDeletionHoldingsAt174, "h.tenant=p.tenant AND h.project=p.project")}
           FROM public.project p
          WHERE p.tenant=in_tenant AND p.project=in_project
       $$`,
    ...owned(projectHolds),
    `CREATE FUNCTION ${projectDelete} RETURNS TABLE(outcome text, held text[])
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
           ${selectorAttemptRelations.map(selectorAttemptRowsDeleted).join("\n           ")}
           DELETE FROM public.project_creation_grant g WHERE g.operation IN (
             SELECT o.operation FROM public.project_creation_operation o
              WHERE o.tenant=in_tenant AND o.project=in_project);
           ${projectDeletionRelationsAt174.map(projectRowsDeleted).join("\n           ")}
           DELETE FROM public.invite_link l WHERE l.tenant=in_tenant
              AND l.projects @> jsonb_build_array(jsonb_build_object('project', in_project));
           DELETE FROM public.project p WHERE p.tenant=in_tenant AND p.project=in_project;
           INSERT INTO public.project_vacancy(tenant,project) VALUES(in_tenant,in_project)
             ON CONFLICT DO NOTHING;
           DELETE FROM public.capacity_account c
            WHERE c.account=public.project_capacity_account(in_tenant, in_project);
           RETURN QUERY SELECT 'Deleted'::text, ARRAY[]::text[];
         END $$`,
    ...owned(projectDelete),
    `CREATE FUNCTION ${projectVacated} RETURNS boolean
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT EXISTS(SELECT 1 FROM public.project_vacancy v
                        WHERE v.tenant=in_tenant AND v.project=in_project)
       $$`,
    ...owned(projectVacated),
    `CREATE FUNCTION ${projectVacancyFill} RETURNS void
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DELETE FROM public.project_vacancy v
          WHERE v.tenant=in_tenant AND v.project=in_project
            AND EXISTS(SELECT 1 FROM public.project p
                        WHERE p.tenant=in_tenant AND p.project=in_project
                          AND p.lifecycle<>'Deleting')
       $$`,
    ...owned(projectVacancyFill),
    `CREATE FUNCTION ${tenantHolds} RETURNS text[]
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         SELECT ${holdingsArray(tenantDeletionHoldingsAt174, "h.tenant=in_tenant")}
       $$`,
    ...owned(tenantHolds),
    `CREATE FUNCTION ${tenantDelete} RETURNS TABLE(outcome text, held text[])
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
         DECLARE holdings text[];
         BEGIN
           holdings := public.${tenantDeletionHoldsFunction}(in_tenant);
           IF cardinality(holdings) > 0 THEN
             RETURN QUERY SELECT 'Held'::text, holdings;
             RETURN;
           END IF;
           DELETE FROM public.personal_runner_registration_token d WHERE d.tenant=in_tenant;
           DELETE FROM public.forge_installation d WHERE d.tenant=in_tenant;
           DELETE FROM public.invite_link d WHERE d.tenant=in_tenant OR d.workspace=in_tenant;
           DELETE FROM public.tenant d WHERE d.tenant=in_tenant;
           RETURN QUERY SELECT 'Deleted'::text, ARRAY[]::text[];
         END $$`,
    ...owned(tenantDelete),
    `GRANT UPDATE (lifecycle) ON public.project TO ${boundaryOwnerRole}`,
    ...[
      ...projectDeletionRelationsAt174,
      ...selectorAttemptRelations,
      ...tenantDeletionRelations,
      "project_creation_grant",
      "project",
      "capacity_account",
    ].map(
      (relation) =>
        `GRANT SELECT, DELETE ON public.${relation} TO ${boundaryOwnerRole}`,
    ),
    ...Object.values(projectDeletionHoldingsAt174).map(
      (relation) =>
        `GRANT SELECT (tenant, project) ON public.${relation} TO ${boundaryOwnerRole}`,
    ),
    ...Object.values(tenantDeletionHoldingsAt174).map(
      (relation) =>
        `GRANT SELECT (tenant) ON public.${relation} TO ${boundaryOwnerRole}`,
    ),
  ],
};
