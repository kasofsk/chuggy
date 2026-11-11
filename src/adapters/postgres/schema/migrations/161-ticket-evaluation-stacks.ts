/**
 * The API reads what the finalizer prepared each work cycle of a ticket's
 * evaluation over.
 *
 * `read_ticket_evaluation_stacks` IS A DOOR, NOT A GRANT. It answers the
 * newest `in_count` work cycles of one Stacked ticket that the finalizer left a
 * stack or a decision for, newest first: a stack's reference and tip and the
 * tickets beneath it bottom first, each with its commit, or a decision's
 * reason. A ticket that is not Stacked answers nothing, and so does a cycle
 * with neither. The API is granted this door and nothing on the relations
 * behind it.
 *
 * THE BOUNDARY OWNER IS GRANTED `SELECT` ON `evaluation_stack_none`, the one
 * relation the door reads that it did not already reach.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ticketEvaluationStacksReadFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketEvaluationStacksReadFunction}(in_tenant text, in_project text, in_ticket bigint, in_count integer)`;

export const migration161: Migration = {
  version: 161,
  name: "the API reads what each work cycle's evaluation was stacked over",
  statements: [
    `GRANT SELECT ON TABLE public.evaluation_stack_none TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature}
       RETURNS TABLE(work_cycle bigint, target_ref text, tip text,
                     beneath_tickets bigint[], beneath_commits text[],
                     reason text)
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
              c.reason
         FROM decided c
         JOIN ticket_definition d
           ON d.tenant = in_tenant AND d.project = in_project
          AND d.ticket = in_ticket
        WHERE d.brief->>'landing' = 'Stacked'
        ORDER BY c.work_cycle DESC
        LIMIT greatest(in_count, 0)
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
