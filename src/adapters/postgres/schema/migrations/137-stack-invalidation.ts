/**
 * An evaluation over a stack that stopped standing is abandoned by the
 * finalizer, which offers the invalidation through a door of its own.
 *
 * `submit_stack_invalidation` IS MODELLED ON `submit_finalization_result` AND IS
 * GRANTED TO THE FINALIZER ALONE. Every decision names an operation, so the
 * invalidation of an evaluation is one: this builds its envelope from the stack
 * record, never from what the caller offers, and files it for the writer as the
 * finalizer's. It answers `Submitted`, `AlreadySubmitted` where the ticket's
 * cycle was offered before (the idempotency key is the ticket and the cycle,
 * not the operation id), `BindingMismatch` under an epoch that is not current,
 * `UnknownStack` for a cycle with no stack record, `NotEvaluating` for a
 * ticket not in an evaluation, and `NotAdmitted` for a project in retention.
 *
 * `evaluation_stack_dead` IS WRITTEN IN THE SAME TRANSACTION AS THE OPERATION,
 * and is the only thing the writer's failure policy reads of an invalidation:
 * a failed verdict on a cycle marked dead is taken as
 * `InvalidateEvaluationFailure`, which counts no rework. A verdict that
 * reached the journal before the marker is an ordinary rework, which is the
 * race this accepts. A row names the journal position the stack was found
 * dead at, which is the evidence the invalidation records, and is never
 * changed or deleted.
 *
 * THE TICKET SERVICE IS GRANTED `SELECT` ON THE MARKER and nothing wider, and
 * the finalizer `SELECT`, which is how it avoids offering a stack twice.
 *
 * THE JOURNAL ADMITS THE TWO EVENTS AN INVALIDATION IS. `decision_event_is_valid`
 * is 016's with the arms for `TicketEvaluationInvalidated` and
 * `TicketEvaluationFailureInvalidated`, which it refused until a writer could
 * produce them.
 *
 * `ticket_command_is_valid` ADMITS THE ENVELOPE AND `accept_operation` DOES
 * NOT: the public validator refuses a command it does not name, so no principal
 * can offer one. The operation's tag is held to the finalizer's authority as a
 * finalization result's is.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  stackInvalidationFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${stackInvalidationFunction}(in_tenant text, in_project text, in_ticket bigint, in_work_cycle bigint, in_recovery_epoch text, in_operation text, in_authority_subject text)`;

const fields = ["version", "command", "ticket", "workCycle", "evidence"];

export const migration137: Migration = {
  version: 137,
  name: "the finalizer abandons an evaluation whose stack no longer stands",
  statements: [
    `CREATE TABLE public.evaluation_stack_dead (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL,
       work_cycle bigint NOT NULL,
       observed_seq bigint NOT NULL
         CONSTRAINT evaluation_stack_dead_position_is_a_position CHECK (observed_seq >= 1),
       marked_at timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,ticket,work_cycle),
       CONSTRAINT evaluation_stack_dead_names_a_stack
         FOREIGN KEY (tenant,project,ticket,work_cycle)
         REFERENCES public.evaluation_stack(tenant,project,ticket,work_cycle))`,
    `CREATE TRIGGER evaluation_stack_dead_is_immutable BEFORE DELETE OR UPDATE ON public.evaluation_stack_dead
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT SELECT ON TABLE public.evaluation_stack_dead TO ${finalizerRole}, ${ticketServiceRole}`,
    `GRANT SELECT,INSERT ON TABLE public.evaluation_stack_dead TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.evaluation_stack TO ${boundaryOwnerRole}`,
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
       IF tag = 'TicketCreated' THEN
         RETURN released_ticket_is_valid(value);
       END IF;
       IF tag IN ('TicketRevoked', 'TicketWorkResumed', 'TicketEvaluationResumed',
                  'TicketFinalizationResumed') THEN
         RETURN command_reference(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT command_reference(value->'ticket') THEN
         RETURN false;
       END IF;
       IF tag = 'TicketUpdated' THEN
         RETURN command_reference(value->'revision')
           AND value->'revision' > to_jsonb(1)
           AND released_ticket_is_valid(value->'definition')
           AND value->'definition'->'id' = value->'ticket';
       END IF;
       IF tag = 'TicketDispatched' THEN
         RETURN command_reference(value->'source');
       END IF;
       IF tag = 'TicketWorkResultAccepted' THEN
         RETURN validated_task_result_is_valid(value->'result')
           AND command_reference(value->'acceptedSourceRef');
       END IF;
       IF tag IN ('TicketWorkProcessFailed', 'TicketWorkExecutionUnavailable') THEN
         RETURN task_identity_is_valid(value->'task')
           AND command_reference(value->'evidence');
       END IF;
       IF tag IN ('TicketEvaluationProgressed', 'TicketEvaluationPassed',
                  'TicketEvaluationBlocked', 'TicketEvaluationReworkStarted',
                  'TicketEvaluationFailureEscalated')
          AND (NOT task_report_is_valid(value->'report')
               OR value->'report'->'value'->'ticket'
                  IS DISTINCT FROM value->'ticket') THEN
         RETURN false;
       END IF;
       IF tag IN ('TicketEvaluationProgressed', 'TicketEvaluationPassed',
                  'TicketEvaluationBlocked') THEN
         RETURN true;
       END IF;
       IF tag IN ('TicketEvaluationReworkStarted', 'TicketEvaluationFailureEscalated') THEN
         IF jsonb_typeof(value->'evidence') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'evidence') < 1 THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'evidence') AS elements(element) LOOP
           IF NOT command_reference(item->'evaluator')
              OR NOT command_reference(item->'resultRef') THEN
             RETURN false;
           END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF tag IN ('TicketFinalizationSucceeded', 'TicketFinalizationNeedsWork',
                  'TicketFinalizationUnavailable') THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'generation')
           AND command_reference(value->'evidence');
       END IF;
       IF tag = 'TicketEvaluationInvalidated' THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'evidence');
       END IF;
       IF tag = 'TicketEvaluationFailureInvalidated' THEN
         RETURN task_report_is_valid(value->'report')
           AND value->'report'->'value'->'ticket' IS NOT DISTINCT FROM value->'ticket'
           AND command_reference(value->'evidence');
       END IF;
       RETURN false;
     END $$`,
    `CREATE OR REPLACE FUNCTION public.ticket_command_is_valid(command jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
       BEGIN
         IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
           RETURN false;
         END IF;
         IF command->>'command' = 'SubmitStackInvalidation' THEN
           RETURN (command - ARRAY[${fields.map((field) => `'${field}'`).join(", ")}]) = '{}'::jsonb
             AND jsonb_typeof(command->'version') = 'number'
             AND command->>'version' = '1'
             AND command_integer(command->'ticket')
             AND (command->>'ticket')::numeric >= 1
             AND command_integer(command->'workCycle')
             AND (command->>'workCycle')::numeric >= 1
             AND command_integer(command->'evidence')
             AND (command->>'evidence')::numeric >= 1;
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
             OR command->'ticketCommand'->>'type' NOT IN ('ReportFinalizationResult', 'DispatchTicket'));
       END $$`,
    `ALTER TABLE public.operation
       DROP CONSTRAINT operation_completion_authority_is_its_boundary,
       ADD CONSTRAINT operation_completion_authority_is_its_boundary CHECK (
CASE command_tag
    WHEN 'ReportTaskTerminal'::text THEN (authority_kind = 'ExecutionScheduler'::text)
    WHEN 'ReportFinalizationResult'::text THEN (authority_kind = 'Finalizer'::text)
    WHEN 'InvalidateEvaluation'::text THEN (authority_kind = 'Finalizer'::text)
    ELSE true
END) NOT VALID`,
    `CREATE FUNCTION ${signature} RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE project_lifecycle text; project_generation bigint; project_head bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       scoped_digest := encode(sha256(convert_to(
         'stack-invalidation:' || in_ticket::text || ':' || in_work_cycle::text, 'UTF8')), 'hex');
       SELECT p.lifecycle, p.lifecycle_generation, p.head
         INTO project_lifecycle, project_generation, project_head
         FROM project p WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownStack'::text, NULL::text, NULL::bigint; RETURN;
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
       IF current_epoch IS DISTINCT FROM in_recovery_epoch THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM evaluation_stack s
                       WHERE s.tenant = in_tenant AND s.project = in_project
                         AND s.ticket = in_ticket AND s.work_cycle = in_work_cycle) THEN
         RETURN QUERY SELECT 'UnknownStack'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM ticket_projection t
                       WHERE t.tenant = in_tenant AND t.project = in_project
                         AND t.ticket = in_ticket AND t.phase = 'Evaluation') THEN
         RETURN QUERY SELECT 'NotEvaluating'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       IF project_lifecycle = 'Retention' THEN
         RETURN QUERY SELECT 'NotAdmitted'::text, NULL::text, NULL::bigint; RETURN;
       END IF;
       command_value := jsonb_build_object('version', 1,
         'command', 'SubmitStackInvalidation', 'ticket', in_ticket,
         'workCycle', in_work_cycle, 'evidence', project_head);
       IF ticket_command_is_valid(command_value) IS NOT TRUE THEN
         RAISE EXCEPTION 'the stack invalidation this boundary built is not one the mailbox admits'
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       INSERT INTO evaluation_stack_dead (tenant, project, ticket, work_cycle, observed_seq)
       VALUES (in_tenant, in_project, in_ticket, in_work_cycle, project_head)
       ON CONFLICT DO NOTHING;
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
          command_value::text, 'InvalidateEvaluation');
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
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${finalizerRole}`,
  ],
};
