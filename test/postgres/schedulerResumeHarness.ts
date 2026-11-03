/**
 * What a case about the scheduler answering a ticket's escalation needs of a
 * real PostgreSQL and the real writer: a ticket whose jobs run on its
 * project's pools, the roles a runner and the API reach the database as, each
 * spawn registered and admitted, and the writer deciding what each step left.
 *
 * A PASS IS INSTALLATION-WIDE and a suite's cases share one database, so each
 * read here is of one ticket's project, and counts only the answers the
 * scheduler submitted there.
 */

import assert from "node:assert/strict";
import type pg from "pg";

import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerPoolAssignments } from "../../src/adapters/postgres/workerPool.ts";
import type {
  ExecutionId,
  PhysicalAttempt,
  WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerResume,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import type { WorkerPoolAssignments } from "../../src/interpreter/workerPool.ts";
import {
  postgresHarnessDrain,
  postgresHarnessResume,
  postgresHarnessRolePool,
} from "./harness.ts";
import {
  memoryProjectAccess,
  type MemoryProjectAccess,
} from "./projectAccessMemory.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerReport,
  schedulerRigOpen,
  schedulerRuntime,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";
import {
  poolRoutedExecution,
  poolRoutedService,
  poolRoutes,
} from "./schedulerPoolsHarness.ts";

/** One ticket whose jobs run on its project's pools, and the writer's memory of it so far. */
export interface SchedulerResumeRouted {
  readonly project: SchedulerProject;
  memory: ProjectMemory;
}

/** The rig, a connection per role a case acts as, and the scheduler over them. */
export interface SchedulerResumeRig {
  readonly rig: SchedulerRig;
  readonly apiPool: pg.Pool;
  readonly planePool: pg.Pool;
  readonly workerPool: pg.Pool;
  readonly access: MemoryProjectAccess;
  readonly service: ExecutionSchedulerService;
  readonly assignments: WorkerPoolAssignments;
  close(): Promise<void>;
}

/** The steps every case takes, bound to one rig, so a suite names them once. */
export interface SchedulerResumeSteps {
  readonly standing: (
    routed: SchedulerResumeRouted,
  ) => ReturnType<typeof schedulerResumeStanding>;
  readonly schedulerAnswers: (routed: SchedulerResumeRouted) => Promise<number>;
  readonly drained: (routed: SchedulerResumeRouted) => Promise<void>;
  readonly routedTicket: (
    label: string,
  ) => ReturnType<typeof schedulerResumeTicket>;
  readonly reported: (
    routed: SchedulerResumeRouted,
    attempt: PhysicalAttempt,
    verdict: "Pass" | "Fail",
  ) => Promise<void>;
  readonly resumedByScheduler: (
    routed: SchedulerResumeRouted,
  ) => Promise<number>;
  readonly resumedByPerson: (
    routed: SchedulerResumeRouted,
    label: string,
  ) => Promise<void>;
}

/** `resume`'s steps, each the function of the same purpose below. */
export function schedulerResumeSteps(
  resume: SchedulerResumeRig,
): SchedulerResumeSteps {
  return {
    standing: (routed) => schedulerResumeStanding(resume, routed),
    schedulerAnswers: (routed) => schedulerResumeAnswers(resume, routed),
    drained: (routed) => schedulerResumeDrained(resume, routed),
    routedTicket: (label) => schedulerResumeTicket(resume, label),
    reported: (routed, attempt, verdict) =>
      schedulerResumeReported(resume, routed, attempt, verdict),
    resumedByScheduler: (routed) => schedulerResumeByScheduler(resume, routed),
    resumedByPerson: (routed, label) =>
      schedulerResumeByPerson(resume, routed, label),
  };
}

/** Opens the rig and a connection for each role, and the scheduler whose pools are asked of grants held in memory. */
export async function schedulerResumeRigOpen(): Promise<SchedulerResumeRig> {
  const rig = await schedulerRigOpen();
  const apiPool = postgresHarnessRolePool(apiRole);
  const planePool = postgresHarnessRolePool(poolPlaneRole);
  const workerPool = postgresHarnessRolePool(workerPlaneRole);
  const access = memoryProjectAccess();
  return {
    rig,
    apiPool,
    planePool,
    workerPool,
    access,
    service: poolRoutedService(rig, access),
    assignments: postgresWorkerPoolAssignments(planePool),
    close: async () => {
      await Promise.all([apiPool.end(), planePool.end(), workerPool.end()]);
      await rig.close();
    },
  };
}

/** Where a ticket stands, as its projection says. */
export async function schedulerResumeStanding(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
) {
  const { partition, ticket } = routed.project;
  const [row] = await resume.rig.harness.query(
    `SELECT phase, escalation FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, ticket],
  );
  return row;
}

/** How many escalations the scheduler has answered in this ticket's project. */
export async function schedulerResumeAnswers(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
): Promise<number> {
  const { partition } = routed.project;
  const [row] = (await resume.rig.harness.query(
    `SELECT count(*)::int AS answers FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='ExecutionScheduler'
        AND command_tag='ResolveNativeAction'`,
    [partition.tenant, partition.project],
  )) as readonly { answers: number }[];
  return row?.answers ?? 0;
}

/** Decides everything the ticket's project has waiting, each decision committed. */
export async function schedulerResumeDrained(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
): Promise<void> {
  const drain = await postgresHarnessDrain(
    resume.rig.harness,
    routed.project.partition,
    routed.memory,
  );
  assert.ok(drain.decided.every((decided) => decided === "Committed"));
  routed.memory = drain.memory;
}

/** A fresh ticket whose work is registered on the pool route and admitted. */
export async function schedulerResumeTicket(
  resume: SchedulerResumeRig,
  label: string,
): Promise<{ routed: SchedulerResumeRouted; execution: ExecutionId }> {
  const { project, execution } = await poolRoutedExecution(resume.rig, label);
  return { routed: { project, memory: project.memory }, execution };
}

/** Registers the ticket's newest spawn on the pool route and admits `tasks` of its tasks. */
export async function schedulerResumeAdmitted(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
  tasks = 1,
): Promise<readonly ExecutionId[]> {
  const { partition, ticket, cluster } = routed.project;
  const [row] = (await resume.rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'
      ORDER BY authorizing_seq DESC, effect_position DESC LIMIT 1`,
    [partition.tenant, partition.project, ticket],
  )) as readonly { request: string }[];
  assert.ok(row !== undefined);
  await resume.rig.store.registerSpawn(
    await schedulerClaimFor(
      resume.rig,
      partition,
      row.request,
      schedulerOwner("resume"),
    ),
    resume.service.config.nTasks,
    poolRoutes,
  );
  const admitted: ExecutionId[] = [];
  for (let task = 0; task < tasks; task++) {
    const next = await resume.rig.store.admit(cluster);
    assert.ok(next.admitted === "Admitted");
    admitted.push(next.execution);
  }
  return admitted;
}

/** Opens and invokes the execution's attempt under `invocation`, as a pass would for a pool. */
export async function schedulerResumeInvoked(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
  execution: ExecutionId,
  invocation: WorkTaskInvocation,
): Promise<PhysicalAttempt> {
  const { config } = resume.service;
  const opened = await resume.rig.store.openAttempt({
    partition: routed.project.partition,
    execution,
    epoch: routed.project.epoch,
    leaseSecs: config.attemptLeaseSecs,
    retriesMax: config.attemptRetriesMax,
    placementBackoffSecs: config.placementBackoffSecs,
    runtime: schedulerRuntime,
  });
  assert.ok(opened.opened === "Opened");
  assert.equal(
    await resume.rig.store.attemptInvoked(opened.attempt, invocation),
    true,
  );
  return opened.attempt;
}

/** The worker's verdict on the attempt, through the store's terminal transaction, and the writer's decision on it. */
export async function schedulerResumeReported(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
  attempt: PhysicalAttempt,
  verdict: "Pass" | "Fail",
): Promise<void> {
  assert.equal(
    (await resume.rig.store.terminalize(schedulerReport(attempt, verdict)))
      .terminalized,
    "Terminalized",
  );
  await schedulerResumeDrained(resume, routed);
}

/** How many answers a scheduler pass's resumes submitted in this ticket's project, once the writer has decided them. */
export async function schedulerResumeByScheduler(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
): Promise<number> {
  const before = await schedulerResumeAnswers(resume, routed);
  await executionSchedulerResume(resume.service);
  await schedulerResumeDrained(resume, routed);
  return (await schedulerResumeAnswers(resume, routed)) - before;
}

/** A member answers the ticket's open escalation with a resume, and the writer decides it. */
export async function schedulerResumeByPerson(
  resume: SchedulerResumeRig,
  routed: SchedulerResumeRouted,
  label: string,
): Promise<void> {
  const { partition, ticket } = routed.project;
  assert.equal(
    await postgresHarnessResume(resume.rig.harness, partition, ticket, label),
    "Accepted",
  );
  await schedulerResumeDrained(resume, routed);
}
