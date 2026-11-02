/**
 * A pull request whose base requires GitHub's merge queue is landed through
 * that queue, and followed there until it merges or is removed.
 *
 * `finalization_change_proposal` GAINS THE QUEUE'S COLUMNS: the last standing
 * read, a refusal or an enqueue no standing read has seen since, whether the
 * last enqueue was refused, whether the pinned head was seen entering the
 * queue, and the removal a second enqueue answered. Every row there is has
 * asked no queue anything, which the defaults say. The finalizer is granted
 * their update, and the landings door's owner the columns it reads.
 *
 * `finalization_request_hold_kind_is_known` IS REPLACED, admitting the three
 * queue removals a ticket is escalated at after every kind 081 admitted, so no
 * stored row is refused by the new constraint.
 *
 * THE LANDINGS DOOR IS DROPPED AND RECREATED, because a result type cannot
 * change in place: beside 093's columns it answers the reason the queue last
 * removed the proposal for and who removed it, and a merge waits on the queue
 * where the last standing read found it queued and on the forge's rules where
 * the queue refused it. Dropping it takes its owner and its grants with it, so
 * both are given again as 060 and 062 gave them.
 */

import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketLandingsReadFunction,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const landingsSignature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

/** The holds 081 admitted, and the three this adds, in the order the wire names them. */
const unavailableKinds = [
  "RepositoryUnbound",
  "TargetUnreadable",
  "ProposalBaseUnreadable",
  "ProposalBaseIsHead",
  "ProposalDenied",
  "ReconciliationUnreadable",
  "ProposalEvidenceUnstorable",
  "ProposalAbsent",
  "ProposalUnaddressed",
  "ProposalUnavailable",
  "PreparationRestartsExhausted",
  "ProposalCreationsExhausted",
  "ProposalMergesExhausted",
  "PromotionDeclined",
  "PromotionWorkflowsRefused",
  "ProposalQueueChecksFailed",
  "ProposalQueueTimedOut",
  "ProposalDequeued",
];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration106: Migration = {
  version: 106,
  name: "a pull request is landed through its base's merge queue",
  statements: [
    `ALTER TABLE public.finalization_change_proposal
       ADD COLUMN merge_queue_standing jsonb,
       ADD COLUMN merge_queue_unread boolean DEFAULT false NOT NULL,
       ADD COLUMN merge_queue_refused boolean DEFAULT false NOT NULL,
       ADD COLUMN merge_queue_entered boolean DEFAULT false NOT NULL,
       ADD COLUMN merge_queue_requeued_after_ms bigint`,
    `ALTER TABLE public.finalization_change_proposal
       ADD CONSTRAINT finalization_change_proposal_queue_is_read
         CHECK (((merge_queue_standing IS NULL)
                 OR ((jsonb_typeof(merge_queue_standing) = 'object'::text)
                     AND (length((merge_queue_standing)::text) <= 131072)))
                AND ((merge_queue_requeued_after_ms IS NULL)
                     OR ((merge_queue_standing IS NOT NULL)
                         AND (merge_queue_requeued_after_ms >= 0))))`,
    `GRANT UPDATE (merge_queue_standing, merge_queue_unread,
                   merge_queue_refused, merge_queue_entered,
                   merge_queue_requeued_after_ms)
       ON TABLE public.finalization_change_proposal TO ${finalizerRole}`,
    `GRANT SELECT (merge_queue_standing, merge_queue_refused)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `ALTER TABLE public.finalization_request
       DROP CONSTRAINT finalization_request_hold_kind_is_known,
       ADD CONSTRAINT finalization_request_hold_kind_is_known CHECK (((hold_kind IS NULL) OR (hold_kind = ANY (${textArray(unavailableKinds)}))))`,
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
                  queue_removal_reason text, queue_removal_actor text)
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
             c.merge_queue_standing->'removal'->>'actor'
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
