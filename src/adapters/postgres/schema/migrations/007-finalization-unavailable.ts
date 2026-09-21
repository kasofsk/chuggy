import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  type Migration,
} from "../shared.ts";

/**
 * A finalization the finalizer cannot carry out stops being a hold nobody can
 * see and becomes a result the machine escalates on.
 * `FinalizationResultUnavailable` joins the outcomes a submission may carry
 * and `FinalizationUnavailableEscalated` the reasons a ticket may be parked
 * under; the request that is held records what holds it and how many passes
 * have found it so; and the door the finalizer concludes through takes a third
 * arm that fences on that record where the other two fence on an attempt.
 *
 * THIS MIGRATION REFUSES NOTHING, WHICH IS WHY IT OPENS WITH NO GUARD. 005
 * guarded because a narrowed check revalidates what the relation already
 * holds, so a stored row at a dropped value would fail partway down the list.
 * Every check restated here is widened instead, and a widened check admits
 * strictly more rows than the one it replaces; the columns arrive absent on
 * every row that exists, which is what the wholeness check below calls whole.
 * A guard arm here would be a control with no row it could ever find, which is
 * the shape this tree calls worse than no control at all.
 *
 * THE HOLD ROSTER HAS ONE SQL HOME AND IT IS THE COLUMN'S OWN CHECK. What is
 * on the list is the judgment that a resume re-running the same operation
 * against the same pinned input could conclude where this pass could not —
 * reachability of the repository, the target, the proposal and its base, and
 * the finalizer's own budgets, which a new request counts afresh. The rest
 * stay holds: a human's answer and a proposal a human closed are rework rather
 * than unavailability, a moved head is a rebuild, evidence that contradicts
 * itself is a defect, and a merge a reviewer has not reached is
 * indistinguishable from a merge nobody has blocked. That list is
 * `finalizationUnavailableKinds`, beside `FinalizationHoldKind` in
 * `src/interpreter/finalizer.ts`, and
 * `finalization_request_hold_kind_is_known` mirrors it here. Neither function
 * below restates it: `record_finalization_hold` writes the kind it is given
 * and lets the column refuse one that is not on the list, and the submission
 * door compares the kind it is given against the stored one rather than
 * against a roster of its own.
 *
 * THE HOLD IS RECORDED ON THE REQUEST BECAUSE A REQUEST IS WHAT A RESUME
 * REPLACES. A resume mints a new `finalization_request` at a later authorizing
 * sequence, so a count kept on the request is a count a resume resets without
 * anything having to clear it, and a fulfilled request keeps the columns as
 * the evidence of why it ended. The three move together — the kind, the pass
 * count and the instant the kind was first seen — which is what
 * `finalization_request_hold_is_whole` says, so no reader has to decide what a
 * kind with no instant behind it would mean.
 *
 * THE COUNT IS FENCED ON THE CLAIM WHERE THE CONCLUSION IS NOT. A conclusion
 * is fenced by the generation and the epoch because it is answered once and
 * the request is closed behind it; a count is incremented every pass and a
 * second finalizer counting the same hold would reach the dwell twice as fast.
 * So `record_finalization_hold` takes the claim the caller holds as well, and
 * refuses a caller naming none — the same owner and generation the pass
 * heartbeats and releases under, which advance the moment a lapsed claim is
 * reaped. Its body runs as the boundary owner, which reaches this relation by
 * grant rather than by owning it, so the three columns are granted to that
 * role as `state` already is.
 *
 * THE THIRD ARM IS THE NARROWEST WIDENING OF `in_failure_kind` THERE IS: an
 * equality against the request's own stored kind. The attempt column's roster
 * is untouched because no attempt is read or written on this arm at all — the
 * commonest of these holds prepare nothing, which is why the attempt
 * precondition above the arms exempts this outcome and the arm itself requires
 * that the submission name no attempt. A submission that names a kind the
 * request is not held at, or names one while the request is held at none, is a
 * binding mismatch like any other, so the door the finalizer role reaches
 * cannot push a ticket out of finalization on a kind it made up.
 *
 * THE COMMAND CARRIES THE KIND AND THE MAILBOX HOLDS IT TO THE OUTCOME. The
 * kind is the evidence the operation records, so the envelope the door builds
 * names it exactly when the outcome is the one it explains, and
 * `ticket_command_is_valid` bounds it as it bounds every other string a
 * submission carries. The event the writer journals carries none: the machine
 * escalates on the outcome alone, and the desk reads the kind off the request.
 *
 * AND THE API ROLE IS GRANTED THE EVIDENCE PLUS THE KEYS A JOIN TO IT COSTS.
 * The ticket read answers `finalizationBlockedBy` from the hold kind of the
 * ticket's latest request, and that read has to find the row before it can
 * read the column — a column-level grant is refused as a whole query rather
 * than as a missing field, so the partition, the ticket and the authorizing
 * sequence are granted beside the three the desk is there for. The role
 * reaches no other column of this relation and writes none.
 */

const holdFunction = `public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text)`;

export const migration007: Migration = {
  version: 7,
  name: "a finalization nothing can carry out escalates, and says what held it",
  statements: [
    `ALTER TABLE public.ticket_projection
       DROP CONSTRAINT ticket_projection_reason_is_known,
       ADD CONSTRAINT ticket_projection_reason_is_known CHECK ((reason = ANY (ARRAY['NoReason'::text, 'WorkFailureEscalated'::text, 'EvaluationFailureEscalated'::text, 'WorkExecutionUnavailableEscalated'::text, 'FinalizationUnavailableEscalated'::text])))`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_reason_check,
       ADD CONSTRAINT native_action_reason_check CHECK (((reason = ANY (ARRAY['NoReason'::text, 'WorkFailureEscalated'::text, 'EvaluationFailureEscalated'::text, 'WorkExecutionUnavailableEscalated'::text, 'FinalizationUnavailableEscalated'::text])) OR ((state <> 'Open'::text) AND (reason = 'DependencyRevoked'::text))))`,
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
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
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
             OR command->'event'->>'type' NOT IN ('FinalizationResult'));
       END $$;`,
    `ALTER TABLE public.finalization_request
       ADD COLUMN hold_kind text,
       ADD COLUMN hold_passes integer DEFAULT 0 NOT NULL,
       ADD COLUMN held_since timestamp with time zone,
       ADD CONSTRAINT finalization_request_hold_kind_is_known CHECK (((hold_kind IS NULL) OR (hold_kind = ANY (ARRAY['RepositoryUnbound'::text, 'TargetUnreadable'::text, 'ProposalBaseUnreadable'::text, 'ProposalBaseIsHead'::text, 'ProposalDenied'::text, 'ReconciliationUnreadable'::text, 'ProposalEvidenceUnstorable'::text, 'ProposalAbsent'::text, 'ProposalUnaddressed'::text, 'ProposalUnavailable'::text, 'PreparationRestartsExhausted'::text, 'ProposalCreationsExhausted'::text, 'ProposalMergesExhausted'::text])))),
       ADD CONSTRAINT finalization_request_hold_is_whole CHECK ((((hold_kind IS NULL) = (held_since IS NULL)) AND ((hold_kind IS NULL) = (hold_passes = 0)) AND (hold_passes >= 0)))`,
    `GRANT UPDATE(hold_kind) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(hold_passes) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `GRANT UPDATE(held_since) ON TABLE public.finalization_request TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION public.record_finalization_hold(in_tenant text, in_project text, in_request text, in_kind text, in_claim_owner text, in_claim_generation bigint, in_request_generation bigint, in_recovery_epoch text) RETURNS TABLE(result text, hold_passes integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record; current_epoch text; counted integer;
     BEGIN
       SELECT f.state, f.request_generation, f.recovery_epoch, f.claim_owner,
              f.claim_generation
         INTO bound
         FROM finalization_request f
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        FOR UPDATE OF f;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'UnknownRequest'::text, NULL::integer; RETURN;
       END IF;
       SELECT e.epoch INTO current_epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1;
       IF bound.state NOT IN ('Open', 'Registered')
          OR bound.request_generation <> in_request_generation
          OR bound.recovery_epoch IS DISTINCT FROM in_recovery_epoch
          OR current_epoch IS DISTINCT FROM in_recovery_epoch
          OR in_claim_owner IS NULL
          OR bound.claim_owner IS DISTINCT FROM in_claim_owner
          OR bound.claim_generation IS DISTINCT FROM in_claim_generation
       THEN
         RETURN QUERY SELECT 'BindingMismatch'::text, NULL::integer; RETURN;
       END IF;
       UPDATE finalization_request f
          SET hold_kind = in_kind,
              hold_passes = CASE
                WHEN in_kind IS NULL THEN 0
                WHEN f.hold_kind IS NOT DISTINCT FROM in_kind THEN f.hold_passes + 1
                ELSE 1 END,
              held_since = CASE
                WHEN in_kind IS NULL THEN NULL
                WHEN f.hold_kind IS NOT DISTINCT FROM in_kind THEN f.held_since
                ELSE now() END
        WHERE f.tenant = in_tenant AND f.project = in_project AND f.request = in_request
        RETURNING f.hold_passes INTO counted;
       RETURN QUERY SELECT 'Recorded'::text, counted;
     END $$;`,
    `ALTER FUNCTION ${holdFunction} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${holdFunction} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${holdFunction} TO ${finalizerRole}`,
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
    `GRANT SELECT(tenant,project,ticket,authorizing_seq,hold_kind,hold_passes,held_since)
       ON TABLE public.finalization_request TO ${apiRole}`,
  ],
};
