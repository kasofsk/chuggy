/**
 * A landing queue says since when its holder has held it.
 *
 * `project_landing_queue_candidates` IS DROPPED AND RECREATED, because a result
 * type cannot change in place: beside 144's columns each candidate answers
 * `holder_since`, the commit time of the later of two journal entries: the one
 * its rank was taken at, and the latest at which a ticket of its reference
 * ranked ahead of it stopped holding that rank. For the reference's holder
 * that is when it became the holder. Nothing is stored for it.
 *
 * A TICKET AHEAD is another of the reference's tickets with a `RunFinalizer`
 * request before the candidate's rank, so its last such request ranked it
 * ahead. It stopped holding at its first entry after that request which ends
 * the chain or leaves the path: a landing, a revoke, an evaluation's rework,
 * an escalation of its work, its evaluation or its finalization, and a
 * send-back whose attempt failed as anything but `RecheckRequired` or
 * `Restack`, which is where 175's rank breaks a chain. A resumption is not
 * one, since the escalation before it already was.
 *
 * The reference is `briefQueuesOn`'s over the brief the door reads: a
 * proposal's base, otherwise the finalization's target or else the branch.
 * Dropping the door takes its owner and its grant with it, so both are given
 * again as 144 gave them.
 *
 * `journal_entry` IS GRANTED `SELECT(committed_at)` TO THE BOUNDARY OWNER,
 * beside the columns 013 and 119 granted it, so the door can read an entry's
 * time. The API is granted nothing more.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectLandingQueueCandidatesFunction,
  ticketFinalizationRankFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${projectLandingQueueCandidatesFunction}(in_tenant text, in_project text)`;

export const migration203: Migration = {
  version: 203,
  name: "a landing queue says since when its holder has held it",
  statements: [
    `GRANT SELECT(committed_at) ON TABLE public.journal_entry TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${signature}`,
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(ticket bigint, phase text, brief text, rank bigint,
                     holder_since timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH queued AS (
         SELECT d.ticket, d.brief, d.brief->>'repository' AS repository,
                CASE WHEN d.brief->'finalization'->>'mode' = 'PullRequestMerge'
                     THEN d.brief->'finalization'->>'target'
                     ELSE coalesce(d.brief->'finalization'->>'target',
                                   d.brief->>'branch')
                END AS target
           FROM ticket_definition d
          WHERE d.tenant = in_tenant AND d.project = in_project
            AND d.brief->>'landing' IN ('Serialized', 'Stacked')
            AND d.brief->'finalization'->>'mode' IN ('Push', 'PullRequestMerge')
       ), candidate AS (
         SELECT q.ticket, p.phase, q.brief, q.repository, q.target,
                ${ticketFinalizationRankFunction}(in_tenant, in_project, q.ticket) AS rank
           FROM queued q
           JOIN ticket_projection p
             ON p.tenant = in_tenant AND p.project = in_project
            AND p.ticket = q.ticket
          WHERE p.phase IN ('Work', 'Evaluation', 'Finalization')
       ), event AS (
         SELECT j.seq, j.entry::jsonb->'event' AS event
           FROM journal_entry j
          WHERE j.tenant = in_tenant AND j.project = in_project
            AND j.entry IS JSON OBJECT
       ), stop AS (
         SELECT e.seq,
                CASE e.event->>'type'
                  WHEN 'TicketRevoked' THEN e.event->'value'
                  ELSE e.event->'value'->'ticket'
                END AS ticket
           FROM event e
          WHERE e.event->>'type' IN (
                  'TicketRevoked', 'TicketFinalizationSucceeded',
                  'TicketFinalizationUnavailable',
                  'TicketEvaluationReworkStarted',
                  'TicketEvaluationFailureEscalated',
                  'TicketEvaluationBlocked', 'TicketWorkProcessFailed',
                  'TicketWorkExecutionUnavailable')
             OR (e.event->>'type' = 'TicketFinalizationNeedsWork'
                 AND EXISTS (
                   SELECT 1
                     FROM finalization_request f
                     JOIN finalization_attempt a
                       ON a.tenant = f.tenant AND a.project = f.project
                      AND a.request = f.request
                    WHERE f.tenant = in_tenant AND f.project = in_project
                      AND f.kind = 'RunFinalizer'
                      AND to_jsonb(f.ticket) = e.event->'value'->'ticket'
                      AND to_jsonb(f.work_cycle) = e.event->'value'->'workCycle'
                      AND to_jsonb(f.finalization_generation)
                          = e.event->'value'->'generation'
                      AND a.outcome = 'Failed'
                      AND (a.failure_kind IS NULL
                           OR a.failure_kind NOT IN ('RecheckRequired', 'Restack'))))
       )
       SELECT c.ticket, c.phase, c.brief::text, c.rank,
              (SELECT j.committed_at
                 FROM journal_entry j
                WHERE j.tenant = in_tenant AND j.project = in_project
                  AND c.rank IS NOT NULL
                  AND j.seq = greatest(c.rank, (
                        SELECT max(s.seq)
                          FROM queued q
                          CROSS JOIN LATERAL (
                            SELECT max(f.authorizing_seq) AS seq
                              FROM finalization_request f
                             WHERE f.tenant = in_tenant AND f.project = in_project
                               AND f.ticket = q.ticket AND f.kind = 'RunFinalizer'
                               AND (f.authorizing_seq, f.ticket) < (c.rank, c.ticket)) ahead
                          CROSS JOIN LATERAL (
                            SELECT min(t.seq) AS seq
                              FROM stop t
                             WHERE t.ticket = to_jsonb(q.ticket)
                               AND t.seq > ahead.seq) s
                         WHERE q.ticket <> c.ticket
                           AND q.repository = c.repository
                           AND q.target IS NOT DISTINCT FROM c.target)))
         FROM candidate c
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
