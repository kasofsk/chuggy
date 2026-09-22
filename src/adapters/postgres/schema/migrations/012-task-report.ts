import type { Migration } from "../shared.ts";

/**
 * A task terminates by reporting what it produced, and one event carries the
 * whole of it. `TaskDone`'s `verdict` and `result` become one `report` naming
 * the constructor the task terminated under, which is also what lets the two
 * event kinds that existed to say what a completion could not — a block that
 * named a ticket rather than the task whose wall it was, and the reduce that
 * followed a failed stage — leave the vocabulary.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A stored completion attests a
 * verdict and carries no report, and the validator this image installs refuses
 * an entry shaped that way: the field is not optional here, it is gone, and an
 * entry whose bytes are what its digest attests cannot be rewritten into one
 * this machine admits. So a journal with rows in it comes up holding a ticket
 * the actor cannot replay, and installing the validator behind it would hide
 * that behind a schema that looks migrated. The guard refuses the migration
 * instead and names `deploy/rig/wipe-tickets.sql`, which is what empties the
 * journal it needs.
 *
 * THE REPORT IS THE PACKAGE'S CONSTRUCTORS, MINUS THE TWO REFS THIS TREE HAS
 * NO MODEL FOR. A produced work result, a produced evaluation result with the
 * evaluator's own verdict, and a terminal failure at one of two kinds. The
 * package's work report also names the source ref it was accepted at and its
 * failure report names an evidence ref, and neither is a number this tree's
 * domain holds: the accepted commit lives in the interpreter and the evidence
 * stays on the execution, as `blocked_reason` beside a wall and as the sealed
 * manifest beside a failure. So the arm asks for the fields the report has
 * here and has no opinion about a ref it could not weigh.
 *
 * AND `verdict` IS REFUSED FOR BEING NAMED RATHER THAN IGNORED FOR IT, which
 * is 009's move for 009's reason. A writer that names both is one whose two
 * halves can disagree, and the half this machine reads is the report — so the
 * attestation would sit in the entry unread, and a completion journalled
 * against the wrong one of them would be found at the ticket rather than at
 * the mailbox. Refusing the entry is what makes that loud.
 *
 * A WALL IS A TASK'S AND NOT A TICKET'S, so `ExecutionBlocked`'s arm goes and
 * nothing this schema installs admits one. The block that named a ticket
 * escalated it whole and left its siblings to drain; a failure report names
 * the task through the completion it rides on, so one evaluator's wall marks
 * that evaluator and the stage it belongs to runs on. `EvalReduce` needs no
 * arm deleted — a reduce has never been a command this door takes — and it is
 * refused after this migration exactly as it was before, by being a tag the
 * function has no arm for.
 *
 * AN ABSENT KEY IS NOT AN ARRAY, AND `<> 'array'` COULD NOT SAY SO. A release
 * that omits `deps` or `prog` entirely made `jsonb_typeof` of the missing
 * field NULL, and `<>` against NULL is NULL, which an `OR` chain carries to
 * the `IF` that then falls through to the walks — over nothing, twice — and
 * returns true. `IS DISTINCT FROM` is the comparison that answers for a value
 * that is not there, so a payload naming neither field is refused where it was
 * admitted. The two walks below are unchanged: what they weigh is the items,
 * and an array with no items was always well-formed.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE AGAIN, AND THE REPORT IS WHY.
 * The event it builds carried the attestation across as it stood; the report
 * is a choice between three constructors made from the task's kind and that
 * attestation, and it is made inside the transaction that already holds the
 * execution row — the same lock, the same statement, so the report journalled
 * is built from the result the request authorized. A blocked submission now
 * builds a completion too, which is why the identity is read on every path
 * rather than only on the one that had a verdict to carry.
 *
 * WHAT THE THREE CONSTRUCTORS ARE BUILT FROM. An evaluation task's attestation
 * is the evaluator's own verdict, so `Pass` and `Fail` are the two evaluation
 * verdicts. A work task has no verdict in this vocabulary at all: it produced
 * a result or it did not, so `Pass` is the produced report and `Fail` is a
 * process failure — which is also what an exhausted retry budget arrives as,
 * since that settles as a failed work completion carrying the explicit empty
 * manifest. And a submission blocked at a definitive wall is the execution
 * being unavailable to the task, at the one kind that names it.
 *
 * ITS SIGNATURE DOES NOT MOVE, so this is a replacement and not a drop. The
 * report is derived rather than passed: the scheduler's door still takes the
 * ticket, the wire integer and the outcome it was told, weighs them against
 * the execution as `BindingMismatch` always has, and the choice happens on
 * this side of the boundary. Nothing in `privileges.ts` spells a new
 * signature, so no grant is restated and `AlreadySubmitted` answers exactly as
 * before.
 *
 * AND THE MANIFEST'S ATTESTATION DOES NOT MOVE EITHER. `execution_result.
 * verdict` keeps its column and its CHECK, because what a worker signed is
 * `Pass` or `Fail` and this migration renames nothing a worker writes. The
 * mapping from what was attested to what is reported is this door's, which is
 * the only place that holds both.
 */

/**
 * How the generated codec spells a report: a sum carrying a record is the
 * constructor under `type` and the record under `value`, and a sum whose arms
 * carry nothing is the constructor's own name as a string.
 */
const reportField = "report";
const workReportTag = "WorkResultReport";
const evaluationReportTag = "EvaluationResultReport";
const failureReportTag = "TerminalFailureReport";
const evaluatorPassVerdict = "EvaluatorPass";
const evaluatorFailVerdict = "EvaluatorFail";
const processFailureKind = "ProcessFailure";
const executionUnavailableKind = "ExecutionUnavailableFailure";

export const migration012: Migration = {
  version: 12,
  name: "a completion carries the report its task terminated under",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb; entry jsonb; place bigint;
       task jsonb; constructor text; report jsonb; arm text; produced jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'TaskDone' THEN
         task := value->'task'; constructor := COALESCE(task->>'type', '');
         report := value->'${reportField}'; arm := COALESCE(report->>'type', '');
         produced := report->'value'->'result';
         IF jsonb_typeof(value) <> 'object'
            OR NOT command_integer(value->'ticket')
            OR value ? 'tid' OR value ? 'verdict' THEN
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
         IF NOT command_integer(report->'value'->'ticket') THEN
           RETURN false;
         END IF;
         IF arm = '${failureReportTag}' THEN
           RETURN COALESCE(report->'value'->>'kind', '')
             IN ('${processFailureKind}', '${executionUnavailableKind}');
         END IF;
         IF arm NOT IN ('${workReportTag}', '${evaluationReportTag}')
            OR jsonb_typeof(produced) <> 'object'
            OR NOT command_integer(produced->'manifest')
            OR NOT command_integer(produced->'digest')
            OR NOT command_integer(produced->'schema') THEN
           RETURN false;
         END IF;
         RETURN arm = '${workReportTag}'
           OR COALESCE(report->'value'->>'verdict', '')
             IN ('${evaluatorPassVerdict}', '${evaluatorFailVerdict}');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       IF tag <> 'CreateTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') IS DISTINCT FROM 'array'
          OR jsonb_typeof(value->'prog') IS DISTINCT FROM 'array'
          OR value ? 'workFanout'
          OR COALESCE(value->>'finalizer', 'ManagedFinalizer') <> 'ManagedFinalizer' THEN
         RETURN false;
       END IF;
       IF (SELECT count(*) FROM jsonb_array_elements(value->'deps')) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(value->'deps') AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'deps') AS elements(element) LOOP
         IF NOT command_integer(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item, place IN
         SELECT element, ordinality
           FROM jsonb_array_elements(value->'prog') WITH ORDINALITY AS elements(element, ordinality)
       LOOP
         IF jsonb_typeof(item) <> 'object' OR item ? 'fanout'
            OR NOT command_integer(item->'key')
            OR jsonb_typeof(item->'evaluators') <> 'array'
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
           RETURN false;
         END IF;
         IF (item->>'key')::bigint <> place
            OR jsonb_array_length(item->'evaluators') < 1 THEN
           RETURN false;
         END IF;
         FOR entry IN SELECT element
               FROM jsonb_array_elements(item->'evaluators') AS elements(element) LOOP
           IF jsonb_typeof(entry) <> 'object'
              OR NOT command_integer(entry->'key') THEN
             RETURN false;
           END IF;
           IF (entry->>'key')::bigint < 1 THEN
             RETURN false;
           END IF;
         END LOOP;
         IF (SELECT count(DISTINCT element->'key')
               FROM jsonb_array_elements(item->'evaluators') AS elements(element))
            <> jsonb_array_length(item->'evaluators') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_task_completion(in_tenant text, in_project text, in_execution text, in_ticket bigint, in_task bigint, in_source_effect integer, in_outcome text, in_manifest text, in_manifest_digest text, in_reason text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; identity jsonb; report jsonb;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version,
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
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', '${failureReportTag}', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'kind', '${executionUnavailableKind}'));
       ELSIF bound.task_kind = 'Evaluation' THEN
         report := jsonb_build_object('type', '${evaluationReportTag}', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'result', jsonb_build_object(
               'manifest', bound.manifest_ordinal,
               'digest', result_digest_fold(bound.digest),
               'schema', bound.schema_version),
             'verdict', CASE WHEN bound.verdict = 'Pass'
               THEN '${evaluatorPassVerdict}' ELSE '${evaluatorFailVerdict}' END));
       ELSIF bound.verdict = 'Pass' THEN
         report := jsonb_build_object('type', '${workReportTag}', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'result', jsonb_build_object(
               'manifest', bound.manifest_ordinal,
               'digest', result_digest_fold(bound.digest),
               'schema', bound.schema_version)));
       ELSE
         report := jsonb_build_object('type', '${failureReportTag}', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'kind', '${processFailureKind}'));
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
         jsonb_build_object('type', 'TaskDone', 'value',
           jsonb_build_object('ticket', bound.ticket, 'task', identity,
             '${reportField}', report)));
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
          SET status = 'Terminal', outcome = in_outcome, blocked_reason = in_reason,
              result_manifest = in_manifest, completion_operation = in_operation,
              terminal_at = now()
        WHERE tenant = in_tenant AND project = in_project AND execution = in_execution;
       RETURN QUERY SELECT 'Submitted'::text, in_operation, next_ordinal;
     END $$;`,
  ],
};
