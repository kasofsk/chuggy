/**
 * An evaluation of a Stacked ticket may run over the tickets ahead of it on
 * its reference, and the stack it ran over is kept.
 *
 * `evaluation_stack` HOLDS ONE ROW PER TICKET AND WORK CYCLE, WRITTEN ONCE BY
 * THE FINALIZER BEFORE THE CYCLE'S FIRST EVALUATION SPAWNS: the tip of the
 * reference it was built on, and the commit and tree of the stack.
 * `evaluation_stack_beneath` holds the tickets beneath it, bottom first at depth
 * 1, each with the accepted commit it must land. A cycle with no row was
 * evaluated unstacked. Neither is ever changed, so a stack that stopped
 * standing is not edited: whether it stands is derived from the landings since
 * the tip and the tickets still beneath, and stored nowhere.
 *
 * `evaluation_stack_removal` RECORDS THAT A STACK'S COMMIT WAS TAKEN DOWN from
 * the reference it was published on, once, so a sweep does not take it down
 * twice. A cycle decided Unpublished is recorded the same way, once its ref
 * is gone.
 *
 * `ticket_stacked_failures` IS A DOOR, NOT A GRANT. It counts the
 * `TicketEvaluationReworkStarted` events of a ticket whose evaluated work cycle
 * has a stack row, which is what the cap on stacked failures counts. An
 * invalidation is a different event and is not one. The finalizer still reads
 * nothing of the journal itself.
 *
 * THE FINALIZER IS GRANTED `SELECT` AND `INSERT` ON ALL THREE RELATIONS and no
 * `UPDATE` or `DELETE`; `project_creation_is_immutable` refuses both of every
 * role.
 */

import {
  boundaryOwnerRole,
  finalizerRole,
  ticketStackedFailuresFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${ticketStackedFailuresFunction}(in_tenant text, in_project text, in_ticket bigint)`;

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

/** The most tickets beneath a stack. */
export const evaluationStackDepthMaxAt138 = 3;

/** The work cycle a ticket's rework event evaluated, null for any other entry. */
const evaluatedCycle = `CASE WHEN j.entry IS JSON OBJECT
                       AND j.entry::jsonb->'event'->>'type' = 'TicketEvaluationReworkStarted'
                       AND j.entry::jsonb->'event'->'value'->'ticket' = to_jsonb(in_ticket)
                  THEN coalesce(
                    j.entry::jsonb#>>'{event,value,report,value,result,obligation,task,value,workCycle}',
                    j.entry::jsonb#>>'{event,value,report,value,failure,task,value,workCycle}')::bigint
                  END`;

export const migration138: Migration = {
  version: 138,
  name: "an evaluation over a stack keeps the stack it ran over",
  statements: [
    `CREATE TABLE public.evaluation_stack (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL
         CONSTRAINT evaluation_stack_ticket_is_positive CHECK (ticket >= 1),
       work_cycle bigint NOT NULL
         CONSTRAINT evaluation_stack_cycle_is_positive CHECK (work_cycle >= 1),
       repository text NOT NULL
         CONSTRAINT evaluation_stack_repository_is_bounded CHECK (length(repository) BETWEEN 1 AND 256),
       target_ref text NOT NULL
         CONSTRAINT evaluation_stack_target_is_bounded CHECK (length(target_ref) BETWEEN 1 AND 256),
       tip text NOT NULL
         CONSTRAINT evaluation_stack_tip_is_an_object_id CHECK (tip ~ ${gitObject}),
       stack_commit text NOT NULL
         CONSTRAINT evaluation_stack_commit_is_an_object_id CHECK (stack_commit ~ ${gitObject}),
       stack_tree text NOT NULL
         CONSTRAINT evaluation_stack_tree_is_an_object_id CHECK (stack_tree ~ ${gitObject}),
       recorded_at timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,ticket,work_cycle),
       CONSTRAINT evaluation_stack_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TABLE public.evaluation_stack_beneath (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL,
       work_cycle bigint NOT NULL,
       depth integer NOT NULL
         CONSTRAINT evaluation_stack_beneath_depth_is_bounded
         CHECK (depth BETWEEN 1 AND ${String(evaluationStackDepthMaxAt138)}),
       beneath_ticket bigint NOT NULL
         CONSTRAINT evaluation_stack_beneath_ticket_is_positive CHECK (beneath_ticket >= 1),
       beneath_commit text NOT NULL
         CONSTRAINT evaluation_stack_beneath_commit_is_an_object_id CHECK (beneath_commit ~ ${gitObject}),
       PRIMARY KEY (tenant,project,ticket,work_cycle,depth),
       CONSTRAINT evaluation_stack_beneath_is_once
         UNIQUE (tenant,project,ticket,work_cycle,beneath_ticket),
       CONSTRAINT evaluation_stack_beneath_is_another_ticket
         CHECK (beneath_ticket <> ticket),
       CONSTRAINT evaluation_stack_beneath_names_a_stack
         FOREIGN KEY (tenant,project,ticket,work_cycle)
         REFERENCES public.evaluation_stack(tenant,project,ticket,work_cycle))`,
    `CREATE TABLE public.evaluation_stack_removal (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL,
       work_cycle bigint NOT NULL,
       removed_at timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,ticket,work_cycle))`,
    `CREATE TRIGGER evaluation_stack_is_immutable BEFORE DELETE OR UPDATE ON public.evaluation_stack
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `CREATE TRIGGER evaluation_stack_beneath_is_immutable BEFORE DELETE OR UPDATE ON public.evaluation_stack_beneath
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `CREATE TRIGGER evaluation_stack_removal_is_immutable BEFORE DELETE OR UPDATE ON public.evaluation_stack_removal
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT SELECT,INSERT ON TABLE public.evaluation_stack, public.evaluation_stack_beneath, public.evaluation_stack_removal TO ${finalizerRole}`,
    `GRANT SELECT ON TABLE public.evaluation_stack TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature} RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT count(*)
         FROM journal_entry j
         JOIN evaluation_stack s
           ON s.tenant = j.tenant AND s.project = j.project
          AND s.ticket = in_ticket AND s.work_cycle = ${evaluatedCycle}
        WHERE j.tenant = in_tenant AND j.project = in_project
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${finalizerRole}`,
  ],
};
