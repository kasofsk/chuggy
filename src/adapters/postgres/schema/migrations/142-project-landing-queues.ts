/**
 * The API reads one project's landing queues.
 *
 * `project_landing_queue_candidates` IS A DOOR, NOT A GRANT. It answers one
 * project's tickets that the finalizer's claim reads as queue candidates, by
 * the same filter on the brief and the phase, each with its brief and its rank
 * as `ticket_finalization_rank` answers it. It reads no other project's rows,
 * and which of its tickets queue, and in what order, is the reader's to derive
 * as the finalizer derives it. The API is granted this door and nothing on the
 * relations or the rank's door behind it.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectLandingQueueCandidatesFunction,
  ticketFinalizationRankFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${projectLandingQueueCandidatesFunction}(in_tenant text, in_project text)`;

export const migration142: Migration = {
  version: 142,
  name: "the API reads one project's landing queues",
  statements: [
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(ticket bigint, phase text, brief text, rank bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT d.ticket, p.phase, d.brief::text,
              ${ticketFinalizationRankFunction}(d.tenant, d.project, d.ticket)
         FROM ticket_definition d
         JOIN ticket_projection p
           ON p.tenant = d.tenant AND p.project = d.project AND p.ticket = d.ticket
        WHERE d.tenant = in_tenant AND d.project = in_project
          AND d.brief->>'landing' IN ('Serialized', 'Stacked')
          AND d.brief->'finalization'->>'mode' IN ('Push', 'PullRequestMerge')
          AND p.phase IN ('Work', 'Evaluation', 'Finalization')
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
