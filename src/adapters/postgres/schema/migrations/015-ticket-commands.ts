import {
  apiRole,
  boundaryOwnerRole,
  sourceUnrecordedResult,
  ticketServiceRole,
  workResultUnrecordedResult,
  type Migration,
} from "../shared.ts";

/**
 * The inbox holds the ticket's own commands, a report names the ticket it is
 * about, and a refusal is stored as what the machine refused. A `Decide`
 * carries a ticket command — create, dispatch, revoke, resume, a task's
 * terminal report or a finalization's result — under a field of its own; the
 * task terminal report carries its ticket in every arm, in the inbox and in
 * the journal alike; and an input refused by the machine keeps the refusal it
 * was refused with beside the code that names it.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A journalled report names no ticket
 * and the check this image installs refuses one that does not, so a journal
 * with rows in it comes up holding entries the actor cannot replay. A stored
 * operation is in the same place: its `Decide` carries an event under the
 * field this image no longer reads, and a refused one names a code this image
 * no longer admits and no refusal beside it. The guard refuses the migration
 * while either holds a row and names `deploy/rig/wipe-tickets.sql`. The
 * script to run is the one the previous release shipped, which is the rule the
 * script's own header states.
 *
 * THE COMMAND GOES UNDER `ticketCommand`, NOT `event`. The envelope's arms are
 * told apart by `command`, so the ticket command a `Decide` carries needs a
 * field of another name. `public_ticket_command_is_valid` refuses a `Decide`
 * still naming `event` rather than ignoring it, for 013's reason: the only
 * writer that could is an image of the earlier vintage.
 *
 * `decision_command_is_valid` IS REBUILT WHOLE OVER THE TICKET COMMANDS. A
 * report is weighed as the journal weighs it, since the command and the event
 * carry the same report. A finalization result carries its cycle, its
 * generation and its evidence in the arm the result is. Every tag the inbox
 * took before is refused. Both exclusions stay, at the new names: no caller
 * may offer a release, and none may offer a finalization result or a dispatch.
 *
 * THE MAILBOX CLASSIFIES AT THE NEW TAGS. A revocation keeps the safety
 * priority. The dispatch leaves the ordinary list, where it has been
 * unreachable since 013 excluded it; a principal dispatches through
 * `accept_dispatch_operation`, which classifies as a resume and is rewritten
 * whole for the field it builds its stand-in under. The authority check and the
 * finalizer's door follow the completion tags, the door rewritten whole for the
 * tag it stores; what it stores is still its own submission, and the writer
 * builds the finalization command from it.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE, for the report's ticket and the
 * command it builds. Its signature does not move.
 *
 * A REFUSED INPUT STORES ITS REFUSAL. `decision_input.refusal` is text, as
 * `operation.command` and `journal_entry.entry` are, because it is the codec's
 * own spelling and is read back through the codec. The code is one the writer
 * decides or the boundary does, and a refusal is present exactly when the
 * code is the machine's: `decision_refusal_is_valid` weighs it against the
 * code. The ticket service may execute it, because the check runs on every
 * write the service makes to the row.
 */

/** The tags a ticket command is at, as the generated codec spells them. */
const createTag = "CreateTicket";
const dispatchTag = "DispatchTicket";
const revokeTag = "RevokeTicket";
const resumeTag = "ResumeTicket";
const reportTag = "ReportTaskTerminal";
const finalizationTag = "ReportFinalizationResult";

/** The field of a `Decide` envelope the ticket command is under. */
const decideField = "ticketCommand";

/** The journal's tags whose events carry a task terminal report. */
const evaluationProgressedTag = "TicketEvaluationProgressed";
const evaluationPassedTag = "TicketEvaluationPassed";
const evaluationBlockedTag = "TicketEvaluationBlocked";
const reworkStartedTag = "TicketEvaluationReworkStarted";
const failureEscalatedTag = "TicketEvaluationFailureEscalated";

/** The journal's other tags, which 014 named and this reads unchanged. */
const createdTag = "TicketCreated";
const dispatchedTag = "TicketDispatched";
const revokedTag = "TicketRevoked";
const workResumedTag = "TicketWorkResumed";
const evaluationResumedTag = "TicketEvaluationResumed";
const finalizationResumedTag = "TicketFinalizationResumed";
const workAcceptedTag = "TicketWorkResultAccepted";
const workFailedTag = "TicketWorkProcessFailed";
const workUnavailableTag = "TicketWorkExecutionUnavailable";
const finalizationSucceededTag = "TicketFinalizationSucceeded";
const finalizationNeedsWorkTag = "TicketFinalizationNeedsWork";
const finalizationUnavailableTag = "TicketFinalizationUnavailable";

/** The arms of a finalization result. */
const finalizationResults = [
  "FinalizationSucceeded",
  "FinalizationNeedsWork",
  "FinalizationResultUnavailable",
];

/** The fields those records carry, as the codec spells them. */
const ticketField = "ticket";
const sourceField = "source";
const resultField = "result";
const acceptedSourceField = "acceptedSourceRef";
const taskField = "task";
const evidenceField = "evidence";
const reportField = "report";
const failureField = "failure";
const workCycleField = "workCycle";
const generationField = "generation";
const reworkEvaluatorField = "evaluator";
const resultReferenceField = "resultRef";
const obligationField = "obligation";
const obligationDefinitionField = "definition";
const obligationContextField = "contextRef";
const dependenciesField = "dependencies";
const expectedField = "expected";
const currentField = "current";

/** The released ticket's fields the door reads, which 013 named. */
const releasedIdField = "id";
const releasedWorkField = "workConfiguration";
const releasedPlanField = "evaluationPlan";
const releasedStagesField = "stages";
const stageKeyField = "key";
const stageEvaluatorsField = "evaluators";
const evaluatorKeyField = "key";
const evaluatorTaskField = "task";

/** The machine's refusals whose payload is the ticket alone. */
const ticketRefusals = [
  "TicketAlreadyExists",
  "SelfDependency",
  "TicketNotFound",
  "TicketNotPending",
  "TicketIdentityMismatch",
  "TicketDependenciesChanged",
  "TicketNotRevocable",
  "TicketNotResumable",
];
const dependenciesNotFound = "DependenciesNotFound";
const dependenciesIncomplete = "DependenciesIncomplete";
const revisionStale = "TicketRevisionStale";
const taskNotCurrent = "TaskNotCurrent";
const finalizationNotCurrent = "FinalizationNotCurrent";

/** Every refusal the machine decides, each stored with its payload. */
const domainRefusals = [
  ...ticketRefusals,
  dependenciesNotFound,
  dependenciesIncomplete,
  revisionStale,
  taskNotCurrent,
  finalizationNotCurrent,
];

/** The boundary's own refusals, which carry no payload. */
const boundaryRefusals = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
];

/** The predicates 013 and 014 stated, and the ones this states beside them. */
const referencePredicate = "command_reference";
const releasedPredicate = "released_ticket_is_valid";
const identityPredicate = "task_identity_is_valid";
const validatedResultPredicate = "validated_task_result_is_valid";
const reportPredicate = "task_report_is_valid";
const commandValidator = "decision_command_is_valid";
const refusalValidator = "decision_refusal_is_valid";

function textList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration015: Migration = {
  version: 15,
  name: "the inbox holds ticket commands, and a refusal keeps what was refused",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry)
            OR EXISTS (SELECT FROM public.operation) THEN
           RAISE EXCEPTION 'this image reads no journal or operation written before it; empty them with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE OR REPLACE FUNCTION public.${reportPredicate}(report jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT ${referencePredicate}(report->'value'->'${ticketField}') AND CASE report->>'type'
         WHEN 'WorkResultReport' THEN
           ${validatedResultPredicate}(report->'value'->'${resultField}')
           AND ${referencePredicate}(report->'value'->'${acceptedSourceField}')
         WHEN 'EvaluationResultReport' THEN
           ${validatedResultPredicate}(report->'value'->'${resultField}')
           AND COALESCE(report->'value'->>'verdict', '') IN ('EvaluatorPass', 'EvaluatorFail')
         WHEN 'TerminalFailureReport' THEN
           ${identityPredicate}(report->'value'->'${failureField}'->'${taskField}')
           AND ${referencePredicate}(report->'value'->'${failureField}'->'${evidenceField}')
           AND COALESCE(report->'value'->>'kind', '')
             IN ('ProcessFailure', 'ExecutionUnavailableFailure')
         ELSE false
       END
     $$`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') IS DISTINCT FROM 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag = '${createdTag}' THEN
         RETURN ${releasedPredicate}(value);
       END IF;
       IF tag IN ('${revokedTag}', '${workResumedTag}', '${evaluationResumedTag}',
                  '${finalizationResumedTag}') THEN
         RETURN ${referencePredicate}(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag = '${dispatchedTag}' THEN
         RETURN ${referencePredicate}(value->'${sourceField}');
       END IF;
       IF tag = '${workAcceptedTag}' THEN
         RETURN ${validatedResultPredicate}(value->'${resultField}')
           AND ${referencePredicate}(value->'${acceptedSourceField}');
       END IF;
       IF tag IN ('${workFailedTag}', '${workUnavailableTag}') THEN
         RETURN ${identityPredicate}(value->'${taskField}')
           AND ${referencePredicate}(value->'${evidenceField}');
       END IF;
       IF tag IN ('${evaluationProgressedTag}', '${evaluationPassedTag}',
                  '${evaluationBlockedTag}', '${reworkStartedTag}',
                  '${failureEscalatedTag}')
          AND (NOT ${reportPredicate}(value->'${reportField}')
               OR value->'${reportField}'->'value'->'${ticketField}'
                  IS DISTINCT FROM value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag IN ('${evaluationProgressedTag}', '${evaluationPassedTag}',
                  '${evaluationBlockedTag}') THEN
         RETURN true;
       END IF;
       IF tag IN ('${reworkStartedTag}', '${failureEscalatedTag}') THEN
         IF jsonb_typeof(value->'${evidenceField}') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'${evidenceField}') < 1 THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'${evidenceField}') AS elements(element) LOOP
           IF NOT ${referencePredicate}(item->'${reworkEvaluatorField}')
              OR NOT ${referencePredicate}(item->'${resultReferenceField}') THEN
             RETURN false;
           END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF tag IN ('${finalizationSucceededTag}', '${finalizationNeedsWorkTag}',
                  '${finalizationUnavailableTag}') THEN
         RETURN ${referencePredicate}(value->'${workCycleField}')
           AND ${referencePredicate}(value->'${generationField}')
           AND ${referencePredicate}(value->'${evidenceField}');
       END IF;
       RETURN false;
     END $$`,
    `DROP FUNCTION public.${commandValidator}(event jsonb)`,
    `CREATE FUNCTION public.${commandValidator}(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb;
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'type') IS DISTINCT FROM 'string' THEN
         RETURN false;
       END IF;
       tag := command->>'type'; value := command->'value';
       IF tag = '${createTag}' THEN
         RETURN NOT (value ? 'deps' OR value ? 'prog')
           AND ${releasedPredicate}(value);
       END IF;
       IF tag IN ('${revokeTag}', '${resumeTag}') THEN
         RETURN ${referencePredicate}(value);
       END IF;
       IF tag = '${reportTag}' THEN
         RETURN ${reportPredicate}(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF tag = '${dispatchTag}' THEN
         RETURN ${referencePredicate}(value->'${sourceField}');
       END IF;
       IF tag = '${finalizationTag}' THEN
         RETURN ${referencePredicate}(value->'${workCycleField}')
           AND ${referencePredicate}(value->'${generationField}')
           AND COALESCE(value->'${resultField}'->>'type', '')
             IN (${textList(finalizationResults)})
           AND ${referencePredicate}(value->'${resultField}'->'value');
       END IF;
       RETURN false;
     END $$`,
    `ALTER FUNCTION public.${commandValidator}(command jsonb) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${commandValidator}(command jsonb) FROM PUBLIC`,
    `CREATE OR REPLACE FUNCTION public.public_ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     BEGIN
       IF command IS NULL OR jsonb_typeof(command) <> 'object'
          OR jsonb_typeof(command->'version') <> 'number'
          OR command->>'version' <> '1' THEN
         RETURN false;
       END IF;
       IF command->>'command' = 'Decide' THEN
         RETURN NOT command ? 'event'
           AND ${commandValidator}(command->'${decideField}')
           AND command->'${decideField}'->>'type' <> '${createTag}';
       END IF;
       IF command->>'command' = 'ReleaseDraft' THEN
         RETURN command_integer(command->'ticket') AND (command->>'ticket')::numeric >= 1
           AND command_integer(command->'authoringVersion') AND (command->>'authoringVersion')::numeric >= 1
           AND jsonb_typeof(command->'configurationRevision')='string'
           AND length(command->>'configurationRevision') BETWEEN 1 AND 256;
       END IF;
       RETURN command->>'command' = 'ResolveNativeAction'
         AND jsonb_typeof(command->'action') = 'string'
         AND length(command->>'action') BETWEEN 1 AND 256
         AND command_integer(command->'authorizingSeq')
         AND (command->>'authorizingSeq')::numeric >= 1
         AND command->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline');
     END $$`,
    `CREATE OR REPLACE FUNCTION public.ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
       BEGIN
         IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
           RETURN false;
         END IF;
         IF command->>'command' = 'SubmitFinalizationResult' THEN
           RETURN jsonb_typeof(command->'version') = 'number'
             AND command->>'version' = '1'
             AND jsonb_typeof(command->'request') = 'string'
             AND length(command->>'request') BETWEEN 1 AND 256
             AND (command->'attempt' IS NULL
               OR (jsonb_typeof(command->'attempt') = 'string'
                 AND length(command->>'attempt') BETWEEN 1 AND 256))
             AND command_integer(command->'requestGeneration')
             AND (command->>'requestGeneration')::numeric >= 1
             AND jsonb_typeof(command->'recoveryEpoch') = 'string'
             AND length(command->>'recoveryEpoch') BETWEEN 1 AND 256
             AND command->>'outcome' IN ('FinalizationSucceeded', 'FinalizationFailed',
               'FinalizationNeedsWork', 'FinalizationResultUnavailable')
             AND (command->'kind' IS NOT NULL)
               = (command->>'outcome' = 'FinalizationResultUnavailable')
             AND (command->'kind' IS NULL
               OR (jsonb_typeof(command->'kind') = 'string'
                 AND length(command->>'kind') BETWEEN 1 AND 256));
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'${decideField}'->>'type' NOT IN ('${finalizationTag}', '${dispatchTag}'));
       END $$`,
    `CREATE OR REPLACE FUNCTION public.accept_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) RETURNS TABLE(result text, operation text, ordinal bigint, state text, authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE project_lifecycle text; project_generation bigint; next_ordinal bigint;
       pending_total bigint; pending_ordinary bigint; existing record;
       command_value jsonb; command_tag text; priority text; admission_class text;
       action_id text; authorizing_sequence bigint; action_resolution text;
     BEGIN
       IF cardinality(in_retained_key_digests) <> cardinality(in_retained_payload_digests) THEN
         RAISE EXCEPTION 'idempotency digest arrays disagree';
       END IF;

       BEGIN
         command_value := in_command::jsonb;
       EXCEPTION WHEN others THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_value->>'command' = 'Decide'
          AND jsonb_typeof(command_value->'${decideField}') = 'object' THEN
         command_tag := command_value->'${decideField}'->>'type';
       ELSIF command_value->>'command' = 'ReleaseDraft' THEN
         command_tag := 'ReleaseDraft';
       ELSIF command_value->>'command' = 'ResolveNativeAction'
          AND jsonb_typeof(command_value->'action') = 'string'
          AND length(command_value->>'action') BETWEEN 1 AND 256
          AND jsonb_typeof(command_value->'authorizingSeq') = 'number'
          AND (command_value->>'authorizingSeq') ~ '^[1-9][0-9]*$'
          AND command_value->>'resolution' IN ('Resume', 'Revoke', 'Approve', 'Decline') THEN
         command_tag := 'ResolveNativeAction';
         action_id := command_value->>'action';
         BEGIN
           authorizing_sequence := (command_value->>'authorizingSeq')::bigint;
         EXCEPTION WHEN numeric_value_out_of_range THEN
           RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
           RETURN;
         END;
         action_resolution := command_value->>'resolution';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       IF command_tag = '${revokeTag}' OR
          (command_tag = 'ResolveNativeAction' AND action_resolution = 'Revoke') THEN
         priority := 'Safety'; admission_class := 'CorrectnessReducing';
       ELSIF command_tag IN ('ReleaseDraft', '${resumeTag}') OR
             (command_tag = 'ResolveNativeAction' AND action_resolution IN ('Resume', 'Approve', 'Decline')) THEN
         priority := 'Ordinary'; admission_class := 'Ordinary';
       ELSE
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT p.lifecycle, p.lifecycle_generation INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant=in_tenant AND p.project=in_project FOR UPDATE;

       SELECT o.operation, d.ordinal, d.state, o.authority_kind, o.admission,
              d.lifecycle_generation, offered.payload_digest AS offered_payload, o.payload_digest
         INTO existing
         FROM unnest(in_retained_key_digests, in_retained_payload_digests)
              AS offered(key_digest, payload_digest)
         JOIN operation o ON o.tenant=in_tenant AND o.project=in_project
              AND o.authority_kind=in_authority_kind AND o.key_digest=offered.key_digest
         JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
         ORDER BY (o.payload_digest = offered.payload_digest) DESC
         LIMIT 1;
       IF FOUND THEN
         IF existing.payload_digest IS DISTINCT FROM existing.offered_payload THEN
           RETURN QUERY SELECT 'IdempotencyConflict'::text, NULL::text, NULL::bigint,
             NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         ELSE
           RETURN QUERY SELECT 'Original'::text, existing.operation::text,
             existing.ordinal::bigint, existing.state::text, existing.authority_kind::text,
             existing.admission::text, existing.lifecycle_generation::bigint, NULL::text;
         END IF;
         RETURN;
       END IF;

       IF command_tag='ResolveNativeAction' AND NOT EXISTS (
         SELECT 1 FROM native_action a JOIN native_action_resolution r
           USING (tenant, project, action)
          WHERE a.tenant=in_tenant AND a.project=in_project AND a.action=action_id
            AND a.state='Open' AND a.authorizing_seq=authorizing_sequence
            AND r.resolution=action_resolution FOR UPDATE OF a)
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF command_tag='ReleaseDraft' AND NOT EXISTS (
         SELECT 1 FROM draft_revision r
          WHERE r.tenant=in_tenant AND r.project=in_project
            AND r.ticket=(command_value->>'ticket')::bigint
            AND r.authoring_version=(command_value->>'authoringVersion')::bigint
            AND r.configuration_revision=command_value->>'configurationRevision')
       THEN
         RETURN QUERY SELECT 'InvalidCommand'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;

       SELECT count(*), count(*) FILTER (WHERE d.base_priority='Ordinary')
         INTO pending_total, pending_ordinary FROM decision_input d
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Pending';
       IF pending_total >= in_hard_limit THEN
         RETURN QUERY SELECT 'Unavailable'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF priority='Ordinary' AND pending_ordinary >= in_ordinary_soft_limit THEN
         RETURN QUERY SELECT 'Backpressure'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text;
         RETURN;
       END IF;
       IF NOT (project_lifecycle = 'Active' OR
          (admission_class = 'CorrectnessReducing' AND
           project_lifecycle IN ('Suspended', 'IntegrityBlocked', 'Deleting'))) THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint,
           NULL::text, NULL::text, NULL::text, NULL::bigint, project_lifecycle;
         RETURN;
       END IF;

       UPDATE project p SET ingress_next=p.ingress_next+1
        WHERE p.tenant=in_tenant AND p.project=in_project
        RETURNING p.ingress_next-1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag, via_session)
       VALUES (in_tenant, in_project, in_operation, in_authority_kind, in_authority_subject,
          admission_class, in_key_version, in_key_digest, in_payload_digest, in_command, command_tag,
          in_via_session);
       INSERT INTO decision_input (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation, priority, project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready=true, generation=project_readiness.generation+1;
       RETURN QUERY SELECT 'Accepted'::text, in_operation, next_ordinal, 'Pending'::text,
         in_authority_kind, admission_class, project_generation, NULL::text;
     END $_$`,
    `CREATE OR REPLACE FUNCTION public.accept_dispatch_operation(in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text) RETURNS TABLE(result text, operation text, ordinal bigint, state text, authority_kind text, admission text, lifecycle_generation bigint, lifecycle text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
     DECLARE command_value jsonb; ticket_value bigint; accepted record;
     BEGIN
       BEGIN command_value:=in_command::jsonb;
       EXCEPTION WHEN others THEN RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
         NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'version'<>'1'
          OR command_value->>'command' NOT IN ('ManualDispatch','ProposeDispatch')
          OR NOT command_integer(command_value->'ticket')
          OR (command_value->>'ticket') !~ '^[1-9][0-9]*$'
          OR NOT command_integer(command_value->'expectedTicketVersion')
          OR (command_value->>'expectedTicketVersion') !~ '^[1-9][0-9]*$' THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       BEGIN ticket_value:=(command_value->>'ticket')::bigint;
       EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'InvalidCommand'::text,
         NULL::text,NULL::bigint,NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN; END;
       IF command_value->>'command'='ProposeDispatch' AND (
          jsonb_typeof(command_value->'observedViewToken')<>'object'
          OR command_value->'observedViewToken'->>'tenant'<>in_tenant
          OR command_value->'observedViewToken'->>'project'<>in_project
          OR jsonb_typeof(command_value->'observedViewToken'->'recoveryEpoch')<>'string'
          OR length(command_value->'observedViewToken'->>'recoveryEpoch') NOT BETWEEN 1 AND 256
          OR command_value->'observedViewToken'->>'schemaVersion'<>'1'
          OR NOT command_integer(command_value->'observedViewToken'->'watermark')
          OR (command_value->'observedViewToken'->>'watermark') !~ '^(0|[1-9][0-9]*)$'
          OR (command_value->'observedViewToken'->>'digest') !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(command_value->'selectorDecisionReference')<>'string'
          OR length(command_value->>'selectorDecisionReference') NOT BETWEEN 1 AND 256) THEN
         RETURN QUERY SELECT 'InvalidCommand'::text,NULL::text,NULL::bigint,
           NULL::text,NULL::text,NULL::text,NULL::bigint,NULL::text; RETURN;
       END IF;
       SELECT * INTO accepted FROM accept_operation(
         in_tenant,in_project,in_operation,in_authority_kind,in_authority_subject,
         in_key_version,in_key_digest,in_payload_digest,in_retained_key_digests,
         in_retained_payload_digests,jsonb_build_object('version',1,'command','Decide',
           '${decideField}',jsonb_build_object('type','${resumeTag}','value',ticket_value))::text,
         in_ordinary_soft_limit,in_hard_limit,in_via_session);
       IF accepted.result='Accepted' THEN UPDATE operation AS stored
         SET command=in_command,command_tag=command_value->>'command'
         WHERE stored.tenant=in_tenant AND stored.project=in_project
           AND stored.operation=in_operation; END IF;
       RETURN QUERY SELECT accepted.result::text,accepted.operation::text,accepted.ordinal::bigint,
         accepted.state::text,accepted.authority_kind::text,accepted.admission::text,
         accepted.lifecycle_generation::bigint,accepted.lifecycle::text;
     END $_$`,
    `ALTER TABLE public.operation
       DROP CONSTRAINT operation_completion_authority_is_its_boundary,
       ADD CONSTRAINT operation_completion_authority_is_its_boundary CHECK (
CASE command_tag
    WHEN '${reportTag}'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN '${finalizationTag}'::text THEN (authority_kind = 'Finalizer'::text)
    ELSE true
END) NOT VALID`,
    `CREATE OR REPLACE FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN ('FinalizationSucceeded', 'FinalizationFailed',
           'FinalizationNeedsWork', 'FinalizationResultUnavailable') THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch, f.kind,
              f.hold_kind,
              a.attempt, a.outcome AS attempt_outcome, a.failure_kind,
              p.state AS permit_state, r.verdict, w.finalization_mode AS landing
         INTO bound
         FROM finalization_request f
         LEFT JOIN draft_brief w
           ON w.tenant = f.tenant AND w.project = f.project AND w.ticket = f.ticket
         LEFT JOIN finalization_attempt a
           ON a.tenant = f.tenant AND a.project = f.project
              AND a.request = f.request AND a.attempt = in_attempt
         LEFT JOIN commit_permit p
           ON p.tenant = a.tenant AND p.project = a.project AND p.attempt = a.attempt
         LEFT JOIN finalization_reconciliation r
           ON r.tenant = p.tenant AND r.project = p.project AND r.permit = p.permit
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownRequest'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT o.operation INTO settled FROM operation o
        WHERE o.tenant = in_tenant AND o.project = in_project
          AND o.authority_kind = 'Finalizer' AND o.key_digest = scoped_digest;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, settled,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = settled);
         RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.state NOT IN ('Open', 'Registered')
          OR bound.request_generation <> in_request_generation
          OR bound.recovery_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR (bound.attempt IS NULL
            AND in_outcome <> 'FinalizationResultUnavailable'
            AND NOT (in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None'))
          OR NOT (
            (in_outcome IN ('FinalizationFailed', 'FinalizationNeedsWork')
              AND bound.kind = 'RunFinalizer'
              AND bound.attempt_outcome = 'Failed'
              AND bound.failure_kind IS NOT DISTINCT FROM in_failure_kind)
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Prepared'
              AND bound.permit_state IS NOT DISTINCT FROM 'Concluded'
              AND bound.verdict IS NOT DISTINCT FROM 'Promoted')
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND in_attempt IS NULL
              AND bound.landing IS NOT DISTINCT FROM 'None')
            OR (in_outcome = 'FinalizationResultUnavailable'
              AND bound.kind = 'RunFinalizer'
              AND in_attempt IS NULL
              AND bound.hold_kind IS NOT NULL
              AND bound.hold_kind IS NOT DISTINCT FROM in_failure_kind))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       command_value := jsonb_build_object('version', 1,
         'command', 'SubmitFinalizationResult', 'request', in_request,
         'requestGeneration', in_request_generation,
         'recoveryEpoch', in_recovery_epoch, 'outcome', in_outcome)
         || CASE WHEN in_attempt IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('attempt', in_attempt) END
         || CASE WHEN in_outcome = 'FinalizationResultUnavailable'
                 THEN jsonb_build_object('kind', in_failure_kind)
                 ELSE '{}'::jsonb END;
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the finalization result this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'Finalizer',
          in_authority_subject, 'CorrectnessReducing', 'finalizer-v1',
          scoped_digest,
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, '${finalizationTag}');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; observed record; project_lifecycle text;
       project_generation bigint; next_ordinal bigint; command_value jsonb;
       identity jsonb; report jsonb; released jsonb; definition jsonb;
       obligation jsonb; produced jsonb; accepted bigint;
       context_reference bigint; failure jsonb;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked', 'ProcessFailed') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict,
              t.kind AS task_kind, t.cycle, t.stage, t.generation, t.evaluator
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
         JOIN execution_request_task t
           ON t.tenant = e.tenant AND t.project = e.project
          AND t.request = e.source_request AND t.task = e.task
         LEFT JOIN execution_result r
           ON r.tenant = e.tenant AND r.project = e.project AND r.execution = e.execution
        WHERE e.tenant = in_tenant AND e.project = in_project AND e.execution = in_execution
        FOR UPDATE OF e;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownExecution'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.completion_operation IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadySubmitted'::text, bound.completion_operation::text,
           (SELECT d.ordinal FROM decision_input d
             WHERE d.tenant = in_tenant AND d.project = in_project
               AND d.input_kind = 'Operation' AND d.input_id = bound.completion_operation);
         RETURN;
       END IF;
       IF bound.status IN ('Terminal', 'Cancelled')
          OR bound.ticket <> in_ticket OR bound.task <> in_task
          OR bound.effect_position <> in_source_effect
          OR (in_outcome = 'Blocked') <> (in_manifest IS NULL)
          OR (in_outcome = 'Blocked') <> (in_reason IS NOT NULL)
          OR (in_reason IS NOT NULL AND in_reason NOT IN ('ExecutionPolicyDenied', 'TicketConfigIncompatible', 'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported', 'RequiredCapabilityUnavailable'))
          OR (in_manifest IS NOT NULL
              AND (bound.manifest IS DISTINCT FROM in_manifest
                   OR bound.digest IS DISTINCT FROM in_manifest_digest))
          OR (in_outcome <> 'Blocked'
              AND (bound.verdict IS NULL
                   OR (in_outcome = 'Passed') <> (bound.verdict = 'Pass')))
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       SELECT p.lifecycle, p.lifecycle_generation
         INTO STRICT project_lifecycle, project_generation
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF bound.task_kind = 'Work' THEN
         identity := jsonb_build_object('type', 'WorkTask', 'value',
           jsonb_build_object('ticket', bound.ticket, 'cycle', bound.cycle));
       ELSE
         identity := jsonb_build_object('type', 'EvaluationTask', 'value',
           jsonb_build_object('ticket', bound.ticket, 'workCycle', bound.cycle,
             'stage', bound.stage, 'generation', bound.generation,
             'evaluator', bound.evaluator));
       END IF;
       failure := jsonb_build_object('${taskField}', identity,
         '${evidenceField}', bound.task);
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('${ticketField}', bound.ticket,
             '${failureField}', failure, 'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('${ticketField}', bound.ticket,
             '${failureField}', failure, 'kind', 'ProcessFailure'));
       ELSE
         SELECT (j.entry::jsonb)->'event'->'value' INTO released
           FROM journal_entry j
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->>'type' END)
                = '${createdTag}'::text
            AND (CASE WHEN j.entry IS JSON OBJECT
                      THEN j.entry::jsonb->'event'->'value'->'${releasedIdField}' END)
                = to_jsonb(bound.ticket)
          LIMIT 1;
         IF bound.task_kind = 'Work' THEN
           definition := released->'${releasedWorkField}';
           context_reference := bound.cycle;
         ELSE
           SELECT evaluators.evaluator->'${evaluatorTaskField}' INTO definition
             FROM jsonb_array_elements(released->'${releasedPlanField}'->'${releasedStagesField}')
                    AS stages(stage),
                  jsonb_array_elements(stages.stage->'${stageEvaluatorsField}')
                    AS evaluators(evaluator)
            WHERE (stages.stage->>'${stageKeyField}')::bigint = bound.stage
              AND (evaluators.evaluator->>'${evaluatorKeyField}')::bigint = bound.evaluator;
           SELECT result_digest_fold(w.digest) INTO context_reference
             FROM execution e2
             JOIN execution_request_task t2
               ON t2.tenant = e2.tenant AND t2.project = e2.project
              AND t2.request = e2.source_request AND t2.task = e2.task
             JOIN execution_result w
               ON w.tenant = e2.tenant AND w.project = e2.project
              AND w.execution = e2.execution
            WHERE e2.tenant = in_tenant AND e2.project = in_project
              AND e2.ticket = bound.ticket
              AND t2.kind = 'Work' AND t2.cycle = bound.cycle
              AND w.verdict = 'Pass'
            LIMIT 1;
           IF NOT FOUND THEN
             RETURN QUERY SELECT '${workResultUnrecordedResult}'::text, NULL::text, NULL::bigint;
             RETURN;
           END IF;
         END IF;
         obligation := jsonb_build_object(
           '${taskField}', identity,
           '${obligationDefinitionField}', definition,
           '${obligationContextField}', context_reference);
         produced := jsonb_build_object('${obligationField}', obligation,
           '${resultReferenceField}', result_digest_fold(bound.digest));
         IF bound.task_kind = 'Evaluation' THEN
           report := jsonb_build_object('type', 'EvaluationResultReport', 'value',
             jsonb_build_object('${ticketField}', bound.ticket, 'result', produced,
               'verdict', CASE WHEN bound.verdict = 'Pass'
                 THEN 'EvaluatorPass' ELSE 'EvaluatorFail' END));
         ELSE
           SELECT s.repository, s.commit, s.ref INTO observed
             FROM execution_result_source s
            WHERE s.tenant = in_tenant AND s.project = in_project
              AND s.manifest = bound.manifest;
           IF FOUND THEN
             accepted := result_digest_fold(observed.commit);
             INSERT INTO ticket_source
               (tenant, project, ticket, source, repository, commit, ref)
             VALUES (in_tenant, in_project, bound.ticket, accepted,
               observed.repository, observed.commit, observed.ref)
             ON CONFLICT (tenant, project, ticket, source) DO NOTHING;
           ELSIF EXISTS (SELECT FROM ticket_source t
                          WHERE t.tenant = in_tenant AND t.project = in_project
                            AND t.ticket = bound.ticket AND t.repository IS NOT NULL) THEN
             RETURN QUERY SELECT '${sourceUnrecordedResult}'::text, NULL::text, NULL::bigint;
             RETURN;
           ELSE
             SELECT t.source INTO accepted FROM ticket_source t
              WHERE t.tenant = in_tenant AND t.project = in_project
                AND t.ticket = bound.ticket LIMIT 1;
           END IF;
           report := jsonb_build_object('type', 'WorkResultReport', 'value',
             jsonb_build_object('${ticketField}', bound.ticket, 'result', produced,
               '${acceptedSourceField}', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide',
         '${decideField}', jsonb_build_object('type', '${reportTag}', 'value', report));
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the completion this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       UPDATE project p SET ingress_next = p.ingress_next + 1
        WHERE p.tenant = in_tenant AND p.project = in_project
        RETURNING p.ingress_next - 1 INTO next_ordinal;
       INSERT INTO operation
         (tenant, project, operation, authority_kind, authority_subject, admission,
          key_version, key_digest, payload_digest, command, command_tag)
       VALUES (in_tenant, in_project, in_operation, 'ExecutionScheduler',
          in_authority_subject, 'CorrectnessReducing', 'scheduler-v1',
          encode(sha256(convert_to('execution:' || in_execution, 'UTF8')), 'hex'),
          encode(sha256(convert_to(command_value::text, 'UTF8')), 'hex'),
          command_value::text, '${reportTag}');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
       UPDATE execution
          SET status = 'Terminal',
              outcome = in_outcome,
              blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$`,
    `CREATE FUNCTION public.${refusalValidator}(code text, refusal text) RETURNS boolean
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
         RETURN ${referencePredicate}(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${ticketField}') THEN
         RETURN false;
       END IF;
       IF code IN ('${dependenciesNotFound}', '${dependenciesIncomplete}') THEN
         IF jsonb_typeof(value->'${dependenciesField}') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'${dependenciesField}') < 1
            OR (SELECT count(DISTINCT element)
                  FROM jsonb_array_elements(value->'${dependenciesField}') AS elements(element))
               <> jsonb_array_length(value->'${dependenciesField}') THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'${dependenciesField}') AS elements(element) LOOP
           IF NOT ${referencePredicate}(item) THEN RETURN false; END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF code = '${revisionStale}' THEN
         RETURN ${referencePredicate}(value->'${expectedField}')
           AND ${referencePredicate}(value->'${currentField}');
       END IF;
       IF code = '${taskNotCurrent}' THEN
         RETURN ${identityPredicate}(value->'${taskField}');
       END IF;
       IF code = '${finalizationNotCurrent}' THEN
         RETURN ${referencePredicate}(value->'${workCycleField}')
           AND ${referencePredicate}(value->'${generationField}');
       END IF;
       RETURN false;
     END $$`,
    `ALTER FUNCTION public.${refusalValidator}(code text, refusal text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${refusalValidator}(code text, refusal text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION public.${refusalValidator}(code text, refusal text) TO ${ticketServiceRole}`,
    `ALTER TABLE public.decision_input
       ADD COLUMN refusal text,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])})))),
       ADD CONSTRAINT decision_input_refusal_is_its_outcome CHECK ((
CASE
    WHEN (outcome_code = ANY (${textArray(domainRefusals)})) THEN (${refusalValidator}(outcome_code, refusal) IS TRUE)
    ELSE (refusal IS NULL)
END))`,
    `GRANT UPDATE(refusal) ON TABLE public.decision_input TO ${ticketServiceRole}`,
    `GRANT SELECT(refusal) ON TABLE public.decision_input TO ${apiRole}`,
  ],
};
