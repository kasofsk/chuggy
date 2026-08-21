/**
 * The two narrow things the rest of the installation learns from the execution
 * scheduler, answered by the two functions migration nine grants the API and
 * ticket-service roles and nothing else.
 *
 * NEITHER OF THEM READS A TABLE. Both are `SECURITY DEFINER` functions owned by
 * the boundary owner, and the roles that call them hold no privilege whatever on
 * `execution`, `capacity_account` or `execution_cluster` — the revoke is
 * explicit. So the shape of what crosses the boundary is the function's return
 * type rather than a query this file could widen, and a caller cannot reach a
 * second project's rows by editing a `WHERE`.
 *
 * THE CONTEXT IS ADVISORY AND THE GUARD IS AUTHORITATIVE, which is why they are
 * two functions here as they are two ports above. `project_active_work` answers
 * for exactly the project named, with cluster totals and that project's own
 * account, which is the safe aggregate
 * `docs/design/006-durable-project-dispatch.md` permits; it reserves nothing and
 * a proposal must survive it changing underneath. `execution_backlog` is the
 * hard ceiling, consulted at ingress before an operation becomes durable.
 *
 * A BACKLOGGED SUBMITTER LEARNS THE SCOPE AND NOT THE COUNT. The verdict says
 * which ceiling stopped this dispatch and how long to wait, because the caller
 * is a submitter rather than an operator — a durable count crossing the boundary
 * would be an installation-wide fact handed to one project's client.
 *
 * THE CEILINGS ARE THIS ADAPTER'S, NOT THE SCHEDULER'S CONFIGURATION. They are
 * an operational choice a deployment makes about the ingress it is protecting,
 * and they default to the bound the scheduler's own configuration declares so
 * one tree states one number.
 */

import type pg from "pg";

import { executionSchedulerDefaults } from "../../interpreter/executionScheduler.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  BacklogVerdict,
  ExecutionBacklogGuard,
  ExecutionContextRead,
  SelectorExecutionContext,
} from "../../interpreter/schedulerContext.ts";
import { projectRowCounter } from "./rows.ts";
import { activeWorkFunction, backlogFunction } from "./schema.ts";

/** What the hard backlog guard refuses past, and how long it asks a submitter to wait. */
export interface PostgresBacklogCeilings {
  readonly projectMax: number;
  readonly installationMax: number;
  readonly retryAfterSeconds: number;
}

/** The ceilings a deployment gets when it names none. */
export const postgresBacklogCeilingsDefault: PostgresBacklogCeilings = {
  projectMax: executionSchedulerDefaults.executionBacklogHardLimit,
  installationMax: executionSchedulerDefaults.executionBacklogHardLimit,
  retryAfterSeconds: executionSchedulerDefaults.backlogRetryAfterSeconds,
};

/** One row of the advisory context function, every count of it a bigint the driver spells. */
interface ActiveWorkRow {
  readonly queued: string;
  readonly admitted: string;
  readonly launching: string;
  readonly running: string;
  readonly cluster_slots_max: string;
  readonly cluster_active: string;
  readonly account_maximum: string;
  readonly account_active: string;
  readonly account_deficit: string;
}

/** One row of the backlog function. */
interface BacklogRow {
  readonly project_backlog: string;
  readonly installation_backlog: string;
}

/** What one project's advisory context currently is. */
async function postgresSelectorContext(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorExecutionContext> {
  const found = await pool.query<ActiveWorkRow>(
    `SELECT queued::text, admitted::text, launching::text, running::text,
            cluster_slots_max::text, cluster_active::text, account_maximum::text,
            account_active::text, account_deficit::text
       FROM ${activeWorkFunction}($1, $2)`,
    [partition.tenant, partition.project],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler context: ${partition.tenant}/${partition.project} reported no active work at all`,
    );
  }
  return {
    activeWork: {
      partition,
      queued: projectRowCounter(row.queued, "queued executions"),
      admitted: projectRowCounter(row.admitted, "admitted executions"),
      launching: projectRowCounter(row.launching, "launching executions"),
      running: projectRowCounter(row.running, "running executions"),
    },
    capacity: {
      clusterSlotsMax: projectRowCounter(
        row.cluster_slots_max,
        "cluster slots",
      ),
      clusterActive: projectRowCounter(row.cluster_active, "cluster active"),
      accountMaximum: projectRowCounter(row.account_maximum, "account maximum"),
      accountActive: projectRowCounter(row.account_active, "account active"),
      accountReservationDeficit: projectRowCounter(
        row.account_deficit,
        "account reservation deficit",
      ),
    },
  };
}

/** Whether this project's dispatch is inside both ceilings, and which one stopped it. */
async function postgresBacklogVerdict(
  pool: pg.Pool,
  ceilings: PostgresBacklogCeilings,
  partition: Partition,
): Promise<BacklogVerdict> {
  const found = await pool.query<BacklogRow>(
    `SELECT project_backlog::text, installation_backlog::text
       FROM ${backlogFunction}($1, $2)`,
    [partition.tenant, partition.project],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler context: ${partition.tenant}/${partition.project} reported no backlog at all`,
    );
  }
  const retryAfterSeconds = ceilings.retryAfterSeconds;
  if (
    projectRowCounter(row.project_backlog, "project backlog") >=
    ceilings.projectMax
  ) {
    return { admits: "Backlogged", scope: "Project", retryAfterSeconds };
  }
  if (
    projectRowCounter(row.installation_backlog, "installation backlog") >=
    ceilings.installationMax
  ) {
    return { admits: "Backlogged", scope: "Installation", retryAfterSeconds };
  }
  return { admits: "Admits" };
}

/** The authoritative hard execution-backlog guard, over an ingress-role pool. */
export function postgresExecutionBacklogGuard(
  pool: pg.Pool,
  ceilings: PostgresBacklogCeilings = postgresBacklogCeilingsDefault,
): ExecutionBacklogGuard {
  return {
    admitsDispatch: (partition) =>
      postgresBacklogVerdict(pool, ceilings, partition),
  };
}

/** The advisory execution context a selector may weigh, over an ingress-role pool. */
export function postgresExecutionContextRead(
  pool: pg.Pool,
): ExecutionContextRead {
  return {
    context: (partition) => postgresSelectorContext(pool, partition),
  };
}
