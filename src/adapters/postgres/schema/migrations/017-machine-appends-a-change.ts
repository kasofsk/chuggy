import type { Migration } from "../shared.ts";

/**
 * An execution the adopted machine moves appends to the project change log, so
 * a live consumer learns of it.
 *
 * NOTHING APPENDED FOR THE ADOPTED MACHINE BEFORE THIS. The appends the
 * baseline installs are triggers on the legacy `execution`, `execution_attempt`
 * and `execution_run*` tables; `ticket_execution` and the `ticket_machine_*`
 * tables carry none. An installation on the adopted model therefore rang the
 * doorbell for sessions and for nothing else, and a consumer reading the log
 * saw a project whose work never moved.
 *
 * THE RESOURCE IS THE TASK KEY, because that is what the execution's own GET
 * route reads by: `/ticket-machine/executions/:task` takes the segment opaque
 * and matches `ticket_execution.task_key` for equality. A row naming anything
 * else — the delivery identity, the obligation, the ticket the task belongs
 * to — would be a row a consumer has to resolve before it can read, and the
 * resolution would be a second index from change rows to routes.
 *
 * SECURITY DEFINER, WHICH THE LEGACY APPENDS ARE NOT. Three roles move a
 * `ticket_execution` row — the ticket service inserts it, the scheduler claims
 * and settles it, the worker plane reports its outcome — and only the first two
 * hold EXECUTE on `append_project_change`. A trigger running as the invoking
 * role would refuse the worker plane's report with `permission denied for
 * function append_project_change`, so the alternative to defining rights here
 * is a grant per role that every later role's migration has to remember. The
 * function reads nothing and writes one row, for the tenant and project of the
 * row that fired it.
 *
 * THE READING DOOR, NEVER THE REASONED ONE. `append_project_change` has a
 * four-argument overload that derives the wake reason from the resource's own
 * state and a five-argument one that is told it; no runtime role holds the
 * second, and `privileges.test.ts` holds that list empty. The derivation reads
 * `ticket_projection`, which is the legacy model's table and has no row for an
 * adopted project, so the reason these rows carry is null — which is what a
 * change with no thread to wake should say.
 */
export const migration017: Migration = {
  version: 17,
  name: "machine-appends-a-change",
  statements: [
    `CREATE FUNCTION ticket_execution_appends_a_change() RETURNS trigger
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$
        BEGIN
          PERFORM append_project_change(
            NEW.tenant,NEW.project,'Execution',NEW.task_key);
          RETURN NULL;
        END $$`,
    `ALTER FUNCTION public.ticket_execution_appends_a_change()
       OWNER TO chuggy_boundary_owner`,
    `CREATE TRIGGER ticket_execution_registration_appends_a_change
       AFTER INSERT ON public.ticket_execution
       FOR EACH ROW EXECUTE FUNCTION public.ticket_execution_appends_a_change()`,
    `CREATE TRIGGER ticket_execution_move_appends_a_change
       AFTER UPDATE OF state, attempt, worker_outcome ON public.ticket_execution
       FOR EACH ROW WHEN (old.state IS DISTINCT FROM new.state
                       OR old.attempt IS DISTINCT FROM new.attempt
                       OR old.worker_outcome IS DISTINCT FROM new.worker_outcome)
       EXECUTE FUNCTION public.ticket_execution_appends_a_change()`,
  ],
};
