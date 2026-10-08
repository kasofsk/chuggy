/**
 * What the API reads to answer a ticket's landings: each finalization request
 * the ticket has had, as what is recorded of it, through one door.
 *
 * THE DOOR IS A DOOR FOR 038'S REASON. The rows are the finalizer's, and a
 * grant on them would hand the API every project's attempts and proposals
 * where it needs one ticket's. So the API is granted nothing on the three
 * relations, and the door's owner is granted the proposal columns it answers
 * and did not already read.
 *
 * HOW A FULFILLED REQUEST CONCLUDED IS READ FROM THE JOURNAL, since the row
 * does not say: the event that concluded it names the ticket, the work cycle
 * and the generation the request carries. The door matches it, so a request
 * that concluded as succeeded with no attempt, which landed nothing and tried
 * nothing, is left out before the newest so many are counted.
 *
 * WHERE A REQUEST LANDED IS 038'S RULE, keyed by the request. Its newest
 * promoted permit and its own proposal are read where 038 reads the ticket's
 * newest request's, under the same order of places and the same refusal of
 * anything that is not a git object's id.
 *
 * AN APPROVAL IS OPEN while the request is live, its newest attempt is
 * prepared and asks one, no permit was granted for that attempt, and the
 * action asking it is open. A declined one is resolved, and is not.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketLandingsReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketLandingsReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

export const migration044: Migration = {
  version: 44,
  name: "a ticket's landings are read by the API",
  statements: [
    `GRANT SELECT (head_ref, base_ref, merge_reason)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature}
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
                  landed_commit text)
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
             CASE WHEN l.landed ~ ${gitObject} THEN l.landed END
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
                          THEN NULL ELSE x.candidate_commit END
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
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
