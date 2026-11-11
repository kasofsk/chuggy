/**
 * A landing sent back to re-check records why, and a proposing one the base
 * it was read against.
 *
 * `finalization_attempt` GAINS `recheck_reason`, which of the three re-checks
 * a `RecheckRequired` failure was, and `recheck_base_ref`, the base a
 * proposing ticket's re-check read where its target is the proposal's head,
 * kept only beside the two reasons read before a proposal is merged. Every
 * row there is keeps neither, which every row there is may, so an attempt
 * recorded before this answers no reason. The finalizer's insert is granted on
 * the whole table, and the landings door's owner reads the whole table, so
 * neither grant changes.
 *
 * THE LANDINGS DOOR IS DROPPED AND RECREATED, because a result type cannot
 * change in place: beside 106's columns it answers the newest attempt's
 * re-check reason and base. Dropping it takes its owner and its grants with
 * it, so both are given again as 106 gave them.
 */

import {
  apiRole,
  boundaryOwnerRole,
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

export const migration159: Migration = {
  version: 159,
  name: "a landing sent back to re-check records why",
  statements: [
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN recheck_reason text,
       ADD COLUMN recheck_base_ref text`,
    `ALTER TABLE public.finalization_attempt
       ADD CONSTRAINT finalization_attempt_recheck_reason_is_known
         CHECK (((recheck_reason IS NULL)
                 OR ((recheck_reason = ANY (ARRAY['TargetMoved'::text, 'StackTreeDiffers'::text, 'MergedTreeDiffers'::text]))
                     AND (failure_kind = 'RecheckRequired'::text)))
                AND ((recheck_base_ref IS NULL)
                     OR ((length(recheck_base_ref) >= 1)
                         AND (length(recheck_base_ref) <= 256)
                         AND (recheck_reason IS NOT NULL)
                         AND (recheck_reason = ANY (ARRAY['TargetMoved'::text, 'StackTreeDiffers'::text])))))`,
    `DROP FUNCTION ${landingsSignature}`,
    `CREATE FUNCTION ${landingsSignature}
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
                  merged_head text, proposal_status text,
                  queue_removal_reason text, queue_removal_actor text,
                  recheck_reason text, recheck_base_ref text)
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
             CASE WHEN c.merge IS NULL
                       AND c.merge_queue_standing->'queued'='true'::jsonb
                    THEN 'Queued'
                  WHEN c.merge IS NULL AND c.merge_queue_refused
                       AND c.merge_queue_standing->'enabled'='true'::jsonb
                    THEN 'Blocked'
                  WHEN c.merge='HeadMoved'
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
                                c.creation_evidence->>'status') END,
             c.merge_queue_standing->'removal'->>'reason',
             c.merge_queue_standing->'removal'->>'actor',
             a.recheck_reason, a.recheck_base_ref
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
    `ALTER FUNCTION ${landingsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${landingsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${apiRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION ${landingsSignature} TO ${schedulerRole}`,
  ],
};
