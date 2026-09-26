import {
  boundaryOwnerRole,
  poolPlaneRole,
  statusMoveFunction,
  workerPoolReleaseFunction,
  type Migration,
} from "../shared.ts";

/**
 * A pool that gives back an assignment it claimed ends the attempt, and the
 * attempt keeps the pool's name. The scheduler opens no attempt for an
 * execution a pool has claimed one of, which is `model/runner.qnt` placing
 * nothing again once an assignment is made. It reads that from `pool`, so a
 * release that cleared the column and parked the row for another claim was
 * the one path that put an assigned placement back to waiting.
 *
 * THE POOL PLANE IS GRANTED THE RELEASE AND NOT THE STATE. `UPDATE(state)`
 * would let the plane end or report any attempt. The function ends only the
 * placing attempt the calling registration holds under the assignment named,
 * on the terms the plane's own statement held it to, and withdraws it as
 * `PlacementUnavailable`, spending nothing and pacing nothing. It takes the
 * execution's row before the attempt's, which is the order the scheduler
 * takes them in.
 *
 * AND WHAT THE PLANE READ AND WROTE AN EXECUTION'S BACKOFF WITH IS TAKEN
 * BACK. A claim no longer reads the backoff, and nothing the plane runs updates
 * an execution, so the status-move function that update's trigger called goes
 * too. `UPDATE(placement_backoff_from)` stays, because a claim locks the
 * execution row and PostgreSQL lets only a role that may update some column
 * of a row lock it.
 */
export const migration023: Migration = {
  version: 23,
  name: "a pool's release ends the attempt it claimed",
  statements: [
    `CREATE FUNCTION public.${workerPoolReleaseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE bound record;
     BEGIN
       SELECT a.execution INTO bound FROM execution_attempt a
        WHERE a.tenant=in_tenant AND a.project=in_project AND a.assignment=in_assignment;
       IF NOT FOUND THEN RETURN false; END IF;
       PERFORM 1 FROM execution e
        WHERE e.tenant=in_tenant AND e.project=in_project AND e.execution=bound.execution
          FOR UPDATE;
       UPDATE execution_attempt a
          SET state='Withdrawn',evidence='PlacementUnavailable',ended_at=now(),
              lease_owner=NULL,lease_expires_at=NULL,capability_secret_digest=NULL
        WHERE a.tenant=in_tenant AND a.project=in_project
          AND a.assignment=in_assignment AND a.pool=in_pool
          AND a.pool_principal=in_principal AND a.state='Placing'
          AND EXISTS(SELECT 1 FROM worker_pool w
            WHERE w.tenant=a.tenant AND w.project=a.project AND w.pool=a.pool
              AND w.principal=in_principal)
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1);
       RETURN FOUND;
     END $$`,
    `ALTER FUNCTION public.${workerPoolReleaseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION public.${workerPoolReleaseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION public.${workerPoolReleaseFunction}(in_tenant text, in_project text, in_pool text, in_principal text, in_assignment text) TO ${poolPlaneRole}`,
    `REVOKE SELECT(placement_backoff_from) ON TABLE public.execution FROM ${poolPlaneRole}`,
    `REVOKE EXECUTE ON FUNCTION public.${statusMoveFunction}(before text, after text) FROM ${poolPlaneRole}`,
  ],
};
