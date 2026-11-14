/**
 * A Stacked ticket pending unstacked behind the holder of its reference is sent
 * back to Work to evaluate over the queue ahead of it, as a `Restack` failure.
 *
 * `finalization_attempt_failure_kind_is_known` IS REPLACED, admitting
 * `Restack` beside the four kinds that stood, and
 * `finalization_attempt_recheck_commit_is_whole` IS REPLACED, keeping the
 * accepted commit on a `Restack` failure as it is kept on a `RecheckRequired`
 * one, so no stored row is refused by either.
 *
 * `finalization_attempt` GAINS `restack_tickets` AND `restack_commits`, the
 * line a `Restack` failure was sent back to stack over, bottom first and paired
 * by position, kept exactly on a `Restack` failure. Every row there is keeps
 * neither, which every row there is may. The finalizer's insert is granted on
 * the whole table, so its grant does not change.
 *
 * `ticket_finalization_rank` IS REPLACED, so a `Restack` send-back links a
 * chain of work cycles as a `RecheckRequired` one does and the ticket keeps its
 * rank. Replacing it keeps its owner and its grants.
 *
 * `read_ticket_evaluation_stacks` IS DROPPED AND RECREATED, because a result
 * type cannot change in place: beside 161's columns it answers whether the
 * cycle's previous one was sent back by a `Restack`. Dropping it takes its
 * owner and its grant with it, so both are given again as 161 gave them.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketEvaluationStacksReadFunction,
  ticketFinalizationRankFunction,
  type Migration,
} from "../shared.ts";
import { textArray } from "./085-dependencies-change.ts";

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

/** A comma-separated run of object identities, as `array_to_string` writes a line's commits. */
const gitObjects =
  "'^([0-9a-f]{40}|[0-9a-f]{64})(,([0-9a-f]{40}|[0-9a-f]{64}))*$'";

/** The most tickets a stack holds beneath it, as `stackChoice.ts`'s `stackDepthMax` was when this was written. */
const restackDepthMax = 3;

/** The failure kinds 116 admitted, and the one this adds. */
const failureKinds = [
  "MergeConflict",
  "PreparationFailed",
  "QueueChecksFailed",
  "RecheckRequired",
  "Restack",
];

const rankSignature = `public.${ticketFinalizationRankFunction}(in_tenant text, in_project text, in_ticket bigint)`;

const stacksSignature = `public.${ticketEvaluationStacksReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

export const migration174: Migration = {
  version: 174,
  name: "a Stacked ticket pending unstacked is sent back to re-stack over the queue ahead of it",
  statements: [
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_failure_kind_is_known,
       ADD CONSTRAINT finalization_attempt_failure_kind_is_known
         CHECK (((failure_kind IS NULL) OR (failure_kind = ANY (${textArray(failureKinds)}))))`,
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_recheck_commit_is_whole,
       ADD CONSTRAINT finalization_attempt_recheck_commit_is_whole
         CHECK (((recheck_commit IS NULL) = ((failure_kind IS NULL) OR (failure_kind <> ALL (${textArray(["RecheckRequired", "Restack"])}))))
                AND ((recheck_commit IS NULL) OR (recheck_commit ~ ${gitObject}::text)))`,
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN restack_tickets bigint[],
       ADD COLUMN restack_commits text[]`,
    `ALTER TABLE public.finalization_attempt
       ADD CONSTRAINT finalization_attempt_restack_line_is_whole
         CHECK (((restack_tickets IS NULL) = (failure_kind IS DISTINCT FROM 'Restack'::text))
                AND ((restack_commits IS NULL) = (restack_tickets IS NULL))
                AND ((restack_tickets IS NULL)
                     OR ((cardinality(restack_tickets) >= 1)
                         AND (cardinality(restack_tickets) <= ${String(restackDepthMax)})
                         AND (cardinality(restack_commits) = cardinality(restack_tickets))
                         AND (array_position(restack_tickets, NULL) IS NULL)
                         AND (array_position(restack_commits, NULL) IS NULL)
                         AND (array_to_string(restack_commits, ',') ~ ${gitObjects}::text))))`,
    `CREATE OR REPLACE FUNCTION ${rankSignature} RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT min(f.authorizing_seq)
         FROM finalization_request f
        WHERE f.tenant = in_tenant AND f.project = in_project
          AND f.ticket = in_ticket AND f.kind = 'RunFinalizer'
          AND NOT EXISTS (
            SELECT 1
              FROM finalization_request g
              JOIN finalization_attempt a
                ON a.tenant = g.tenant AND a.project = g.project
               AND a.request = g.request
             WHERE g.tenant = in_tenant AND g.project = in_project
               AND g.ticket = in_ticket AND g.kind = 'RunFinalizer'
               AND g.authorizing_seq >= f.authorizing_seq
               AND a.outcome = 'Failed'
               AND (a.failure_kind IS NULL
                    OR a.failure_kind NOT IN ('RecheckRequired', 'Restack')))
          AND NOT EXISTS (
            SELECT 1 FROM journal_entry j
             WHERE j.tenant = in_tenant AND j.project = in_project
               AND j.seq > f.authorizing_seq
               AND CASE (CASE WHEN j.entry IS JSON OBJECT
                              THEN j.entry::jsonb->'event'->>'type' END)
                     WHEN 'TicketEvaluationReworkStarted'
                       THEN j.entry::jsonb->'event'->'value'->'ticket'
                            = to_jsonb(in_ticket)
                     WHEN 'TicketWorkResumed'
                       THEN j.entry::jsonb->'event'->'value'
                            = to_jsonb(in_ticket)
                     WHEN 'TicketEvaluationResumed'
                       THEN j.entry::jsonb->'event'->'value'
                            = to_jsonb(in_ticket)
                     WHEN 'TicketFinalizationResumed'
                       THEN j.entry::jsonb->'event'->'value'
                            = to_jsonb(in_ticket)
                     ELSE false
                   END)
     $$`,
    `DROP FUNCTION ${stacksSignature}`,
    `CREATE FUNCTION ${stacksSignature}
       RETURNS TABLE(work_cycle bigint, target_ref text, tip text,
                     beneath_tickets bigint[], beneath_commits text[],
                     reason text, restacked boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       WITH decided AS (
         SELECT s.work_cycle, s.target_ref, s.tip, NULL::text AS reason
           FROM evaluation_stack s
          WHERE s.tenant = in_tenant AND s.project = in_project
            AND s.ticket = in_ticket
         UNION ALL
         SELECT n.work_cycle, NULL, NULL, n.reason
           FROM evaluation_stack_none n
          WHERE n.tenant = in_tenant AND n.project = in_project
            AND n.ticket = in_ticket
       )
       SELECT c.work_cycle, c.target_ref, c.tip,
              CASE WHEN c.reason IS NULL THEN
                ARRAY(SELECT b.beneath_ticket FROM evaluation_stack_beneath b
                       WHERE b.tenant = in_tenant AND b.project = in_project
                         AND b.ticket = in_ticket AND b.work_cycle = c.work_cycle
                       ORDER BY b.depth) END,
              CASE WHEN c.reason IS NULL THEN
                ARRAY(SELECT b.beneath_commit FROM evaluation_stack_beneath b
                       WHERE b.tenant = in_tenant AND b.project = in_project
                         AND b.ticket = in_ticket AND b.work_cycle = c.work_cycle
                       ORDER BY b.depth) END,
              c.reason,
              EXISTS (
                SELECT 1
                  FROM finalization_request f
                  JOIN finalization_attempt a
                    ON a.tenant = f.tenant AND a.project = f.project
                   AND a.request = f.request
                 WHERE f.tenant = in_tenant AND f.project = in_project
                   AND f.ticket = in_ticket AND a.failure_kind = 'Restack'
                   AND f.work_cycle = (
                         SELECT max(g.work_cycle) FROM finalization_request g
                          WHERE g.tenant = in_tenant AND g.project = in_project
                            AND g.ticket = in_ticket
                            AND g.work_cycle < c.work_cycle))
         FROM decided c
         JOIN ticket_definition d
           ON d.tenant = in_tenant AND d.project = in_project
          AND d.ticket = in_ticket
        WHERE d.brief->>'landing' = 'Stacked'
        ORDER BY c.work_cycle DESC
        LIMIT greatest(in_count, 0)
     $$`,
    `ALTER FUNCTION ${stacksSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${stacksSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${stacksSignature} TO ${apiRole}`,
  ],
};
