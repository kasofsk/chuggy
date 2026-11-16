/**
 * The API reads the pull request a ticket's newest successful landing opened,
 * so a person may have it merged.
 *
 * `read_ticket_proposed_landing` ANSWERS ONE ROW OR NONE: the ticket's newest
 * request concluded by `TicketFinalizationSucceeded`, as the landings door
 * orders them, where that request's proposal holds evidence a create or a
 * reading proved, as the finalizer adopts one, and that evidence records a
 * number, beside the repository the attempt that spent its permit worked
 * against. A newest success that opened no pull request answers none, rather
 * than an older one's. It writes nothing, and only the API may execute it;
 * its owner is granted the proposal's request identity and permit to read
 * them, and no more of the row than it held.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketProposedLandingReadFunction,
  type Migration,
} from "../shared.ts";

const proposedSignature = `public.${ticketProposedLandingReadFunction}(in_tenant text, in_project text, in_ticket bigint)`;

export const migration197: Migration = {
  version: 197,
  name: "the API reads the pull request a ticket's newest success opened",
  statements: [
    `GRANT SELECT (proposal_request, permit)
       ON TABLE public.finalization_change_proposal TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${proposedSignature}
    RETURNS TABLE(repository text, proposal_request text, head_ref text,
                  head_commit text, base_ref text, forge text, remote text,
                  proposal_number bigint, url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
      WITH succeeded AS (
        SELECT DISTINCT e.value->'workCycle' AS work_cycle,
               e.value->'generation' AS generation
          FROM journal_entry j
          CROSS JOIN LATERAL (
            SELECT d->>'type' AS type, d->'value' AS value
              FROM (SELECT CASE WHEN j.entry IS JSON OBJECT
                                THEN j.entry::jsonb->'event' END AS d) x
          ) e
         WHERE j.tenant=in_tenant AND j.project=in_project
           AND e.type='TicketFinalizationSucceeded'
           AND e.value->'ticket'=to_jsonb(in_ticket)
      ), newest AS (
        SELECT f.request
          FROM finalization_request f
          JOIN succeeded s
            ON s.work_cycle=to_jsonb(f.work_cycle)
           AND s.generation=to_jsonb(f.finalization_generation)
         WHERE f.tenant=in_tenant AND f.project=in_project
           AND f.ticket=in_ticket AND f.state='Fulfilled'
         ORDER BY f.authorizing_seq DESC, f.request DESC
         LIMIT 1
      )
      SELECT a.repository, c.proposal_request, c.head_ref, c.head_commit,
             c.base_ref, v.evidence->'identity'->>'forge',
             v.evidence->'identity'->>'remote',
             (v.evidence->'identity'->>'number')::bigint,
             v.evidence->>'url'
        FROM newest n
        JOIN finalization_change_proposal c
          ON c.tenant=in_tenant AND c.project=in_project AND c.request=n.request
        JOIN commit_permit p
          ON p.tenant=in_tenant AND p.project=in_project AND p.permit=c.permit
        JOIN finalization_attempt a
          ON a.tenant=in_tenant AND a.project=in_project AND a.attempt=p.attempt
        CROSS JOIN LATERAL (
          SELECT coalesce(
                   CASE WHEN c.creation IN ('Created','AlreadyExists','Adopted')
                        THEN c.creation_evidence END,
                   CASE WHEN c.reconciliation='Accepted'
                        THEN c.reconciliation_evidence END) AS evidence
        ) v
       WHERE jsonb_typeof(v.evidence->'identity'->'number')='number'
    $$`,
    `ALTER FUNCTION ${proposedSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${proposedSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${proposedSignature} TO ${apiRole}`,
  ],
};
