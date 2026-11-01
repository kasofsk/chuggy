/**
 * The API reads the refusals that still bind: the standing ones whose ticket
 * has not moved past the version it was refused at.
 *
 * THE COMPARISON IS BELOW THE BOUND. A refusal on a ticket that is no longer a
 * candidate stands for good, because a lift names only what the lead was shown
 * and it is shown no ticket that is not a candidate.
 * `read_standing_agentic_refusals` answers the lowest tickets, so those rows
 * would fill its page and push out a refusal that binds, whichever side of it
 * the caller compared.
 *
 * `agenticRefusalsAnsweredMax` plus the row that says there is more, as it
 * stands here, is written out rather than read from it.
 */

import {
  agenticRefusalBindingReadFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${agenticRefusalBindingReadFunction}(in_tenant text, in_project text, in_max bigint)`;

export const migration104: Migration = {
  version: 104,
  name: "the API reads the refusals that still bind",
  statements: [
    `CREATE FUNCTION ${signature} RETURNS TABLE(ticket bigint, ticket_version bigint, reason text, selector_decision text, recorded_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT latest.ticket,latest.ticket_version,latest.reason,
              latest.selector_decision,latest.recorded_at
         FROM (SELECT DISTINCT ON (r.ticket)
                      r.ticket,r.event,r.ticket_version,r.reason,
                      r.selector_decision,r.recorded_at
                 FROM selector_agentic_refusal r
                WHERE r.tenant=in_tenant AND r.project=in_project
                ORDER BY r.ticket,r.ordinal DESC) latest
         JOIN ticket_projection t
           ON t.tenant=in_tenant AND t.project=in_project
          AND t.ticket=latest.ticket
        WHERE latest.event='Refused' AND t.seq=latest.ticket_version
        ORDER BY latest.ticket
        LIMIT least(coalesce(in_max,33),33)
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
