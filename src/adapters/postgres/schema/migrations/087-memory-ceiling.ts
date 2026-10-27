/**
 * A runner names the most memory it takes one job of, and a job above every
 * runner's is blocked for its size rather than offered again and again.
 *
 * `worker_pool` and `personal_runner` each gain `memory_ceiling_mib`, NULL
 * until a poll names one, which the pool plane writes as it writes the
 * capabilities a poll names and reads in every claim, and the scheduler reads
 * beside them for what can be said of a job no runner has taken.
 *
 * `RequiredMemoryUnavailable` joins the reasons an execution is blocked for, in
 * `execution_blocked_reason_is_known` and in `submit_task_completion`. The
 * function IS REPLACED, its body 016's with this reason added, written out so
 * this file goes on saying what it installed when the roster grows.
 * `CREATE OR REPLACE` keeps the owner and grants 016 gave the function.
 */

import {
  poolPlaneRole,
  schedulerRole,
  sourceUnrecordedResult,
  workResultUnrecordedResult,
  type Migration,
} from "../shared.ts";

export const migration087: Migration = {
  version: 87,
  name: "a runner names the most memory it takes one job of",
  statements: [
    `ALTER TABLE public.worker_pool
       ADD COLUMN memory_ceiling_mib bigint,
       ADD CONSTRAINT worker_pool_memory_ceiling_is_a_count CHECK ((memory_ceiling_mib >= 0))`,
    `ALTER TABLE public.personal_runner
       ADD COLUMN memory_ceiling_mib bigint,
       ADD CONSTRAINT personal_runner_memory_ceiling_is_a_count CHECK ((memory_ceiling_mib >= 0))`,
    `GRANT SELECT(memory_ceiling_mib),UPDATE(memory_ceiling_mib)
       ON TABLE public.worker_pool TO ${poolPlaneRole}`,
    `GRANT SELECT(memory_ceiling_mib),UPDATE(memory_ceiling_mib)
       ON TABLE public.personal_runner TO ${poolPlaneRole}`,
    `GRANT SELECT(memory_ceiling_mib) ON TABLE public.worker_pool TO ${schedulerRole}`,
    `GRANT SELECT(memory_ceiling_mib) ON TABLE public.personal_runner TO ${schedulerRole}`,
    `ALTER TABLE public.execution
       DROP CONSTRAINT execution_blocked_reason_is_known,
       ADD CONSTRAINT execution_blocked_reason_is_known CHECK (((blocked_reason IS NULL) OR (blocked_reason = ANY (ARRAY['ExecutionPolicyDenied'::text, 'TicketConfigIncompatible'::text, 'ExecutionProfileUnavailable'::text, 'RuntimeVersionUnsupported'::text, 'RequiredCapabilityUnavailable'::text, 'RequiredMemoryUnavailable'::text]))))`,
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
          OR (in_reason IS NOT NULL AND in_reason NOT IN ('ExecutionPolicyDenied', 'TicketConfigIncompatible', 'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported', 'RequiredCapabilityUnavailable', 'RequiredMemoryUnavailable'))
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
       failure := jsonb_build_object('task', identity,
         'evidence', bound.task);
       IF in_outcome = 'Blocked' THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'failure', failure, 'kind', 'ExecutionUnavailableFailure'));
       ELSIF in_outcome = 'ProcessFailed'
          OR (bound.task_kind = 'Work' AND bound.verdict <> 'Pass') THEN
         report := jsonb_build_object('type', 'TerminalFailureReport', 'value',
           jsonb_build_object('ticket', bound.ticket,
             'failure', failure, 'kind', 'ProcessFailure'));
       ELSE
         SELECT CASE WHEN journalled.entry->'event'->>'type' = 'TicketCreated'
                     THEN journalled.entry->'event'->'value'
                     ELSE journalled.entry->'event'->'value'->'definition' END
           INTO released
           FROM journal_entry j
           CROSS JOIN LATERAL (SELECT CASE WHEN j.entry IS JSON OBJECT
                                           THEN j.entry::jsonb END AS entry) AS journalled
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND ((journalled.entry->'event'->>'type' = 'TicketCreated'
                  AND journalled.entry->'event'->'value'->'id' = to_jsonb(bound.ticket))
              OR (journalled.entry->'event'->>'type' = 'TicketUpdated'
                  AND journalled.entry->'event'->'value'->'ticket' = to_jsonb(bound.ticket)))
          ORDER BY journalled.entry->'seq' DESC
          LIMIT 1;
         IF bound.task_kind = 'Work' THEN
           definition := released->'workConfiguration';
           context_reference := bound.cycle;
         ELSE
           SELECT evaluators.evaluator->'task' INTO definition
             FROM jsonb_array_elements(released->'evaluationPlan'->'stages')
                    AS stages(stage),
                  jsonb_array_elements(stages.stage->'evaluators')
                    AS evaluators(evaluator)
            WHERE (stages.stage->>'key')::bigint = bound.stage
              AND (evaluators.evaluator->>'key')::bigint = bound.evaluator;
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
           'task', identity,
           'definition', definition,
           'contextRef', context_reference);
         produced := jsonb_build_object('obligation', obligation,
           'resultRef', result_digest_fold(bound.digest));
         IF bound.task_kind = 'Evaluation' THEN
           report := jsonb_build_object('type', 'EvaluationResultReport', 'value',
             jsonb_build_object('ticket', bound.ticket, 'result', produced,
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
             jsonb_build_object('ticket', bound.ticket, 'result', produced,
               'acceptedSourceRef', accepted));
         END IF;
       END IF;
       command_value := jsonb_build_object('version', 1, 'command', 'Decide',
         'ticketCommand', jsonb_build_object('type', 'ReportTaskTerminal', 'value', report));
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
          command_value::text, 'ReportTaskTerminal');
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
  ],
};
