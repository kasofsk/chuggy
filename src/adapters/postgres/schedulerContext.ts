/**
 * The backlog guard the rest of the installation consults before dispatch,
 * answered by `execution_backlog`, which migration twelve grants the API and
 * ticket-service roles and nothing else.
 *
 * IT READS NO TABLE. The function is `SECURITY DEFINER` and owned by the
 * boundary owner, and the roles that call it hold no privilege whatever on
 * `execution`, `capacity_account` or `execution_cluster` — the revoke is
 * explicit. So the shape of what crosses the boundary is the function's return
 * type rather than a query this file could widen, and a caller cannot reach a
 * second project's rows by editing a `WHERE`.
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
} from "../../interpreter/schedulerContext.ts";
import { projectRowCounter } from "./rows.ts";

/**
 * One row of the backlog function, each count a bigint the driver spells.
 * Every column of a set-returning function is nullable to the query checker,
 * and this one returns none, so the counter admits a null that
 * `schedulerContextCounter` refuses.
 */
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
