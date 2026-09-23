import {
  boundaryOwnerRole,
  sourceUnrecordedResult,
  ticketServiceRole,
  workResultUnrecordedResult,
  type Migration,
} from "../shared.ts";

/**
 * The journal records what happened to a ticket, and the inbox keeps carrying
 * what was asked of it. A journal row stops being a command beside the record
 * of what deciding it did and becomes one ticket event: the release, the
 * dispatch, the revocation, the three resumes, what a work result or a work
 * failure came to, the five things an evaluator's report can do to a stage, and
 * the three answers a finalization gives. The command a caller or a boundary
 * submits stays in `operation.command`, in the vocabulary it had, less the
 * reduce that a work completion no longer needs.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A stored row carries a command and a
 * record, and the check this image installs refuses a row shaped that way: an
 * entry whose bytes are what its digest attests cannot be rewritten into an
 * event, so a journal with rows in it comes up holding a ticket the actor
 * cannot replay. The guard refuses the migration instead and names
 * `deploy/rig/wipe-tickets.sql`, which is what empties the journal it needs.
 *
 * `decision_event_is_valid` IS THE JOURNAL'S NOW, AND THE JOURNAL CALLS IT. It
 * was the event half of the mailbox's grammar and no journal row was ever
 * weighed by it, so a writer of any vintage could append a row this machine
 * then refused at replay. It is rebuilt whole over the ticket events and
 * `journal_entry_is_an_event` calls it on every insert, refusing an entry that
 * is not exactly its sequence and one event — a record beside the event is
 * refused for being there, a command's tag for having no arm. It runs on insert
 * and not as a CHECK because the reader is specified to refuse a row whose
 * bytes were altered after they were written, and a CHECK would make that row
 * unwritable by the only hand that alters one.
 *
 * THE MAILBOX'S GRAMMAR MOVES TO `decision_command_is_valid`. The body is
 * 013's with two moves: a terminal failure names the failed task beside its
 * evidence, which must be the task the completion names, and a finalization
 * result carries its evidence. `WorkReduce` had no arm there already, and a
 * completion naming a disposition is refused as it was.
 * `public_ticket_command_is_valid` calls it under its new name and keeps both
 * exclusions — no `Decide` a caller offers may carry a release, and none may
 * carry a finalization or a dispatch.
 *
 * A PASS NO LONGER WAITS FOR A REDUCE, so `project_continuation` goes, with
 * `publish_continuation`, the input kind and the priority it published under,
 * the one state only a continuation reached, and the head index that read it.
 * Their grants leave with them.
 *
 * THE DESK IS ONE PER DECISION. An escalation opens its desk task from the
 * transition itself rather than from a numbered effect, so the unique that
 * stopped a task being materialized twice is taken over the decision alone.
 * `effect_position` stays: `request_finalization_approval` still copies the
 * finalization request's into the approval it opens.
 *
 * A DEFERRED INPUT COUNTS ITS PASSES. `deferred_passes` and `deferred_since`
 * are what the settle that defers an unreadable source bumps, so a source that
 * stays transient is refused after a bound rather than deferred forever.
 *
 * THE RELEASE INDEX AND THE COMPLETION DOOR READ `TicketCreated`, the one tag
 * a release is journalled at. The door is rewritten whole for that and for the
 * failure it reports, which names the task it already builds the identity of;
 * its signature does not move, and it never named a disposition.
 */

/** The tags a journal row's event is at, as the generated codec spells them. */
const createdTag = "TicketCreated";
const dispatchedTag = "TicketDispatched";
const revokedTag = "TicketRevoked";
const workResumedTag = "TicketWorkResumed";
const evaluationResumedTag = "TicketEvaluationResumed";
const finalizationResumedTag = "TicketFinalizationResumed";
const workAcceptedTag = "TicketWorkResultAccepted";
const workFailedTag = "TicketWorkProcessFailed";
const workUnavailableTag = "TicketWorkExecutionUnavailable";
const evaluationProgressedTag = "TicketEvaluationProgressed";
const evaluationPassedTag = "TicketEvaluationPassed";
const reworkStartedTag = "TicketEvaluationReworkStarted";
const failureEscalatedTag = "TicketEvaluationFailureEscalated";
const evaluationBlockedTag = "TicketEvaluationBlocked";
const finalizationSucceededTag = "TicketFinalizationSucceeded";
const finalizationNeedsWorkTag = "TicketFinalizationNeedsWork";
const finalizationUnavailableTag = "TicketFinalizationUnavailable";

/** The fields those events' records carry, as the codec spells them. */
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

/** The released ticket's fields, which 013 named and this reads unchanged. */
const releasedIdField = "id";
const releasedContentField = "content";
const releasedDependenciesField = "dependencies";
const releasedWorkField = "workConfiguration";
const releasedPlanField = "evaluationPlan";
const releasedStagesField = "stages";
const releasedFinalizationField = "finalizationConfiguration";
const stageKeyField = "key";
const stageEvaluatorsField = "evaluators";
const evaluatorKeyField = "key";
const evaluatorTaskField = "task";

/** The predicates 013 stated once, and the ones this states beside them. */
const referencePredicate = "command_reference";
const taskDefinitionPredicate = "command_task_definition";
const releasedPredicate = "released_ticket_is_valid";
const identityPredicate = "task_identity_is_valid";
const validatedResultPredicate = "validated_task_result_is_valid";
const reportPredicate = "task_report_is_valid";
const commandValidator = "decision_command_is_valid";
const journalCheck = "journal_entry_is_an_event";

/** Every predicate this installs, owned as 013's are and executed by nobody. */
const ownedPredicates = [
  `${releasedPredicate}(value jsonb)`,
  `${identityPredicate}(task jsonb)`,
  `${validatedResultPredicate}(result jsonb)`,
  `${reportPredicate}(report jsonb)`,
  `${commandValidator}(event jsonb)`,
  `${journalCheck}()`,
];

export const migration014: Migration = {
  version: 14,
  name: "the journal records ticket events, and a pass waits for no reduce",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `DROP TABLE public.project_continuation`,
    `DROP FUNCTION public.publish_continuation(in_tenant text, in_project text, in_ordinal bigint, in_continuation text)`,
    `DROP INDEX public.decision_input_continuation_head`,
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_kind_is_known,
       DROP CONSTRAINT decision_input_kind_state_agree,
       DROP CONSTRAINT decision_input_priority_is_known,
       DROP CONSTRAINT decision_input_state_is_known,
       ADD CONSTRAINT decision_input_kind_is_known CHECK ((input_kind = 'Operation'::text)),
       ADD CONSTRAINT decision_input_kind_state_agree CHECK (((input_kind = 'Operation'::text) AND (state = ANY (ARRAY['Pending'::text, 'Journaled'::text, 'Answered'::text, 'Refused'::text, 'Cancelled'::text])))),
       ADD CONSTRAINT decision_input_priority_is_known CHECK ((base_priority = ANY (ARRAY['Safety'::text, 'Completion'::text, 'Ordinary'::text]))),
       ADD CONSTRAINT decision_input_state_is_known CHECK ((state = ANY (ARRAY['Pending'::text, 'Journaled'::text, 'Answered'::text, 'Refused'::text, 'Cancelled'::text]))),
       ADD COLUMN deferred_passes integer DEFAULT 0 NOT NULL,
       ADD COLUMN deferred_since timestamp with time zone,
       ADD CONSTRAINT decision_input_deferred_passes_are_counted CHECK ((deferred_passes >= 0))`,
    `GRANT UPDATE(deferred_passes) ON TABLE public.decision_input TO ${ticketServiceRole}`,
    `GRANT UPDATE(deferred_since) ON TABLE public.decision_input TO ${ticketServiceRole}`,
    `DROP INDEX public.native_action_effect_is_materialized_once`,
    `CREATE UNIQUE INDEX native_action_decision_opens_one_desk ON public.native_action USING btree (tenant, project, authorizing_seq) WHERE (attempt IS NULL)`,
    `DROP INDEX public.journal_entry_release_ticket`,
    `CREATE INDEX journal_entry_release_ticket ON public.journal_entry USING btree (tenant, project, (
CASE
    WHEN (entry IS JSON OBJECT) THEN ((((entry)::jsonb -> 'event'::text) -> 'value'::text) -> '${releasedIdField}'::text)
    ELSE NULL::jsonb
END)) WHERE (
CASE
    WHEN (entry IS JSON OBJECT) THEN (((entry)::jsonb -> 'event'::text) ->> 'type'::text)
    ELSE NULL::text
END = '${createdTag}'::text)`,
    `CREATE FUNCTION public.${releasedPredicate}(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE item jsonb; entry jsonb; place bigint; stages jsonb; dependencies jsonb;
     BEGIN
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT ${referencePredicate}(value->'${releasedIdField}')
          OR NOT ${referencePredicate}(value->'${releasedContentField}')
          OR NOT ${referencePredicate}(value->'${releasedFinalizationField}')
          OR NOT ${taskDefinitionPredicate}(value->'${releasedWorkField}')
          OR jsonb_typeof(value->'${releasedDependenciesField}') IS DISTINCT FROM 'array'
          OR jsonb_typeof(value->'${releasedPlanField}') IS DISTINCT FROM 'object'
          OR jsonb_typeof(value->'${releasedPlanField}'->'${releasedStagesField}')
             IS DISTINCT FROM 'array' THEN
         RETURN false;
       END IF;
       dependencies := value->'${releasedDependenciesField}';
       stages := value->'${releasedPlanField}'->'${releasedStagesField}';
       IF (SELECT count(*) FROM jsonb_array_elements(dependencies)) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(dependencies) AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(dependencies) AS elements(element) LOOP
         IF NOT ${referencePredicate}(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item, place IN
         SELECT element, ordinality
           FROM jsonb_array_elements(stages) WITH ORDINALITY AS elements(element, ordinality)
       LOOP
         IF jsonb_typeof(item) <> 'object'
            OR NOT ${referencePredicate}(item->'${stageKeyField}')
            OR jsonb_typeof(item->'${stageEvaluatorsField}') IS DISTINCT FROM 'array' THEN
           RETURN false;
         END IF;
         IF (item->>'${stageKeyField}')::bigint <> place
            OR jsonb_array_length(item->'${stageEvaluatorsField}') < 1 THEN
           RETURN false;
         END IF;
         FOR entry IN SELECT element
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element) LOOP
           IF jsonb_typeof(entry) <> 'object'
              OR NOT ${referencePredicate}(entry->'${evaluatorKeyField}')
              OR NOT ${taskDefinitionPredicate}(entry->'${evaluatorTaskField}') THEN
             RETURN false;
           END IF;
         END LOOP;
         IF (SELECT count(DISTINCT element->'${evaluatorKeyField}')
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element))
            <> jsonb_array_length(item->'${stageEvaluatorsField}') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$`,
    `CREATE FUNCTION public.${identityPredicate}(task jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT CASE task->>'type'
         WHEN 'WorkTask' THEN
           ${referencePredicate}(task->'value'->'ticket')
           AND ${referencePredicate}(task->'value'->'cycle')
         WHEN 'EvaluationTask' THEN
           ${referencePredicate}(task->'value'->'ticket')
           AND ${referencePredicate}(task->'value'->'workCycle')
           AND ${referencePredicate}(task->'value'->'stage')
           AND ${referencePredicate}(task->'value'->'generation')
           AND ${referencePredicate}(task->'value'->'evaluator')
         ELSE false
       END
     $$`,
    `CREATE FUNCTION public.${validatedResultPredicate}(result jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT ${identityPredicate}(result->'${obligationField}'->'${taskField}')
          AND ${taskDefinitionPredicate}(result->'${obligationField}'->'${obligationDefinitionField}')
          AND ${referencePredicate}(result->'${obligationField}'->'${obligationContextField}')
          AND ${referencePredicate}(result->'${resultReferenceField}')
     $$`,
    `CREATE FUNCTION public.${reportPredicate}(report jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
       SELECT CASE report->>'type'
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
                  '${evaluationBlockedTag}') THEN
         RETURN ${reportPredicate}(value->'${reportField}');
       END IF;
       IF tag IN ('${reworkStartedTag}', '${failureEscalatedTag}') THEN
         IF NOT ${reportPredicate}(value->'${reportField}')
            OR jsonb_typeof(value->'${evidenceField}') IS DISTINCT FROM 'array'
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
    `CREATE FUNCTION public.${commandValidator}(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; task jsonb; constructor text; report jsonb;
       arm text; produced jsonb; obligation jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'Dispatch' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND ${referencePredicate}(value->'ticket')
           AND ${referencePredicate}(value->'${sourceField}');
       END IF;
       IF tag = 'TaskDone' THEN
         task := value->'task'; constructor := COALESCE(task->>'type', '');
         report := value->'report'; arm := COALESCE(report->>'type', '');
         produced := report->'value'->'result';
         obligation := produced->'${obligationField}';
         IF jsonb_typeof(value) <> 'object'
            OR NOT command_integer(value->'ticket')
            OR value ? 'tid' OR value ? 'verdict' OR value ? 'onFailure' THEN
           RETURN false;
         END IF;
         IF NOT ((constructor = 'WorkTask'
                  AND command_integer(task->'value'->'ticket')
                  AND command_integer(task->'value'->'cycle'))
              OR (constructor = 'EvaluationTask'
                  AND command_integer(task->'value'->'ticket')
                  AND command_integer(task->'value'->'workCycle')
                  AND command_integer(task->'value'->'stage')
                  AND command_integer(task->'value'->'generation')
                  AND command_integer(task->'value'->'evaluator'))) THEN
           RETURN false;
         END IF;
         IF report ? 'value' AND report->'value' ? 'ticket' THEN
           RETURN false;
         END IF;
         IF arm = 'TerminalFailureReport' THEN
           RETURN report->'value'->'${failureField}'->'${taskField}' IS NOT DISTINCT FROM task
             AND ${referencePredicate}(report->'value'->'${failureField}'->'${evidenceField}')
             AND COALESCE(report->'value'->>'kind', '')
               IN ('ProcessFailure', 'ExecutionUnavailableFailure');
         END IF;
         IF arm NOT IN ('WorkResultReport', 'EvaluationResultReport')
            OR obligation->'${taskField}' IS DISTINCT FROM task
            OR NOT ${taskDefinitionPredicate}(obligation->'${obligationDefinitionField}')
            OR NOT ${referencePredicate}(obligation->'${obligationContextField}')
            OR NOT ${referencePredicate}(produced->'${resultReferenceField}') THEN
           RETURN false;
         END IF;
         IF arm = 'WorkResultReport' THEN
           RETURN ${referencePredicate}(report->'value'->'${acceptedSourceField}');
         END IF;
         RETURN COALESCE(report->'value'->>'verdict', '')
           IN ('EvaluatorPass', 'EvaluatorFail');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND ${referencePredicate}(value->'${evidenceField}')
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       RETURN tag = 'CreateTicket'
         AND NOT (value ? 'deps' OR value ? 'prog')
         AND ${releasedPredicate}(value);
     END $$`,
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
         RETURN ${commandValidator}(command->'event')
           AND command->'event'->>'type' NOT IN ('ReleaseTicket', 'CreateTicket');
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
    `CREATE FUNCTION public.${journalCheck}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE entry jsonb;
     BEGIN
       IF NEW.entry IS JSON OBJECT THEN
         entry := NEW.entry::jsonb;
       END IF;
       IF entry IS NULL
          OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(entry) AS keys(key))
             IS DISTINCT FROM ARRAY['event', 'seq']::text[]
          OR entry->'seq' IS DISTINCT FROM to_jsonb(NEW.seq)
          OR decision_event_is_valid(entry->'event') IS NOT TRUE THEN
         RAISE EXCEPTION 'journal entry % is not its sequence and one ticket event', NEW.seq
           USING ERRCODE = 'check_violation';
       END IF;
       RETURN NEW;
     END $$`,
    `CREATE TRIGGER journal_entry_carries_an_event BEFORE INSERT ON public.journal_entry FOR EACH ROW EXECUTE FUNCTION public.${journalCheck}()`,
    ...ownedPredicates.flatMap((signature) => [
      `ALTER FUNCTION public.${signature} OWNER TO ${boundaryOwnerRole}`,
      `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`,
    ]),
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
           jsonb_build_object('${failureField}', failure,
             'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('${failureField}', failure, 'kind', 'ProcessFailure'));
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
             jsonb_build_object('result', produced, 'verdict',
               CASE WHEN bound.verdict = 'Pass'
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
             jsonb_build_object('result', produced,
               '${acceptedSourceField}', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
         jsonb_build_object('type', 'TaskDone', 'value',
           jsonb_build_object('ticket', bound.ticket, 'task', identity,
             'report', report)));
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
          command_value::text, 'TaskDone');
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
     END $$;`,
  ],
};
