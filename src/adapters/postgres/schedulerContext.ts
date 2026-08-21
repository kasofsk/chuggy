/**
 * The two narrow things the rest of the installation learns from the execution
 * scheduler, answered by the two functions migration ten grants the API and
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
 * THE CEILINGS ARE THE SCHEDULER'S CONFIGURATION AND NOT THIS ADAPTER'S. The
 * guard is the scheduler's authority wherever it is mounted, so the bound it
 * refuses past is a field of `ExecutionSchedulerConfig` and this file reads it.
 * Holding a second copy here would let an ingress and the scheduler that owns
 * the backlog disagree about how long it is allowed to get.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  executionSchedulerDefaults,
  type ExecutionSchedulerConfig,
} from "../../interpreter/executionScheduler.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  BacklogVerdict,
  ExecutionBacklogGuard,
  ExecutionContextRead,
  SelectorExecutionContext,
} from "../../interpreter/schedulerContext.ts";
import { projectRowCounter } from "./rows.ts";

/**
 * One row of the advisory context function, every count of it a bigint the
 * driver spells. Every column of a set-returning function is nullable to the
 * query checker, and neither function here returns one, so the counters admit
 * a null that `schedulerContextCounter` refuses.
 */
interface ActiveWorkRow {
  readonly queued: string | null;
  readonly admitted: string | null;
  readonly launching: string | null;
  readonly running: string | null;
  readonly cluster_slots_max: string | null;
  readonly cluster_active: string | null;
  readonly account_maximum: string | null;
  readonly account_active: string | null;
  readonly account_deficit: string | null;
}

/** One row of the backlog function. */
interface BacklogRow {
  readonly project_backlog: string | null;
  readonly installation_backlog: string | null;
}

/** Reads one such counter, refusing the null the function it came from never returns. */
function schedulerContextCounter(value: string | null, what: string): number {
  if (value === null) {
    throw new Error(
      `postgres scheduler context: ${what} came back as no count`,
    );
  }
  return projectRowCounter(value, what);
}

/** What one project's advisory context currently is. */
async function postgresSelectorContext(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorExecutionContext> {
  const found = await pool.query<ActiveWorkRow>(
    sql`SELECT queued::text, admitted::text, launching::text, running::text,
               cluster_slots_max::text, cluster_active::text,
               account_maximum::text, account_active::text,
               account_deficit::text
          FROM project_active_work(${partition.tenant}, ${partition.project})`,
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
      queued: schedulerContextCounter(row.queued, "queued executions"),
      admitted: schedulerContextCounter(row.admitted, "admitted executions"),
      launching: schedulerContextCounter(row.launching, "launching executions"),
      running: schedulerContextCounter(row.running, "running executions"),
    },
    capacity: {
      clusterSlotsMax: schedulerContextCounter(
        row.cluster_slots_max,
        "cluster slots",
      ),
      clusterActive: schedulerContextCounter(
        row.cluster_active,
        "cluster active",
      ),
      accountMaximum: schedulerContextCounter(
        row.account_maximum,
        "account maximum",
      ),
      accountActive: schedulerContextCounter(
        row.account_active,
        "account active",
      ),
      accountReservationDeficit: schedulerContextCounter(
        row.account_deficit,
        "account reservation deficit",
      ),
    },
  };
}

/** Whether this project's dispatch is inside both ceilings, and which one stopped it. */
async function postgresBacklogVerdict(
  pool: pg.Pool,
  config: ExecutionSchedulerConfig,
  partition: Partition,
): Promise<BacklogVerdict> {
  const found = await pool.query<BacklogRow>(
    sql`SELECT project_backlog::text, installation_backlog::text
          FROM execution_backlog(${partition.tenant}, ${partition.project})`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler context: ${partition.tenant}/${partition.project} reported no backlog at all`,
    );
  }
  const retryAfterSeconds = config.backlogRetryAfterSeconds;
  if (
    schedulerContextCounter(row.project_backlog, "project backlog") >=
    config.projectBacklogMax
  ) {
    return { admits: "Backlogged", scope: "Project", retryAfterSeconds };
  }
  if (
    schedulerContextCounter(row.installation_backlog, "installation backlog") >=
    config.installationBacklogMax
  ) {
    return { admits: "Backlogged", scope: "Installation", retryAfterSeconds };
  }
  return { admits: "Admits" };
}

/** The authoritative hard execution-backlog guard, over an ingress-role pool. */
export function postgresExecutionBacklogGuard(
  pool: pg.Pool,
  config: ExecutionSchedulerConfig = executionSchedulerDefaults,
): ExecutionBacklogGuard {
  return {
    admitsDispatch: (partition) =>
      postgresBacklogVerdict(pool, config, partition),
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
