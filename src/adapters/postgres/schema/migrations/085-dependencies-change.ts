/**
 * A Pending ticket's dependencies may change: `revise_draft` no longer answers
 * `DependenciesLocked`, and the refusal constraints admit `DependenciesRevoked`
 * and `DependencyCycle` and refuse the retired `TicketDependenciesChanged`.
 * `ticket_updated_dependencies` reads the dependencies a ticket's last update
 * named through `journal_entry_update_ticket`, which indexes an update by its
 * ticket as `journal_entry_release_ticket` indexes a release.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketUpdatedDependenciesFunction,
  type Migration,
} from "../shared.ts";

/** The machine's refusals whose payload is the ticket alone. */
const ticketRefusals = [
  "TicketAlreadyExists",
  "SelfDependency",
  "TicketNotFound",
  "TicketNotPending",
  "TicketIdentityMismatch",
  "TicketNotRevocable",
  "TicketNotResumable",
];

/** The machine's refusals whose payload is the ticket and the dependencies refused. */
const dependencyRefusals = [
  "DependenciesNotFound",
  "DependenciesRevoked",
  "DependencyCycle",
  "DependenciesIncomplete",
];

/** Every refusal the machine decides, each stored with its payload. */
const domainRefusals = [
  ...ticketRefusals,
  ...dependencyRefusals,
  "TicketRevisionStale",
  "TaskNotCurrent",
  "FinalizationNotCurrent",
];

/** The boundary's own refusals, which 080 admitted. */
const boundaryRefusals = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
  "BriefChecksUncommanded",
  "ConfigurationFromAnotherRepository",
  "SelectionUnknown",
  "SelectionUnsupported",
  "ProgramExceedsPlan",
  "ProgramSkipsBriefChecks",
  "OverridesUnsupported",
  "OverridesUnknown",
  "TicketCapacityReached",
  "FinalizationRequestClosed",
  "OverridesMoveDefinition",
];

const reviseDraftSignature = `public.revise_draft(in_tenant text, in_project text, in_ticket bigint, in_expected bigint, in_configuration text, in_authoring text, in_title text, in_intent text, in_links text[], in_images text[], in_checks text[], in_branch text, in_finalization_mode text, in_finalization_target text, in_repository text, in_overrides text, in_selection text, in_kind text, in_subject text)`;

function textList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The predicate `decision_input_refusal_is_its_outcome` holds a stored refusal to, by its code. */
const refusalValidator = `CREATE OR REPLACE FUNCTION public.decision_refusal_is_valid(code text, refusal text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE value jsonb; item jsonb;
     BEGIN
       IF code IS NULL OR refusal IS NULL OR NOT (refusal IS JSON OBJECT) THEN
         RETURN false;
       END IF;
       IF (refusal::jsonb)->>'type' IS DISTINCT FROM code THEN
         RETURN false;
       END IF;
       value := (refusal::jsonb)->'value';
       IF code IN (${textList(ticketRefusals)}) THEN
         RETURN command_reference(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT command_reference(value->'ticket') THEN
         RETURN false;
       END IF;
       IF code IN (${textList(dependencyRefusals)}) THEN
         IF jsonb_typeof(value->'dependencies') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'dependencies') < 1
            OR (SELECT count(DISTINCT element)
                  FROM jsonb_array_elements(value->'dependencies') AS elements(element))
               <> jsonb_array_length(value->'dependencies') THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'dependencies') AS elements(element) LOOP
           IF NOT command_reference(item) THEN RETURN false; END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF code = 'TicketRevisionStale' THEN
         RETURN command_reference(value->'expected')
           AND command_reference(value->'current');
       END IF;
       IF code = 'TaskNotCurrent' THEN
         RETURN task_identity_is_valid(value->'task');
       END IF;
       IF code = 'FinalizationNotCurrent' THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'generation');
       END IF;
       RETURN false;
     END $$`;

/** 064's `revise_draft`, which no longer weighs the dependencies a released draft is revised to. */
const reviseDraft = `CREATE OR REPLACE FUNCTION ${reviseDraftSignature} RETURNS TABLE(result text, authoring_version bigint, state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE current draft%ROWTYPE; next_version bigint; landing text; target text;
       phase text;
     BEGIN
       SELECT * INTO current FROM draft WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket FOR UPDATE;
       IF NOT FOUND THEN RETURN QUERY SELECT 'NotFound',NULL::bigint,NULL::text; RETURN; END IF;
       IF current.state = 'Released' THEN
         SELECT p.phase INTO phase FROM ticket_projection p
          WHERE p.tenant=in_tenant AND p.project=in_project AND p.ticket=in_ticket;
       END IF;
       IF current.state <> 'Draft' AND NOT (current.state = 'Released' AND phase IS NOT DISTINCT FROM 'Pending')
         THEN RETURN QUERY SELECT 'NotDraft',current.authoring_version,current.state; RETURN; END IF;
       IF current.authoring_version <> in_expected THEN RETURN QUERY SELECT 'Stale',current.authoring_version,current.state; RETURN; END IF;
       IF NOT EXISTS (SELECT 1 FROM configuration_revision WHERE tenant=in_tenant AND project=in_project AND revision=in_configuration)
         THEN RETURN QUERY SELECT 'ConfigurationNotFound',current.authoring_version,current.state; RETURN; END IF;
       IF in_repository IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_repository
            WHERE tenant=in_tenant AND project=in_project AND repository=in_repository
              AND retired_at IS NULL)
         THEN RETURN QUERY SELECT 'RepositoryNotBound',current.authoring_version,current.state; RETURN; END IF;
       landing := coalesce(in_finalization_mode,
     (SELECT b.landing_mode FROM project_repository b
       WHERE b.tenant=in_tenant AND b.project=in_project
         AND b.repository=in_repository),
     'Push');
       target := in_finalization_target;
       IF landing IN ('PullRequest','PullRequestMerge') AND in_branch IS NULL THEN
         RETURN QUERY SELECT 'LandingUnbranched',current.authoring_version,current.state; RETURN;
       END IF;
       next_version := current.authoring_version+1;
       INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,authoring,overrides,selection,authority_kind,authority_subject)
         VALUES (in_tenant,in_project,in_ticket,next_version,in_configuration,in_authoring,in_overrides::jsonb,in_selection::jsonb,in_kind,in_subject);
       INSERT INTO draft_brief (tenant,project,ticket,title,intent,branch,finalization_mode,finalization_target,repository)
         VALUES (in_tenant,in_project,in_ticket,in_title,in_intent,in_branch,landing,target,in_repository)
         ON CONFLICT (tenant,project,ticket) DO UPDATE SET title=EXCLUDED.title,intent=EXCLUDED.intent,
           branch=EXCLUDED.branch,repository=EXCLUDED.repository,
           finalization_mode=EXCLUDED.finalization_mode,finalization_target=EXCLUDED.finalization_target;
       DELETE FROM draft_brief_link
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_link (tenant,project,ticket,ordinal,url)
         SELECT in_tenant,in_project,in_ticket,link.ordinal,link.url
           FROM unnest(in_links) WITH ORDINALITY AS link(url,ordinal);
       DELETE FROM draft_brief_image
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_image (tenant,project,ticket,ordinal,artifact)
         SELECT in_tenant,in_project,in_ticket,image.ordinal,image.artifact
           FROM unnest(in_images) WITH ORDINALITY AS image(artifact,ordinal);
       DELETE FROM draft_brief_check
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       INSERT INTO draft_brief_check (tenant,project,ticket,ordinal,command)
         SELECT in_tenant,in_project,in_ticket,line.ordinal,line.command
           FROM unnest(in_checks) WITH ORDINALITY AS line(command,ordinal);
       UPDATE draft SET authoring_version=next_version,configuration_revision=in_configuration
        WHERE tenant=in_tenant AND project=in_project AND ticket=in_ticket;
       PERFORM publish_project_notification(in_tenant,in_project,'Draft',in_ticket::text,NULL,next_version);
       RETURN QUERY SELECT 'Revised',next_version,current.state;
     END $$`;

const dependencies = `public.${ticketUpdatedDependenciesFunction}(in_tenant text, in_project text, in_ticket bigint)`;

/** The dependencies a ticket's last update named, or none for a ticket never updated, read under its caller's own grant on the journal. */
const ticketUpdatedDependencies = `CREATE FUNCTION ${dependencies}
       RETURNS TABLE(deps jsonb)
       LANGUAGE sql STABLE
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT (CASE WHEN j.entry IS JSON OBJECT
                    THEN j.entry::jsonb->'event'->'value'->'definition'->'dependencies' END)
         FROM journal_entry j
        WHERE j.tenant = in_tenant AND j.project = in_project
          AND (CASE WHEN j.entry IS JSON OBJECT
                    THEN j.entry::jsonb->'event'->>'type' END) = 'TicketUpdated'
          AND (CASE WHEN j.entry IS JSON OBJECT
                    THEN j.entry::jsonb->'event'->'value'->'ticket' END) = to_jsonb(in_ticket)
        ORDER BY j.seq DESC
        LIMIT 1
     $$`;

export const migration085: Migration = {
  version: 85,
  name: "a pending ticket's dependencies may change, and what an update adds is refused if revoked or cyclic",
  statements: [
    refusalValidator,
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])})))),
       DROP CONSTRAINT decision_input_refusal_is_its_outcome,
       ADD CONSTRAINT decision_input_refusal_is_its_outcome CHECK ((
CASE
    WHEN (outcome_code = ANY (${textArray(domainRefusals)})) THEN (decision_refusal_is_valid(outcome_code, refusal) IS TRUE)
    ELSE (refusal IS NULL)
END))`,
    reviseDraft,
    `ALTER FUNCTION ${reviseDraftSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${reviseDraftSignature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${reviseDraftSignature} TO ${apiRole}`,
    `CREATE INDEX journal_entry_update_ticket ON public.journal_entry USING btree (tenant, project, (
CASE
    WHEN (entry IS JSON OBJECT) THEN ((((entry)::jsonb -> 'event'::text) -> 'value'::text) -> 'ticket'::text)
    ELSE NULL::jsonb
END)) WHERE (
CASE
    WHEN (entry IS JSON OBJECT) THEN (((entry)::jsonb -> 'event'::text) ->> 'type'::text)
    ELSE NULL::text
END = 'TicketUpdated'::text)`,
    ticketUpdatedDependencies,
    `ALTER FUNCTION ${dependencies} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${dependencies} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${dependencies} TO ${apiRole}`,
  ],
};
