/**
 * What a case about work routed to pools needs of a real PostgreSQL: an
 * execution marked for its project's pools, the scheduler that would launch
 * it, and what the scheduler made of it.
 *
 * THE AUTHORITY IS A PARAMETER because two suites ask it: one holds grants in
 * memory beside the database, and the other asks the Keto a deployment runs.
 *
 * AN EXECUTION IS ROUTED BY ITS REGISTRATION, written under the scheduler's
 * own role. A pool is offered the attempt through every port the in-cluster
 * arm asks but placement, and placement refuses, so a pass that placed one
 * fails the case that ran it.
 */

import assert from "node:assert/strict";

import {
  postgresFailedLanding,
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import { postgresWorkerPoolRoster } from "../../src/adapters/postgres/workerPool.ts";
import type {
  ExecutionId,
  ExecutionRoutes,
} from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionSchedulerService } from "../../src/interpreter/executionSchedulerRun.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerRouting,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";
import { schedulerRootService } from "./schedulerRootPorts.ts";

/** The routes a routed execution registers with. */
export const poolRoutes: ExecutionRoutes = { Work: "Pool", Evaluation: "Pool" };

/** A scheduler over the real store and registry, asking `access` of each pool, whose placement refuses. */
export function poolRoutedService(
  rig: SchedulerRig,
  access: ProjectAccess,
): ExecutionSchedulerService {
  return {
    ...schedulerRootService,
    store: rig.store,
    placement: {
      ...schedulerRootService.placement,
      place: (placement) =>
        Promise.reject(
          new Error(
            `scheduler pools suite: ${placement.execution} was placed in the cluster`,
          ),
        ),
    },
    workerPools: postgresWorkerPoolRoster(rig.pool),
    access,
    policy: {
      routing: schedulerRouting(poolRoutes),
      profileFor: () =>
        Promise.resolve({
          resolved: "Profile",
          profile: { profile: "standard", runtimeVersion: "1" },
          grant: {
            tools: [],
            credentials: [],
            network: false,
            filesystem: "WriteWorkspace",
            mayCompleteTask: false,
          },
        }),
    },
    runtimeFacts: {
      facts: () =>
        Promise.resolve({
          read: "Facts",
          facts: { changedFiles: [], handoff: [] },
        }),
    },
    configurations: postgresPinnedConfigurations(rig.pool),
    priorWorkReports: postgresPriorWorkReports(rig.pool),
    priorEvaluationReports: postgresPriorEvaluationReports(rig.pool),
    failedLanding: postgresFailedLanding(rig.pool),
    ticketBriefs: postgresTicketBrief(rig.pool),
  };
}

/** One execution routed to its project's pools, and the project it belongs to. */
export interface PoolRouted {
  readonly project: SchedulerProject;
  readonly execution: ExecutionId;
}

/** The key of a routed execution's row, in the order every statement here binds it. */
export function poolRoutedKey(routed: PoolRouted): readonly string[] {
  const { tenant, project } = routed.project.partition;
  return [tenant, project, routed.execution];
}

/** The one execution of a fresh project, registered on the pool route and admitted under the platform default. */
export async function poolRoutedExecution(
  rig: SchedulerRig,
  label: string,
): Promise<PoolRouted> {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const owner = schedulerOwner(label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(rig, project.partition, project.request, owner),
    1,
    poolRoutes,
  );
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error(`scheduler pools suite: ${label} admitted no execution`);
  return { project, execution: admitted.execution };
}

/** What the scheduler has made of one execution so far, read as the owner. */
export async function poolRoutedStanding(
  rig: SchedulerRig,
  routed: PoolRouted,
): Promise<{
  readonly execution: Record<string, unknown>;
  readonly attempts: readonly Record<string, unknown>[];
}> {
  const key = poolRoutedKey(routed);
  const [execution] = await rig.harness.query(
    `SELECT status, outcome, blocked_reason, retries_spent::int AS retries_spent,
            placement_backoff_from IS NOT NULL AS backed_off
       FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3`,
    key,
  );
  assert.ok(execution !== undefined);
  const attempts = await rig.harness.query(
    `SELECT state, evidence, pool FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
      ORDER BY opened_at, attempt`,
    key,
  );
  return { execution, attempts };
}

/** The standing of an execution the scheduler has not settled and has spent nothing on. */
export const poolRoutedUnsettled = {
  outcome: null,
  blocked_reason: null,
  retries_spent: 0,
};
