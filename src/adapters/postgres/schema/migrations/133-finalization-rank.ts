/**
 * The finalizer asks a ticket's rank on its reference, so the order a
 * Serialized queue lands in is derived from the journal and stored nowhere.
 *
 * `ticket_finalization_rank` IS A DOOR, NOT A GRANT. It answers the position
 * of the ticket's earliest `RunFinalizer` request since its chain of work
 * cycles last broke, or null where it has none. A chain is the work cycles a
 * `RecheckRequired` send-back links, so a re-check, the re-evaluation after it
 * and an invalidation keep the rank, and these break the chain: an evaluation
 * sending the ticket back to rework, a finalization failure that is not
 * `RecheckRequired`, and a resumption of an escalated ticket. A request
 * survives the break only if it was authorized after the entry that made it,
 * or by it. The journal is read only by the door, and the finalizer still
 * reads none of it. It replaces 119's door, which counted both invalidations
 * as a rework, and 119's door is dropped.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  ticketEvaluationReworkedSinceFunction,
  ticketFinalizationRankFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketFinalizationRankFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration133: Migration = {
  version: 133,
  name: "the finalizer asks a ticket's rank on its reference",
  statements: [
    `DROP FUNCTION public.${ticketEvaluationReworkedSinceFunction}(text, text, bigint, bigint)`,
    `CREATE FUNCTION ${signature} RETURNS bigint
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
               AND a.failure_kind IS DISTINCT FROM 'RecheckRequired')
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
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${finalizerRole}`,
  ],
};
