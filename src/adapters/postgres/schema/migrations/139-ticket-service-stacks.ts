/**
 * The finalizer prepares the stack an evaluation runs over, and the ticket
 * service reads what it prepared.
 *
 * `evaluation_stack_none` IS THE FINALIZER'S DECISION TO EVALUATE A CYCLE
 * UNSTACKED, with the reason it came to it. A cycle is left a stack row or this
 * one, never both, and neither is ever changed or deleted. Both are written in
 * the finalizer's one transaction that preparing the cycle is, so the ticket
 * service reading neither finds a cycle that is not yet prepared.
 *
 * THE FINALIZER IS GRANTED `SELECT` AND `INSERT` ON IT, and `SELECT` on the
 * request relation's ticket, which is how it finds a cycle that has already
 * begun evaluating and so is not prepared afterwards.
 *
 * THE TICKET SERVICE IS GRANTED `SELECT` ON THE STACK RECORD, ITS BENEATH ROWS
 * AND THIS DECISION, and nothing else of the stack: no write, no queue read, no
 * door. It cannot choose a stack, publish one or change what was chosen.
 */

import { finalizerRole, ticketServiceRole, type Migration } from "../shared.ts";

const reasons = ["Unchosen", "Conflicted", "Unpublished"] as const;

/** Refuses a row of `table` for a cycle that `other` already holds, so a cycle is left one or the other. */
function exclusion(table: string, other: string): string {
  return `CREATE FUNCTION public.${table}_is_not_${other}() RETURNS trigger
       LANGUAGE plpgsql
       AS $$
       BEGIN
         IF EXISTS (SELECT 1 FROM public.${other} o
                     WHERE o.tenant = NEW.tenant AND o.project = NEW.project
                       AND o.ticket = NEW.ticket AND o.work_cycle = NEW.work_cycle) THEN
           RAISE EXCEPTION 'a work cycle is prepared once, as a stack or as none'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$;
     CREATE TRIGGER ${table}_is_not_${other} BEFORE INSERT ON public.${table}
       FOR EACH ROW EXECUTE FUNCTION public.${table}_is_not_${other}()`;
}

export const migration139: Migration = {
  version: 139,
  name: "the finalizer prepares the stack an evaluation runs over",
  statements: [
    `CREATE TABLE public.evaluation_stack_none (
       tenant text NOT NULL,
       project text NOT NULL,
       ticket bigint NOT NULL
         CONSTRAINT evaluation_stack_none_ticket_is_positive CHECK (ticket >= 1),
       work_cycle bigint NOT NULL
         CONSTRAINT evaluation_stack_none_cycle_is_positive CHECK (work_cycle >= 1),
       reason text NOT NULL
         CONSTRAINT evaluation_stack_none_reason_is_known
         CHECK (reason = ANY (ARRAY[${reasons.map((reason) => `'${reason}'::text`).join(", ")}])),
       decided_at timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (tenant,project,ticket,work_cycle),
       CONSTRAINT evaluation_stack_none_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TRIGGER evaluation_stack_none_is_immutable BEFORE DELETE OR UPDATE ON public.evaluation_stack_none
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `CREATE FUNCTION public.evaluation_stack_removal_names_a_cycle() RETURNS trigger
       LANGUAGE plpgsql
       AS $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM public.evaluation_stack o
                         WHERE o.tenant = NEW.tenant AND o.project = NEW.project
                           AND o.ticket = NEW.ticket AND o.work_cycle = NEW.work_cycle)
            AND NOT EXISTS (SELECT 1 FROM public.evaluation_stack_none o
                             WHERE o.tenant = NEW.tenant AND o.project = NEW.project
                               AND o.ticket = NEW.ticket AND o.work_cycle = NEW.work_cycle) THEN
           RAISE EXCEPTION 'a removal names a prepared work cycle'
             USING ERRCODE = 'foreign_key_violation';
         END IF;
         RETURN NEW;
       END $$`,
    `CREATE TRIGGER evaluation_stack_removal_names_a_cycle BEFORE INSERT ON public.evaluation_stack_removal
       FOR EACH ROW EXECUTE FUNCTION public.evaluation_stack_removal_names_a_cycle()`,
    exclusion("evaluation_stack", "evaluation_stack_none"),
    exclusion("evaluation_stack_none", "evaluation_stack"),
    `GRANT SELECT,INSERT ON TABLE public.evaluation_stack_none TO ${finalizerRole}`,
    `GRANT SELECT(tenant,project,request,ticket) ON TABLE public.execution_request TO ${finalizerRole}`,
    `GRANT SELECT ON TABLE public.evaluation_stack, public.evaluation_stack_beneath, public.evaluation_stack_none TO ${ticketServiceRole}`,
  ],
};
