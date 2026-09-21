import type { Migration } from "../shared.ts";

/**
 * Every value this machine shares with the package it is converging on takes
 * the package's spelling. The phases `Working`, `Evaluating` and `Finalizing`
 * become `Work`, `Evaluation` and `Finalization`; the resume points named
 * after them follow; `WorkFailed` becomes `WorkFailureEscalated`,
 * `ReworkBudgetExhausted` becomes `EvaluationFailureEscalated`, and the five
 * walls a ticket could be escalated at collapse into
 * `WorkExecutionUnavailableEscalated`; `ReleaseTicket` becomes `CreateTicket`
 * and `FinalizationFailed` becomes `FinalizationNeedsWork`. Nothing about the
 * machine moves — only what its values are called.
 *
 * THIS MIGRATION REFUSES NOTHING, WHICH IS WHY IT OPENS WITH A DROP RATHER
 * THAN A GUARD. 005 guarded because a narrowed check revalidates what the
 * relation already holds, so a stored row at a dropped value would fail
 * partway down the list. Here each restated check is restated onto the image
 * of a rewrite of its own column, and the rewrite is total: the roster being
 * replaced is exactly the domain of the map, so no row reaches the new check
 * at a spelling it refuses. A guard arm here would be a control with no row it
 * could ever find, which is the shape this tree calls worse than no control at
 * all.
 *
 * A RENAMED COLUMN IS UNROSTERED WHILE IT IS REWRITTEN, so each relation drops
 * its checks, is rewritten, and takes them back at the new names. The two
 * rosters overlap nowhere, so a rewrite under either of them is a row the
 * relation refuses: under the old one the new spelling, and under the new one
 * the spelling it has not reached yet. Nothing else sees the relation
 * unrostered, because the drop takes its exclusive lock and the migration's
 * transaction holds that until the checks are back.
 *
 * THE COLUMNS REWRITTEN ARE THE ONES A CHECK CONSTRAINS: `ticket_projection`'s
 * phase, reason and resume point, `native_action.reason` and
 * `project_continuation.expected_phase`. `execution.blocked_reason` is not
 * among them and keeps its own roster of five, because it is the evidence the
 * collapsed reason stops carrying: the wall reaches the reader off the
 * execution that was blocked at it, beside an escalation that now names only
 * that work execution was unavailable.
 *
 * `native_action` IS REWRITTEN SETTLED ROWS AND ALL, WHERE 005 LEFT ITS
 * SETTLED ROWS ALONE. A rename is not a deletion: a settled desk task at
 * `WorkFailed` recorded the fact the new spelling records, and leaving it at
 * the old one would make the column's own check false of half its rows. The
 * `DependencyRevoked` arm 005 kept for settled rows survives untouched,
 * because that value left the machine rather than being renamed.
 *
 * THE VALIDATORS ADMIT BOTH SPELLINGS, AS 005's ADMITTED THE DROPPED KEYS
 * ABSENT OR PRESENT. A stored entry's bytes are what its digest attests, so no
 * journal row is rewritten and every function that reads one admits what it
 * was written in as well as what a new row carries. For the blocked reason
 * that is not only history: `submit_task_completion` still builds its
 * `ExecutionBlocked` event out of `execution.blocked_reason`, so the wall
 * names are what the boundary writes next as much as what it wrote before.
 *
 * THE ONE READ PAIRED WITH A PROJECTED PHASE IS PAIRED WITH THE NEW SPELLING
 * ALONE. `request_finalization_approval` binds an approval to a ticket the
 * projection holds in the finalization phase, and that projection was
 * rewritten above; admitting the old spelling there would be admitting a row
 * the column's own check now refuses to hold.
 *
 * AND THE API ROLE IS GRANTED THE WALL COLUMN IT NOW HAS TO READ. The five
 * walls stopped being a ticket's reason and became evidence beside its
 * execution, so the ticket read answers them from `execution.blocked_reason` —
 * a column that role reached none of, the reads having had no cause to. A
 * column-level grant is refused as a whole query rather than a missing field,
 * so the grant belongs in the migration that moves the evidence.
 *
 * THE PARTIAL INDEX OVER THE RELEASE EVENT IS RECREATED OVER BOTH TAGS. It is
 * what every read of a ticket's release is answered from, and the journal
 * holds rows under the old tag and will hold rows under the new one; an index
 * over either alone sends half of those reads to a sequential scan.
 */

export const migration006: Migration = {
  version: 6,
  name: "the phases, reasons and resume points take the package's names",
  statements: [
    `ALTER TABLE public.ticket_projection
       DROP CONSTRAINT ticket_projection_phase_is_known,
       DROP CONSTRAINT ticket_projection_reason_is_known,
       DROP CONSTRAINT ticket_projection_resume_is_known`,
    `UPDATE public.ticket_projection
        SET phase = CASE phase
              WHEN 'Working' THEN 'Work'
              WHEN 'Evaluating' THEN 'Evaluation'
              WHEN 'Finalizing' THEN 'Finalization'
              ELSE phase END,
            reason = CASE reason
              WHEN 'WorkFailed' THEN 'WorkFailureEscalated'
              WHEN 'ReworkBudgetExhausted' THEN 'EvaluationFailureEscalated'
              WHEN 'ExecutionPolicyDenied' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'TicketConfigIncompatible' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'ExecutionProfileUnavailable' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'RuntimeVersionUnsupported' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'RequiredCapabilityUnavailable' THEN 'WorkExecutionUnavailableEscalated'
              ELSE reason END,
            resume_at = CASE resume_at
              WHEN 'ResumeWorking' THEN 'ResumeWork'
              WHEN 'ResumeReworking' THEN 'ResumeRework'
              WHEN 'ResumeEvaluating' THEN 'ResumeEvaluation'
              WHEN 'ResumeFinalizing' THEN 'ResumeFinalization'
              ELSE resume_at END`,
    `ALTER TABLE public.ticket_projection
       ADD CONSTRAINT ticket_projection_phase_is_known CHECK ((phase = ANY (ARRAY['Pending'::text, 'Work'::text, 'Evaluation'::text, 'Finalization'::text, 'Done'::text, 'Escalated'::text, 'Revoked'::text]))),
       ADD CONSTRAINT ticket_projection_reason_is_known CHECK ((reason = ANY (ARRAY['NoReason'::text, 'WorkFailureEscalated'::text, 'EvaluationFailureEscalated'::text, 'WorkExecutionUnavailableEscalated'::text]))),
       ADD CONSTRAINT ticket_projection_resume_is_known CHECK (((resume_at IS NULL) OR (resume_at = ANY (ARRAY['NoResume'::text, 'ResumeWork'::text, 'ResumeRework'::text, 'ResumeEvaluation'::text, 'ResumeFinalization'::text]))))`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_reason_check`,
    `UPDATE public.native_action
        SET reason = CASE reason
              WHEN 'WorkFailed' THEN 'WorkFailureEscalated'
              WHEN 'ReworkBudgetExhausted' THEN 'EvaluationFailureEscalated'
              WHEN 'ExecutionPolicyDenied' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'TicketConfigIncompatible' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'ExecutionProfileUnavailable' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'RuntimeVersionUnsupported' THEN 'WorkExecutionUnavailableEscalated'
              WHEN 'RequiredCapabilityUnavailable' THEN 'WorkExecutionUnavailableEscalated'
              ELSE reason END`,
    `ALTER TABLE public.native_action
       ADD CONSTRAINT native_action_reason_check CHECK (((reason = ANY (ARRAY['NoReason'::text, 'WorkFailureEscalated'::text, 'EvaluationFailureEscalated'::text, 'WorkExecutionUnavailableEscalated'::text])) OR ((state <> 'Open'::text) AND (reason = 'DependencyRevoked'::text))))`,
    `ALTER TABLE public.project_continuation
       DROP CONSTRAINT project_continuation_expected_phase_check`,
    `UPDATE public.project_continuation
        SET expected_phase = CASE expected_phase
              WHEN 'Working' THEN 'Work'
              WHEN 'Evaluating' THEN 'Evaluation'
              WHEN 'Finalizing' THEN 'Finalization'
              ELSE expected_phase END`,
    `ALTER TABLE public.project_continuation
       ADD CONSTRAINT project_continuation_expected_phase_check CHECK ((expected_phase = ANY (ARRAY['Pending'::text, 'Work'::text, 'Evaluation'::text, 'Finalization'::text, 'Done'::text, 'Escalated'::text, 'Revoked'::text])))`,
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
           AND value->>'out' IN ('FinalizationSucceeded', 'FinalizationFailed',
             'FinalizationNeedsWork');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'reason' IN ('NoReason', 'WorkFailed', 'ReworkBudgetExhausted',
             'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable', 'WorkFailureEscalated',
             'EvaluationFailureEscalated', 'WorkExecutionUnavailableEscalated');
       END IF;
       IF tag NOT IN ('ReleaseTicket', 'CreateTicket') OR jsonb_typeof(value) <> 'object'
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
         RETURN decision_event_is_valid(command->'event')
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
     END $$;`,
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
               'FinalizationNeedsWork');
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'event'->>'type' NOT IN ('FinalizationResult'));
       END $$;`,
    `CREATE OR REPLACE FUNCTION public.submit_finalization_result(in_tenant text, in_project text, in_request text, in_attempt text, in_outcome text, in_failure_kind text, in_request_generation bigint, in_recovery_epoch text, in_operation text, in_authority_subject text) RETURNS TABLE(result text, operation text, ordinal bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; project_lifecycle text; project_generation bigint;
       next_ordinal bigint; command_value jsonb; current_epoch text;
       scoped_digest text; settled text;
     BEGIN
       IF in_outcome NOT IN ('FinalizationSucceeded', 'FinalizationFailed',
           'FinalizationNeedsWork') THEN
         RAISE EXCEPTION 'finalization outcome % is not one this boundary submits', in_outcome
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       scoped_digest := encode(sha256(convert_to('finalization:' || in_request, 'UTF8')), 'hex');
       SELECT f.ticket, f.state, f.request_generation, f.recovery_epoch, f.kind,
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
              AND bound.landing IS NOT DISTINCT FROM 'None'))
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
                 ELSE jsonb_build_object('attempt', in_attempt) END;
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
          command_value::text, 'FinalizationResult');
       INSERT INTO decision_input
         (tenant, project, ordinal, input_kind, input_id, base_priority, lifecycle_generation)
       VALUES (in_tenant, in_project, next_ordinal, 'Operation', in_operation,
          'Completion', project_generation);
       INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES (in_tenant, in_project, true, 1)
       ON CONFLICT (tenant, project) DO UPDATE
         SET ready = true, generation = project_readiness.generation + 1;
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
          action_version, kind, reason, required_capability, attempt)
       VALUES (in_tenant, in_project, in_action, bound.authorizing_seq,
          bound.effect_position, bound.ticket, bound.authorizing_seq,
          'FinalizationApproval', 'NoReason', 'ApproveFinalization', in_attempt);
       INSERT INTO native_action_resolution (tenant, project, action, resolution)
       SELECT in_tenant, in_project, in_action,
              unnest(ARRAY['Approve', 'Decline']);
       RETURN QUERY SELECT 'Requested'::text, in_action;
     END $$;`,
    `GRANT SELECT(blocked_reason) ON TABLE public.execution TO chuggy_api`,
    `DROP INDEX public.journal_entry_release_ticket`,
    `CREATE INDEX journal_entry_release_ticket ON public.journal_entry USING btree (tenant, project, (
CASE
    WHEN (entry IS JSON OBJECT) THEN ((((entry)::jsonb -> 'event'::text) -> 'value'::text) -> 'ticket'::text)
    ELSE NULL::jsonb
END)) WHERE (
CASE
    WHEN (entry IS JSON OBJECT) THEN (((entry)::jsonb -> 'event'::text) ->> 'type'::text)
    ELSE NULL::text
END = ANY (ARRAY['ReleaseTicket'::text, 'CreateTicket'::text]))`,
  ],
};
