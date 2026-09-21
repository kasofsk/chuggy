import { apiRole, ticketServiceRole, type Migration } from "../shared.ts";

/**
 * A parked ticket stops carrying a reason and a resume point and carries one
 * escalation instead. `ticket_projection.reason` and `.resume_at` become
 * `escalation`, with `escalation_evidence` beside it for the wall, the
 * continuation path or the hold kind that explains one; `native_action.reason`
 * becomes `escalation` over the same roster; and the `ExecutionBlocked` event
 * loses its reason, because the phase it interrupted is what says which
 * escalation it is.
 *
 * WHY A MIGRATION THAT REWRITES NO ROW OPENS WITH A GUARD. 006 could rename a
 * stored spelling onto its successor because the two rosters were the same
 * size and the map was total. There is no such map here: the resume point a
 * stored row carries is derived from the escalation after this, and the reason
 * a stored `ExecutionBlocked` names is a value the event no longer has a field
 * for. An actor at the decision semantics this image reads refuses every
 * earlier row outright, so a journal with rows in it is a journal that comes
 * up with a ticket the actor cannot replay — and a column rewrite would hide
 * that behind a schema that looks migrated. The guard refuses the whole
 * migration instead, and names `deploy/rig/wipe-tickets.sql` as what empties
 * the journal it needs.
 *
 * WHICH IS ALSO WHY NOTHING HERE ADMITS TWO VINTAGES. 006 made every
 * validator admit the spelling a stored entry was written in beside the one a
 * new entry would carry, because a stored entry's bytes are what its digest
 * attests and those entries were still there. Behind an empty journal there is
 * no stored entry to admit, so the release tag and the finalization outcome
 * name that 006 kept for history leave `decision_event_is_valid` rather than
 * sit in it as arms no row can reach.
 *
 * THE EVIDENCE IS NULLABLE AND THE CHECK IS ONE-DIRECTIONAL. An escalation the
 * machine reaches by counting — a rework budget spent — explains itself, and
 * the interpreter has nothing to put beside it; one reached by hitting a wall
 * has the execution's blocked reason, the continuation path's git evidence or
 * the request's hold kind to name. So evidence requires an escalation and an
 * escalation does not require evidence, and the column is one `text` because
 * those rosters are disjoint and never travel together.
 *
 * `submit_task_completion` IS REWRITTEN WHOLE, AND THAT IS WHAT THE EVENT'S
 * LOSS BUYS. It built its `ExecutionBlocked` out of `execution.blocked_reason`,
 * so the wall names were not history but what the boundary wrote next, and
 * every reader had to translate one into an escalation on the live path. The
 * event it builds now names the ticket and nothing else. What the wall was
 * evidence for it still is: `in_reason` is weighed against the same roster and
 * written to `execution.blocked_reason` exactly as before, and the writer reads
 * it off the execution to put on the desk beside the escalation.
 *
 * AND THE TWO NEW COLUMNS TAKE THE GRANTS `reason` HELD. The api role reads
 * the desk and the ticket-service role writes it, by column on this relation,
 * so a column arriving without its pair is a query refused as a whole rather
 * than a field that answers null.
 *
 * THE WRITER IS GRANTED THE WALL, BECAUSE IT IS WHAT PUTS IT ON THE DESK. The
 * event names the ticket alone, so the only account of the wall is the column
 * `submit_task_completion` writes beside it, and the writer reads it off the
 * execution its completion settled to record as the escalation's evidence.
 * That costs the ticket-service role two columns of `execution`: the wall, and
 * the completion operation a query has to find the row by. It reaches no other
 * column of that relation and writes none.
 */

const escalationRoster = `ARRAY['NoEscalation'::text, 'WorkFailureEscalated'::text, 'WorkExecutionUnavailableEscalated'::text, 'EvaluationFailureEscalated'::text, 'EvaluationBlockedEscalated'::text, 'FinalizationUnavailableEscalated'::text]`;

export const migration008: Migration = {
  version: 8,
  name: "a parked ticket carries one escalation and the evidence for it",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `ALTER TABLE public.ticket_projection
       DROP CONSTRAINT ticket_projection_reason_is_known,
       DROP CONSTRAINT ticket_projection_resume_is_known,
       DROP COLUMN reason,
       DROP COLUMN resume_at,
       ADD COLUMN escalation text DEFAULT 'NoEscalation'::text NOT NULL,
       ADD COLUMN escalation_evidence text,
       ADD CONSTRAINT ticket_projection_escalation_is_known CHECK ((escalation = ANY (${escalationRoster}))),
       ADD CONSTRAINT ticket_projection_evidence_needs_an_escalation CHECK (((escalation <> 'NoEscalation'::text) OR (escalation_evidence IS NULL)))`,
    `GRANT SELECT(escalation) ON TABLE public.ticket_projection TO ${apiRole}`,
    `GRANT UPDATE(escalation) ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
    `GRANT SELECT(escalation_evidence) ON TABLE public.ticket_projection TO ${apiRole}`,
    `GRANT UPDATE(escalation_evidence) ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
    `GRANT SELECT(completion_operation) ON TABLE public.execution TO ${ticketServiceRole}`,
    `GRANT SELECT(blocked_reason) ON TABLE public.execution TO ${ticketServiceRole}`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_reason_check`,
    `ALTER TABLE public.native_action RENAME COLUMN reason TO escalation`,
    `ALTER TABLE public.native_action
       ADD CONSTRAINT native_action_escalation_check CHECK (((escalation = ANY (${escalationRoster})) OR ((state <> 'Open'::text) AND (escalation = 'DependencyRevoked'::text))))`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb;
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
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND command_integer(value->'tid')
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket');
       END IF;
       IF tag <> 'CreateTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
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
       FOR item IN SELECT element FROM jsonb_array_elements(value->'prog') AS elements(element) LOOP
         IF jsonb_typeof(item) <> 'object' OR NOT command_integer(item->'fanout')
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
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
       next_ordinal bigint; command_value jsonb; command_tag text;
     BEGIN
       IF in_outcome NOT IN ('Passed', 'Failed', 'Blocked') THEN
         RAISE EXCEPTION 'completion outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       SELECT e.ticket, e.task, e.status, e.completion_operation, q.effect_position,
              r.manifest, r.digest, r.verdict, r.manifest_ordinal, r.schema_version
         INTO bound
         FROM execution e
         JOIN execution_request q
           ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
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
       IF in_outcome = 'Blocked' THEN
         command_tag := 'ExecutionBlocked';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'ExecutionBlocked', 'value',
             jsonb_build_object('ticket', bound.ticket)));
       ELSE
         command_tag := 'TaskDone';
         command_value := jsonb_build_object('version', 1, 'command', 'Decide', 'event',
           jsonb_build_object('type', 'TaskDone', 'value',
             jsonb_build_object('ticket', bound.ticket, 'tid', bound.task,
               'verdict', bound.verdict,
               'result', jsonb_build_object(
                 'manifest', bound.manifest_ordinal,
                 'digest', result_digest_fold(bound.digest),
                 'schema', bound.schema_version))));
       END IF;
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
          command_value::text, command_tag);
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
    `CREATE OR REPLACE FUNCTION public.request_finalization_approval(in_tenant text, in_project text, in_attempt text, in_action text, in_recovery_epoch text) RETURNS TABLE(result text, action text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; standing record; requested text; current_epoch text;
     BEGIN
       SELECT a.ticket, a.outcome, a.approval_required,
              f.state AS request_state, f.recovery_epoch AS request_epoch,
              f.authorizing_seq, f.effect_position, t.phase
         INTO bound
         FROM finalization_attempt a
         JOIN finalization_request f
           ON f.tenant = a.tenant AND f.project = a.project AND f.request = a.request
         LEFT JOIN ticket_projection t
           ON t.tenant = a.tenant AND t.project = a.project AND t.ticket = a.ticket
        WHERE a.tenant = in_tenant AND a.project = in_project AND a.attempt = in_attempt
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownAttempt'::text, NULL::text; RETURN;
       END IF;
       SELECT n.action INTO requested FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project AND n.attempt = in_attempt;
       IF requested IS NOT NULL THEN
         RETURN QUERY SELECT 'AlreadyRequested'::text, requested; RETURN;
       END IF;
       SELECT n.action, n.kind INTO standing FROM native_action n
        WHERE n.tenant = in_tenant AND n.project = in_project
          AND n.ticket = bound.ticket AND n.state = 'Open';
       IF standing.action IS NOT NULL AND standing.kind <> 'FinalizationApproval' THEN
         RETURN QUERY SELECT 'TicketHasAnOpenAction'::text, standing.action; RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.outcome <> 'Prepared'
          OR bound.approval_required IS NOT TRUE
          OR bound.request_state NOT IN ('Open', 'Registered')
          OR bound.request_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR bound.phase IS DISTINCT FROM 'Finalization'
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::text; RETURN;
       END IF;
       IF standing.action IS NOT NULL THEN
         UPDATE native_action n SET state = 'Withdrawn'
          WHERE n.tenant = in_tenant AND n.project = in_project
            AND n.action = standing.action AND n.state = 'Open';
       END IF;
       INSERT INTO native_action
         (tenant, project, action, authorizing_seq, effect_position, ticket,
          action_version, kind, escalation, required_capability, attempt)
       VALUES (in_tenant, in_project, in_action, bound.authorizing_seq,
          bound.effect_position, bound.ticket, bound.authorizing_seq,
          'FinalizationApproval', 'NoEscalation', 'ApproveFinalization', in_attempt);
       INSERT INTO native_action_resolution (tenant, project, action, resolution)
       SELECT in_tenant, in_project, in_action,
              unnest(ARRAY['Approve', 'Decline']);
       RETURN QUERY SELECT 'Requested'::text, in_action;
     END $$;`,
  ],
};
