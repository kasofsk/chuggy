/**
 * The ticket service chooses the stack an evaluation runs over, so it writes
 * the record with the spawn that starts the evaluation and reads what that
 * choice is made from.
 *
 * IT IS GRANTED `INSERT` AND `SELECT` ON `evaluation_stack` AND
 * `evaluation_stack_beneath`, and `EXECUTE` ON BOTH DOORS the choice counts
 * through, as the finalizer is. `evaluation_stack_removal` is the finalizer's
 * alone. Nothing is granted that changes or deletes a row: the immutability
 * triggers of 135 refuse that of every role.
 */

import {
  ticketFinalizationRankFunction,
  ticketServiceRole,
  ticketStackedFailuresFunction,
  type Migration,
} from "../shared.ts";

const signature = "(in_tenant text, in_project text, in_ticket bigint)";

export const migration136: Migration = {
  version: 136,
  name: "the ticket service records the stack it spawns an evaluation over",
  statements: [
    `GRANT SELECT,INSERT ON TABLE public.evaluation_stack, public.evaluation_stack_beneath TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,ticket,source_request,task,execution,status,outcome) ON TABLE public.execution TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,execution,manifest,verdict) ON TABLE public.execution_result TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,manifest,commit) ON TABLE public.execution_result_source TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,ticket,phase) ON TABLE public.ticket_projection TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,attempt,permit) ON TABLE public.commit_permit TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,permit,verdict) ON TABLE public.finalization_reconciliation TO ${ticketServiceRole}`,
    `GRANT SELECT(tenant,project,request,merge,merge_commit) ON TABLE public.finalization_change_proposal TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION public.${ticketFinalizationRankFunction}${signature} TO ${ticketServiceRole}`,
    `GRANT EXECUTE ON FUNCTION public.${ticketStackedFailuresFunction}${signature} TO ${ticketServiceRole}`,
  ],
};
