/**
 * An execution's placement and its end are published, so the selector observes
 * its project on the next pass.
 *
 * `Execution` JOINS THE KINDS THE PUBLICATION LOG ADMITS, and a move of an
 * execution's status into `Admitted`, `Terminal` or `Cancelled` publishes one
 * naming the execution. `Admitted` is the placement: it is the move by which an
 * execution takes a slot, and every execution makes it, whether the scheduler
 * places its attempt or a pool claims it. Every other move of the row, and
 * every attempt, run and artifact row, still only appends to the change log.
 *
 * ONE MOVE APPENDS ONE CHANGE. A publication reaches the change log through
 * `project_notification_appends_a_change`, so the function the move trigger
 * runs publishes or appends, never both.
 *
 * IT IS A DEFINER because the scheduler moves the row in its own statements
 * and may append a change but not publish one; the definer publishes nothing
 * but the execution the move is of.
 */

import {
  boundaryOwnerRole,
  notificationPublishFunction,
  projectChangeAppendFunction,
  projectChangeExecutionMoveFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${projectChangeExecutionMoveFunction}()`;

export const migration094: Migration = {
  version: 94,
  name: "an execution's placement and its end are published",
  statements: [
    `ALTER TABLE public.project_notification
       DROP CONSTRAINT project_notification_kind_is_known,
       ADD CONSTRAINT project_notification_kind_is_known
         CHECK ((kind = ANY (ARRAY['Operation'::text, 'Ticket'::text, 'Draft'::text, 'Configuration'::text, 'Project'::text, 'Execution'::text])))`,
    `CREATE FUNCTION ${signature} RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     BEGIN
       IF NEW.status IS DISTINCT FROM OLD.status
          AND NEW.status IN ('Admitted', 'Terminal', 'Cancelled') THEN
         PERFORM ${notificationPublishFunction}(
           NEW.tenant,NEW.project,'Execution',NEW.execution,NULL,NULL);
       ELSE
         PERFORM ${projectChangeAppendFunction}(
           NEW.tenant,NEW.project,'Execution',NEW.execution);
       END IF;
       RETURN NULL;
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `DROP TRIGGER execution_move_appends_a_change ON public.execution`,
    `CREATE TRIGGER execution_move_appends_a_change AFTER UPDATE OF status, outcome, result_manifest, terminal_at ON public.execution FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) OR (old.outcome IS DISTINCT FROM new.outcome) OR (old.result_manifest IS DISTINCT FROM new.result_manifest) OR (old.terminal_at IS DISTINCT FROM new.terminal_at))) EXECUTE FUNCTION ${signature}`,
  ],
};
