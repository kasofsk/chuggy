/**
 * Which of a named set of tickets stand refused, answered for exactly that set.
 *
 * A PAGE OF STANDING IS NOT AN ANSWER ABOUT A PAGE OF CANDIDATES.
 * `standing_agentic_refusals` answers a project's standing refusals in ticket
 * order under a ceiling, so an observation excluding its candidates against
 * that page excludes nothing from the tail a project past the ceiling stands
 * on: the lead is shown tickets it has already refused and refuses them again,
 * once per observation, until the ticket is authored again
 * (kasofsk/chuggy#574). The question an observation asks is about the
 * candidates it holds, so this body is given them and the project's total
 * refusal count stops mattering.
 *
 * IT IS BOUNDED BY ITS ARGUMENT AND HOLDS THE ARGUMENT TO A BOUND. A candidate
 * page is at most `dispatchViewPageLimitMax` tickets and a caller naming more
 * is refused rather than served, so the read is finite without a `LIMIT` — and
 * it is a `LIMIT` that would make the answer partial again.
 *
 * THE PAGED READ IS CLOSED TO THE SELECTOR IN THE SAME BREATH. 059 granted it
 * to that role because the exclusion read it, and no selector read opens it
 * once the exclusion is asked about a ticket set; a grant nothing opens is a
 * privilege the startup check cannot tell from one something needs. The API
 * reaches standing through `read_standing_agentic_refusals`, a definer of its
 * own, so the console's page is untouched.
 *
 * STANDING IS STILL THE LATEST ROW PER TICKET, derived here as 059 derives it.
 * A second reading of what standing means would be a second authority on it.
 *
 * SUPERSESSION IS STILL THE READER'S. The row carries the version the lead
 * refused, and whether the candidate shows that version is a comparison the
 * observation already holds both sides of.
 */

import { dispatchViewPageLimitMax } from "../../../../contract/http.ts";
import {
  agenticRefusalStandingAmongFunction,
  agenticRefusalStandingFunction,
  boundaryOwnerRole,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";
import { refusalStandingSignature } from "./059-lead-decisions.ts";

const standingAmongSignature = "text,text,bigint[]";

/**
 * The door this migration opens to the selector role and the door it closes to
 * it, named here beside the grant and the revoke that make them so. The startup
 * privilege check is built from these rather than from a copy of them, because
 * a check listing a door the role no longer holds refuses a healthy process and
 * one omitting a door it opens passes a process that cannot observe.
 */
export const standingAmongDoorOpened: readonly [string, string] = [
  agenticRefusalStandingAmongFunction,
  standingAmongSignature,
];
export const standingAmongDoorClosed: readonly [string, string] = [
  agenticRefusalStandingFunction,
  refusalStandingSignature,
];

/** How many tickets one read may name, which is the candidate page it is asked about. */
const standingAmongTicketsMax = dispatchViewPageLimitMax;

const refusalsAmongACandidatePage = [
  `CREATE FUNCTION ${agenticRefusalStandingAmongFunction}(
     in_tenant text,in_project text,in_tickets bigint[])
     RETURNS TABLE(ticket bigint,ticket_version bigint,reason text,
                   selector_decision text,recorded_at timestamptz)
     LANGUAGE plpgsql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF coalesce(array_length(in_tickets,1),0)>${standingAmongTicketsMax} THEN
         RAISE EXCEPTION 'a standing refusal read names at most % tickets',
           ${standingAmongTicketsMax} USING ERRCODE = 'invalid_parameter_value';
       END IF;
       RETURN QUERY
         SELECT latest.ticket,latest.ticket_version,latest.reason,
                latest.selector_decision,latest.recorded_at
           FROM (SELECT DISTINCT ON (r.ticket)
                        r.ticket,r.event,r.ticket_version,r.reason,
                        r.selector_decision,r.recorded_at
                   FROM selector_agentic_refusal r
                  WHERE r.tenant=in_tenant AND r.project=in_project
                    AND r.ticket=ANY(in_tickets)
                  ORDER BY r.ticket,r.ordinal DESC) latest
          WHERE latest.event='Refused'
          ORDER BY latest.ticket;
     END $$`,
  `ALTER FUNCTION
     ${agenticRefusalStandingAmongFunction}(${standingAmongSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION
     ${agenticRefusalStandingAmongFunction}(${standingAmongSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION
     ${agenticRefusalStandingAmongFunction}(${standingAmongSignature})
     TO ${selectorServiceRole}`,
  `REVOKE EXECUTE ON FUNCTION
     ${agenticRefusalStandingFunction}(${refusalStandingSignature})
     FROM ${selectorServiceRole}`,
];

/** The standing refusals among a ticket set, as the only such read that role keeps. */
export const migration073: Migration = {
  version: 73,
  name: "the standing refusals among a candidate page",
  statements: refusalsAmongACandidatePage,
};
