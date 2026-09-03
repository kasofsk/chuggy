/**
 * The decision log answers what a decision's dispatches did, not only what it
 * chose.
 *
 * WHAT WAS CHOSEN IS THE RESULT AND WHAT LANDED IS THE RELATION. A decision
 * whose three dispatches produced one ticket and two refusals reads as three
 * dispatches out of the retained result alone, which is the reading the console
 * and the lead's own decision-log tool both had. The delivery rows are where
 * the answer is, and they are keyed by the decision, so the interaction read
 * carries them beside the row rather than making a second door for them.
 *
 * THE JOIN IS BOUNDED BY THE CEILING A DECISION IS PARSED UNDER. No decision
 * may name more dispatches than `leadDispatchesMax`, so no decision has more
 * rows than that; the LIMIT states it rather than trusting it, because a page
 * of the log is answered under the API's own byte bound.
 *
 * A FUNCTION RE-CREATED WITHOUT ITS REVOKE IS PUBLIC-EXECUTABLE. The return
 * type changes, so this is a drop and a create, and dropping takes the owner,
 * the revoke and both grants with it — the API's and the selector service's,
 * which reads the same door for its own decision tail. All four are re-issued
 * below and asserted by a case.
 */

import { selectorHistoryLimitMax } from "../../../../contract/http.ts";
import { leadDispatchesMax } from "../../../../interpreter/selector.ts";
import {
  apiRole,
  boundaryOwnerRole,
  selectorInteractionsReadFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";
import { interactionsReadSignature } from "./059-lead-decisions.ts";

/**
 * One decision's deliveries in the row that carries them, as JSON. A decision
 * that dispatched nothing has no rows and so answers null, which is the reading
 * every column of a set-returning function already has and one the reader has a
 * case for.
 */
const deliveriesOfDecision = `
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'ticket',landed.ticket,'state',landed.state,'outcome',landed.outcome)
             ORDER BY landed.ticket)::text AS dispatches
      FROM (SELECT d.ticket,d.state,d.outcome
              FROM selector_proposal_delivery d
             WHERE d.selector_decision=i.selector_decision
             ORDER BY d.ticket
             LIMIT ${leadDispatchesMax}) landed) settled ON true`;

const interactionsReadAnswersLandings = [
  `DROP FUNCTION ${selectorInteractionsReadFunction}(${interactionsReadSignature})`,
  `CREATE FUNCTION ${selectorInteractionsReadFunction}(
     in_tenant text,in_project text,in_after bigint,in_max bigint,
     in_newest_first boolean)
     RETURNS TABLE(selector_decision text,ordinal bigint,instructions_version text,
                   instructions text,observed_view text,observed_token text,
                   context text,tool_activity text,result text,
                   implementation_revision text,model_revision text,
                   policy_revision text,accounting text,
                   started_at timestamptz,completed_at timestamptz,
                   observed_view_chunks text[],context_chunks text[],
                   tool_activity_chunks text[],dispatches text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT i.selector_decision,i.ordinal,i.instructions_version,i.instructions,
              i.observed_view,i.observed_token,i.context,i.tool_activity,i.result,
              i.implementation_revision,i.model_revision,i.policy_revision,
              i.accounting,i.started_at,i.completed_at,
              coalesce(viewed.chunks,'{}'::text[]),
              coalesce(held.chunks,'{}'::text[]),
              coalesce(used.chunks,'{}'::text[]),
              settled.dispatches
         FROM selector_interaction i
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='ObservedView') viewed ON true
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='Context') held ON true
         LEFT JOIN LATERAL (
           SELECT array_agg(r.content ORDER BY r.ordinal) AS chunks
             FROM selector_interaction_resource r
            WHERE r.selector_decision=i.selector_decision
              AND r.kind='ToolActivity') used ON true${deliveriesOfDecision}
        WHERE i.tenant=in_tenant AND i.project=in_project
          AND (in_newest_first IS TRUE OR i.ordinal>coalesce(in_after,0))
        ORDER BY CASE WHEN in_newest_first IS TRUE THEN -i.ordinal ELSE i.ordinal END
        LIMIT least(coalesce(in_max,${selectorHistoryLimitMax}),
                    ${selectorHistoryLimitMax})
     $$`,
  `ALTER FUNCTION ${selectorInteractionsReadFunction}(${interactionsReadSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION
     ${selectorInteractionsReadFunction}(${interactionsReadSignature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION
     ${selectorInteractionsReadFunction}(${interactionsReadSignature}) TO ${apiRole}`,
  `GRANT EXECUTE ON FUNCTION
     ${selectorInteractionsReadFunction}(${interactionsReadSignature})
     TO ${selectorServiceRole}`,
];

/** The decision log carries the landing of every dispatch it names. */
export const migration065: Migration = {
  version: 65,
  name: "the decision log says which of a decision's dispatches landed",
  statements: [...interactionsReadAnswersLandings],
};
