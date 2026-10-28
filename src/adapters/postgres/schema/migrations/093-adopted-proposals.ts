/**
 * A rework carries on in its ticket's own pull request, and a candidate the
 * target already holds lands nothing.
 *
 * `Landed` IS AN ATTEMPT WHOSE TARGET ALREADY HELD ITS CANDIDATE. It pins the
 * candidate as a prepared attempt does and is never granted a permit, so the
 * door accepts `FinalizationSucceeded` for it with no permit and no reading
 * beside it, and the two landing reads name the target commit it found holding
 * the candidate as where the ticket landed.
 *
 * `Adopted` IS A ROW WHOSE PROPOSAL AN EARLIER REQUEST OPENED. Its evidence is
 * the reading that found that proposal open, and it counts no create, because
 * none was made: an adopted row counts no attempt, and every other answered
 * row still counts the one its create was made under.
 *
 * Each function is replaced in place, with its result unchanged, so it keeps
 * its owner and its grants.
 */

import {
  ticketLandedCommitReadFunction,
  ticketLandingsReadFunction,
  type Migration,
} from "../shared.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const landedSignature = `public.${ticketLandedCommitReadFunction}(in_tenant text, in_project text, in_ticket bigint)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

const contradictions = `ARRAY['Closed'::text, 'Merged'::text, 'Superseded'::text, 'ForgeMismatch'::text, 'RepositoryMismatch'::text, 'HeadMismatch'::text, 'BaseMismatch'::text, 'MetadataMismatch'::text, 'MarkerMismatch'::text]`;

export const migration093: Migration = {
  version: 93,
  name: "a rework adopts its ticket's pull request, and a held candidate lands nothing",
  statements: [
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_outcome_is_known,
       DROP CONSTRAINT finalization_attempt_outcome_is_whole`,
    `ALTER TABLE public.finalization_attempt
       ADD CONSTRAINT finalization_attempt_outcome_is_known
         CHECK (outcome = ANY (ARRAY['Prepared'::text, 'Failed'::text, 'Landed'::text])),
       ADD CONSTRAINT finalization_attempt_outcome_is_whole
         CHECK (((outcome = ANY (ARRAY['Prepared'::text, 'Landed'::text])) = (candidate_commit IS NOT NULL))
                AND ((outcome = 'Failed'::text) = (failure_kind IS NOT NULL))
                AND ((conflict_manifest IS NULL) OR (failure_kind = 'MergeConflict'::text))
                AND ((conflict_manifest IS NULL) = (conflict_manifest_digest IS NULL)))`,
    `ALTER TABLE public.finalization_change_proposal
       DROP CONSTRAINT finalization_change_proposal_attempts_are_counted,
       DROP CONSTRAINT finalization_change_proposal_results_are_whole`,
    `ALTER TABLE public.finalization_change_proposal
       ADD CONSTRAINT finalization_change_proposal_attempts_are_counted
         CHECK ((refusals >= 0) AND (declines >= 0) AND (reconciliations >= 0)
                AND (attempts >= (refusals + declines))
                AND (attempts <= ((refusals + declines) + 1))
                AND ((creation IS NULL)
                     OR ((creation = 'Adopted'::text) AND (attempts = 0))
                     OR ((creation <> 'Adopted'::text)
                         AND (attempts = ((refusals + declines) + 1))))),
       ADD CONSTRAINT finalization_change_proposal_results_are_whole
         CHECK (((creation IS NULL) OR (creation = ANY (ARRAY['Created'::text, 'AlreadyExists'::text, 'Contradictory'::text, 'Unstorable'::text, 'Adopted'::text])))
                AND ((reconciliation IS NULL) OR (reconciliation = ANY (ARRAY['Accepted'::text, 'Absent'::text, 'Contradictory'::text, 'Unstorable'::text])))
                AND ((creation_evidence IS NULL) OR (creation IS NOT NULL))
                AND ((reconciliation_evidence IS NULL) OR (reconciliation IS NOT NULL))
                AND ((creation IS NULL) OR (creation <> ALL (ARRAY['Created'::text, 'AlreadyExists'::text, 'Contradictory'::text, 'Adopted'::text])) OR (creation_evidence IS NOT NULL))
                AND ((reconciliation IS NULL) OR (reconciliation <> ALL (ARRAY['Accepted'::text, 'Contradictory'::text])) OR (reconciliation_evidence IS NOT NULL))
                AND ((creation_contradiction IS NULL) = (creation IS DISTINCT FROM 'Contradictory'::text))
                AND ((reconciliation_contradiction IS NULL) = (reconciliation IS DISTINCT FROM 'Contradictory'::text))
                AND ((creation_contradiction IS NULL) OR (creation_contradiction = ANY (${contradictions})))
                AND ((reconciliation_contradiction IS NULL) OR (reconciliation_contradiction = ANY (${contradictions}))))`,
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
              p.state AS permit_state, r.verdict,
              w.definition->'finalization'->>'mode' AS landing
         INTO bound
         FROM finalization_request f
         LEFT JOIN ticket_definition w
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
            OR (in_outcome = 'FinalizationSucceeded'
              AND bound.kind = 'RunFinalizer'
              AND in_failure_kind IS NULL
              AND bound.attempt_outcome = 'Landed'
              AND bound.permit_state IS NULL)
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
          command_value::text, 'ReportFinalizationResult');
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
    `CREATE OR REPLACE FUNCTION ${landingsSignature}
    RETURNS TABLE(request text, authorizing_seq bigint, work_cycle bigint,
                  finalization_generation bigint, state text, concluded text,
                  hold_kind text, hold_passes integer,
                  held_since timestamp with time zone, attempts integer,
                  outcome text, failure_kind text, target_ref text,
                  target_commit text, candidate_commit text,
                  prepared_at timestamp with time zone, conflict_manifest text,
                  approval_open boolean, proposed boolean, head_ref text,
                  base_ref text, creation text, url text, merge text,
                  merge_reason text, mergeability text, merge_commit text,
                  landed_commit text, merge_state text, merge_wait text,
                  merge_heard_at timestamp with time zone, head_commit text,
                  merged_head text, proposal_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      WITH concluded AS (
        SELECT DISTINCT ON (e.value->'workCycle', e.value->'generation')
               e.value->'workCycle' AS work_cycle,
               e.value->'generation' AS generation, e.type
          FROM journal_entry j
          CROSS JOIN LATERAL (
            SELECT d->>'type' AS type, d->'value' AS value
              FROM (SELECT CASE WHEN j.entry IS JSON OBJECT
                                THEN j.entry::jsonb->'event' END AS d) x
          ) e
         WHERE j.tenant=in_tenant AND j.project=in_project
           AND e.type IN ('TicketFinalizationSucceeded',
                          'TicketFinalizationNeedsWork',
                          'TicketFinalizationUnavailable')
           AND e.value->'ticket'=to_jsonb(in_ticket)
         ORDER BY e.value->'workCycle', e.value->'generation'
      ), counted AS (
        SELECT f.request, f.authorizing_seq, f.work_cycle,
               f.finalization_generation, f.state, f.hold_kind, f.hold_passes,
               f.held_since,
               CASE WHEN f.state='Fulfilled' THEN c.type END AS concluded,
               (SELECT count(*) FROM finalization_attempt y
                 WHERE y.tenant=f.tenant AND y.project=f.project
                   AND y.request=f.request)::integer AS attempts
          FROM finalization_request f
          LEFT JOIN concluded c
            ON c.work_cycle=to_jsonb(f.work_cycle)
           AND c.generation=to_jsonb(f.finalization_generation)
         WHERE f.tenant=in_tenant AND f.project=in_project
           AND f.ticket=in_ticket
      ), shown AS (
        SELECT * FROM counted s
         WHERE s.concluded IS DISTINCT FROM 'TicketFinalizationSucceeded'
            OR s.attempts > 0
         ORDER BY s.authorizing_seq DESC, s.request DESC
         LIMIT greatest(in_count, 0)
      )
      SELECT s.request, s.authorizing_seq, s.work_cycle,
             s.finalization_generation, s.state, s.concluded, s.hold_kind,
             s.hold_passes, s.held_since, s.attempts, a.outcome,
             a.failure_kind, a.target_ref, a.target_commit, a.candidate_commit,
             a.prepared_at, a.conflict_manifest,
             coalesce(s.state IN ('Open','Registered')
                      AND a.outcome='Prepared' AND a.approval_required
                      AND p.permit IS NULL AND n.state='Open', false),
             c.request IS NOT NULL, c.head_ref, c.base_ref, c.creation,
             coalesce(c.creation_evidence->>'url',
                      c.reconciliation_evidence->>'url'),
             c.merge, c.merge_reason,
             c.merge_reading_evidence->>'mergeability', c.merge_commit,
             CASE WHEN a.outcome='Landed' THEN a.target_commit
                  WHEN l.landed->>'commit' ~ ${gitObject}
                  THEN l.landed->>'commit' END,
             c.merge_reading_evidence->>'mergeState',
             CASE WHEN c.merge='HeadMoved'
                       AND coalesce(c.merge_reading,'Unmerged')='Unmerged'
                    THEN 'HeadMoved'
                  WHEN c.merge IS NULL AND c.merge_reading='Unmerged'
                       AND c.merge_attempts=c.merge_refusals+c.merge_declines
                    THEN 'Blocked' END,
             c.merge_heard_at, c.head_commit,
             CASE WHEN l.landed->>'head' ~ ${gitObject}
                       AND l.landed->>'head' IS DISTINCT FROM c.head_commit
                  THEN l.landed->>'head' END,
             CASE WHEN c.merge='Merged' THEN 'Merged'
                  ELSE coalesce(c.merge_reading_evidence->>'status',
                                c.reconciliation_evidence->>'status',
                                c.creation_evidence->>'status') END
        FROM shown s
        LEFT JOIN LATERAL (
          SELECT x.* FROM finalization_attempt x
           WHERE x.tenant=in_tenant AND x.project=in_project
             AND x.request=s.request
           ORDER BY x.prepared_at DESC, x.attempt DESC LIMIT 1
        ) a ON true
        LEFT JOIN commit_permit p
          ON p.tenant=in_tenant AND p.project=in_project AND p.attempt=a.attempt
        LEFT JOIN native_action n
          ON n.tenant=in_tenant AND n.project=in_project AND n.attempt=a.attempt
         AND n.kind='FinalizationApproval'
        LEFT JOIN finalization_change_proposal c
          ON c.tenant=in_tenant AND c.project=in_project AND c.request=s.request
        LEFT JOIN ticket_definition w
          ON w.tenant=in_tenant AND w.project=in_project AND w.ticket=in_ticket
        LEFT JOIN LATERAL (
          SELECT CASE
                   WHEN c.request IS NULL THEN
                     CASE WHEN w.definition->'finalization'->>'mode'
                               IN ('PullRequest','PullRequestMerge')
                          THEN NULL
                          ELSE jsonb_build_object('commit', x.candidate_commit)
                     END
                   WHEN c.merge='Merged'
                     THEN jsonb_build_object('commit', c.merge_commit,
                                             'head', coalesce(c.merge_head,
                                                              c.head_commit))
                   WHEN c.merge_reading='Accepted'
                     THEN jsonb_build_object(
                            'commit', c.merge_reading_evidence->'mergeCommit',
                            'head', c.merge_reading_evidence->'head'->'commit')
                   WHEN w.definition->'finalization'->>'mode'='PullRequestMerge'
                        AND c.creation IN ('Created','AlreadyExists')
                        AND c.creation_evidence->>'status'='Merged'
                     THEN jsonb_build_object(
                            'commit', c.creation_evidence->'mergeCommit',
                            'head', c.creation_evidence->'head'->'commit')
                   WHEN c.reconciliation='Accepted'
                        AND c.reconciliation_evidence->>'status'='Merged'
                     THEN jsonb_build_object(
                            'commit', c.reconciliation_evidence->'mergeCommit',
                            'head', c.reconciliation_evidence->'head'->'commit')
                 END AS landed
            FROM finalization_attempt x
            JOIN commit_permit q
              ON q.tenant=x.tenant AND q.project=x.project AND q.attempt=x.attempt
            JOIN finalization_reconciliation r
              ON r.tenant=q.tenant AND r.project=q.project AND r.permit=q.permit
           WHERE x.tenant=in_tenant AND x.project=in_project
             AND x.request=s.request AND r.verdict='Promoted'
           ORDER BY q.granted_at DESC, q.permit DESC
           LIMIT 1
        ) l ON true
    $$`,
    `CREATE OR REPLACE FUNCTION ${landedSignature}
    RETURNS TABLE(repository text, recovery_epoch text, retired boolean,
                  repository_commit text, landed_after timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      WITH promoted AS (
        SELECT a.request, a.repository, a.candidate_commit, a.outcome,
               a.target_commit, coalesce(p.granted_at, a.prepared_at) AS granted_at
          FROM finalization_attempt a
          JOIN finalization_request f
            ON f.tenant=a.tenant AND f.project=a.project AND f.request=a.request
          LEFT JOIN commit_permit p
            ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
          LEFT JOIN finalization_reconciliation r
            ON r.tenant=p.tenant AND r.project=p.project AND r.permit=p.permit
         WHERE a.tenant=in_tenant AND a.project=in_project
           AND a.ticket=in_ticket
           AND (r.verdict='Promoted' OR a.outcome='Landed')
         ORDER BY f.authorizing_seq DESC,
                  coalesce(p.granted_at, a.prepared_at) DESC,
                  p.permit DESC NULLS LAST, a.attempt DESC
         LIMIT 1
      ), landed AS (
        SELECT n.repository,
               CASE
                 WHEN n.outcome='Landed' THEN n.target_commit
                 WHEN c.request IS NULL THEN
                   CASE WHEN w.definition->'finalization'->>'mode'
                             IN ('PullRequest','PullRequestMerge')
                        THEN NULL ELSE n.candidate_commit END
                 WHEN c.merge='Merged' THEN c.merge_commit
                 WHEN c.merge_reading='Accepted'
                   THEN c.merge_reading_evidence->>'mergeCommit'
                 WHEN w.definition->'finalization'->>'mode'='PullRequestMerge'
                      AND c.creation IN ('Created','AlreadyExists')
                      AND c.creation_evidence->>'status'='Merged'
                   THEN c.creation_evidence->>'mergeCommit'
                 WHEN c.reconciliation='Accepted'
                      AND c.reconciliation_evidence->>'status'='Merged'
                   THEN c.reconciliation_evidence->>'mergeCommit'
               END AS repository_commit,
               coalesce(c.opened_at, n.granted_at) AS landed_after
          FROM promoted n
          LEFT JOIN ticket_definition w
            ON w.tenant=in_tenant AND w.project=in_project
           AND w.ticket=in_ticket
          LEFT JOIN finalization_change_proposal c
            ON c.tenant=in_tenant AND c.project=in_project
           AND c.request=n.request
      )
      SELECT l.repository, b.recovery_epoch, b.retired_at IS NOT NULL,
             l.repository_commit, l.landed_after
        FROM landed l
        JOIN project_repository b
          ON b.tenant=in_tenant AND b.project=in_project
         AND b.repository=l.repository
       WHERE l.repository_commit ~ ${gitObject}
    $$`,
  ],
};
