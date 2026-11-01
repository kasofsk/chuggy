/**
 * The API reads the refusals that bind on the tickets a thread names: the
 * standing ones among exactly those tickets whose ticket has not moved past
 * the version it was refused at.
 *
 * THE TICKETS ARE THE DOOR'S ARGUMENT, NOT A FILTER AFTER IT.
 * `read_standing_agentic_refusals` answers the project's lowest tickets, so a
 * thread's ticket above its bound is never seen, however the caller filters
 * the page. `standing_agentic_refusals_among` takes the tickets already, but it
 * is the selector's door, and the seed reads on the API's pool.
 *
 * `nativeHttpPageItemsMax`, which bounds the tickets a seed names, and
 * `agenticRefusalsAnsweredMax`, which bounds what it is answered, are written
 * out as they stand here rather than read from them.
 */

import {
  agenticRefusalThreadReadFunction,
  apiRole,
  boundaryOwnerRole,
  type Migration,
} from "../shared.ts";

const signature = `public.${agenticRefusalThreadReadFunction}(in_tenant text, in_project text, in_tickets bigint[], in_max bigint)`;

export const migration105: Migration = {
  version: 105,
  name: "the API reads the refusals that bind on the tickets a thread names",
  statements: [
    `CREATE FUNCTION ${signature} RETURNS TABLE(ticket bigint, reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF coalesce(array_length(in_tickets,1),0)>100 THEN
         RAISE EXCEPTION 'a thread refusal read names at most % tickets',
           100 USING ERRCODE = 'invalid_parameter_value';
       END IF;
       RETURN QUERY
         SELECT latest.ticket,latest.reason
           FROM (SELECT DISTINCT ON (r.ticket)
                        r.ticket,r.event,r.ticket_version,r.reason
                   FROM selector_agentic_refusal r
                  WHERE r.tenant=in_tenant AND r.project=in_project
                    AND r.ticket=ANY(in_tickets)
                  ORDER BY r.ticket,r.ordinal DESC) latest
           JOIN ticket_projection t
             ON t.tenant=in_tenant AND t.project=in_project
            AND t.ticket=latest.ticket
          WHERE latest.event='Refused' AND t.seq=latest.ticket_version
          ORDER BY latest.ticket
          LIMIT least(coalesce(in_max,32),32);
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
