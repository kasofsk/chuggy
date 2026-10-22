/**
 * A job lost on the runner that claimed it, against a real PostgreSQL and the
 * real writer: the scheduler resumes the ticket's escalation as a person would,
 * until the job has been lost as many times as the retry budget allows, and a
 * ticket read names the runner it was lost on.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows, and counts only the answers the scheduler
 * submitted there.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerArtifactReservations,
  postgresWorkerRunEnded,
} from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRoster,
} from "../../src/adapters/postgres/workerPool.ts";
import { workerErrorPath } from "../../src/contract/http.ts";
import {
  runStepEvidences,
  type RunEndedEvidence,
} from "../../src/interpreter/runEvidence.ts";
import {
  asAttemptCapabilitySecret,
  type ExecutionId,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerLaunch,
  executionSchedulerResume,
} from "../../src/interpreter/executionSchedulerRun.ts";
import type {
  RunnerLossResource,
  RunStepFailureResource,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import type { WorkerPoolIdentity } from "../../src/interpreter/workerPool.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  postgresHarnessDrain,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerInvocation,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerReport,
  schedulerRigOpen,
  schedulerRuntime,
  type SchedulerProject,
} from "./schedulerHarness.ts";
import {
  poolRoutedExecution,
  poolRoutedService,
  poolRoutes,
} from "./schedulerPoolsHarness.ts";

const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const planePool = postgresHarnessRolePool(poolPlaneRole);
const workerPool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await Promise.all([apiPool.end(), planePool.end(), workerPool.end()]);
  await rig.close();
});

const access = memoryProjectAccess();
const service = poolRoutedService(rig, access);
const assignments = postgresWorkerPoolAssignments(planePool);
const reads = postgresNativeReads(apiPool);

/** The name every pool a case registers goes by. */
const poolName = "runner-a";

/** One ticket whose jobs run on its project's pools, and the writer's memory of it so far. */
interface Routed {
  readonly project: SchedulerProject;
  memory: ProjectMemory;
}

/** Where a ticket stands, as its projection says. */
async function standing(routed: Routed) {
  const { partition, ticket } = routed.project;
  const [row] = await rig.harness.query(
    `SELECT phase, escalation FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, ticket],
  );
  return row;
}

/** How many escalations the scheduler has answered in this ticket's project. */
async function schedulerAnswers(routed: Routed): Promise<number> {
  const { partition } = routed.project;
  const [row] = (await rig.harness.query(
    `SELECT count(*)::int AS answers FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='ExecutionScheduler'
        AND command_tag='ResolveNativeAction'`,
    [partition.tenant, partition.project],
  )) as readonly { answers: number }[];
  return row?.answers ?? 0;
}

/** Decides everything the ticket's project has waiting. */
async function drained(routed: Routed): Promise<void> {
  const drain = await postgresHarnessDrain(
    rig.harness,
    routed.project.partition,
    routed.memory,
  );
  assert.ok(drain.decided.every((decided) => decided === "Committed"));
  routed.memory = drain.memory;
}

/** Registers a pool in the ticket's project and grants it `Execute`, answering the identity it claims under. */
async function poolOf(routed: Routed): Promise<WorkerPoolIdentity> {
  const { partition } = routed.project;
  const principal = asPrincipal(`https://issuer.invalid#pool-${randomUUID()}`);
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition,
      pool: poolName,
      capabilities: ["Platform:Linux:Amd64"],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
  access.grant({ partition, principal, access: new Set(["Execute"]) });
  const [registered] = (
    await postgresWorkerPoolRoster(rig.pool).registered(partition)
  ).pools;
  assert.ok(registered !== undefined);
  return registered;
}

/** A fresh ticket whose work is registered on the pool route and admitted. */
async function routedTicket(
  label: string,
): Promise<{ routed: Routed; execution: ExecutionId }> {
  const { project, execution } = await poolRoutedExecution(rig, label);
  return { routed: { project, memory: project.memory }, execution };
}

/** Registers the ticket's newest spawn on the pool route and admits its one task. */
async function newestAdmitted(routed: Routed): Promise<ExecutionId> {
  const { partition, ticket, cluster } = routed.project;
  const [row] = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'
      ORDER BY authorizing_seq DESC, effect_position DESC LIMIT 1`,
    [partition.tenant, partition.project, ticket],
  )) as readonly { request: string }[];
  assert.ok(row !== undefined);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      partition,
      row.request,
      schedulerOwner("runner-loss"),
    ),
    1,
    poolRoutes,
  );
  const admitted = await rig.store.admit(cluster);
  assert.ok(admitted.admitted === "Admitted");
  return admitted.execution;
}

/** Opens and invokes the execution's attempt, as a pass would for a pool. */
async function invokedAttempt(
  routed: Routed,
  execution: ExecutionId,
): Promise<PhysicalAttempt> {
  const opened = await rig.store.openAttempt({
    partition: routed.project.partition,
    execution,
    epoch: routed.project.epoch,
    leaseSecs: service.config.attemptLeaseSecs,
    retriesMax: service.config.attemptRetriesMax,
    placementBackoffSecs: service.config.placementBackoffSecs,
    runtime: schedulerRuntime,
  });
  assert.ok(opened.opened === "Opened");
  assert.equal(
    await rig.store.attemptInvoked(opened.attempt, schedulerInvocation),
    true,
  );
  return opened.attempt;
}

/** Has the pool claim the execution's attempt, answering the attempt and the bearer it was claimed under. */
async function claimed(
  routed: Routed,
  execution: ExecutionId,
  pool: WorkerPoolIdentity,
): Promise<{ attempt: PhysicalAttempt; bearer: string }> {
  const attempt = await invokedAttempt(routed, execution);
  const bearer = `bearer-${randomUUID()}`;
  assert.notEqual(
    await assignments.claim(
      pool,
      { leaseSecs: service.config.attemptLeaseSecs, heldMax: 1 },
      `assignment-${randomUUID()}`,
      bearer,
      [],
    ),
    undefined,
  );
  return { attempt, bearer };
}

/** A pass concludes whatever ended, and the writer parks the ticket on it. */
async function concluded(routed: Routed): Promise<void> {
  await executionSchedulerLaunch(service, routed.project.epoch);
  await drained(routed);
}

/** The run under `bearer` ends itself as `evidence`, its worker having kept an error of `bytes`, and is concluded. */
async function lostOnRunner(
  routed: Routed,
  bearer: string,
  bytes?: number,
  evidence: RunEndedEvidence = "RunFailed",
): Promise<void> {
  const secret = asAttemptCapabilitySecret(bearer);
  if (bytes !== undefined)
    assert.deepEqual(
      await postgresWorkerArtifactReservations(workerPool).reserve({
        secret,
        path: workerErrorPath,
        digest: "e".repeat(64),
        bytes,
      }),
      { reserved: "Reserved" },
    );
  assert.equal(
    await postgresWorkerRunEnded(workerPool).end({
      secret,
      generation: 1,
      evidence,
    }),
    true,
  );
  await concluded(routed);
}

/** The lease of the attempt the pool holds runs out, and it is concluded. */
async function leaseLapsedOnRunner(
  routed: Routed,
  execution: ExecutionId,
): Promise<void> {
  const { partition } = routed.project;
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND state IN ('Placing','Running')`,
    [partition.tenant, partition.project, execution],
  );
  await concluded(routed);
}

/** The worker's verdict on the attempt, through the store's terminal transaction, and the writer's decision on it. */
async function reported(
  routed: Routed,
  attempt: PhysicalAttempt,
  verdict: "Pass" | "Fail",
): Promise<void> {
  assert.equal(
    (await rig.store.terminalize(schedulerReport(attempt, verdict)))
      .terminalized,
    "Terminalized",
  );
  await drained(routed);
}

/** How many answers a scheduler pass's resumes submitted in this ticket's project, once the writer has decided them. */
async function resumedByScheduler(routed: Routed): Promise<number> {
  const before = await schedulerAnswers(routed);
  await executionSchedulerResume(service);
  await drained(routed);
  return (await schedulerAnswers(routed)) - before;
}

/** A member answers the ticket's open escalation with a resume, and the writer decides it. */
async function resumedByPerson(routed: Routed, label: string): Promise<void> {
  const { partition, ticket } = routed.project;
  const [desk] = (await rig.harness.query(
    `SELECT action, authorizing_seq::int AS seq FROM native_action
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
    [partition.tenant, partition.project, ticket],
  )) as readonly { action: string; seq: number }[];
  assert.ok(desk !== undefined);
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(partition, label),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: desk.action,
      authorizingSeq: desk.seq,
      resolution: "Resume",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  await drained(routed);
}

/** What the scheduler's own door answers for the ticket, past whatever a pass would have chosen. */
function resumedAtDoor(routed: Routed) {
  const { partition, ticket } = routed.project;
  return rig.store.resumeRunnerLoss({
    ticket: { partition, ticket: asTicketId(ticket) },
    lossesMax: service.config.attemptRetriesMax,
    mailbox: service.ticketService,
  });
}

/** What the ticket's own read and its project's page each say it was lost on. */
async function readLoss(
  routed: Routed,
): Promise<RunnerLossResource | undefined> {
  const { partition, ticket } = routed.project;
  const own = await reads.ticket(partition, asTicketId(ticket));
  for (const order of ["Identity", "RecentActivity"] as const) {
    const page = await reads.project(partition, { limit: 10, order });
    assert.ok(page.result === "Found");
    const listed = page.project.tickets.find((each) => each.ticket === ticket);
    assert.deepEqual(listed?.escalation, own?.escalation);
  }
  return own?.escalation?.lost;
}

/** What the ticket's own read and its project's page each say its run stopped at. */
async function readFailed(
  routed: Routed,
): Promise<RunStepFailureResource | undefined> {
  const { partition, ticket } = routed.project;
  const own = await reads.ticket(partition, asTicketId(ticket));
  for (const order of ["Identity", "RecentActivity"] as const) {
    const page = await reads.project(partition, { limit: 10, order });
    assert.ok(page.result === "Found");
    const listed = page.project.tickets.find((each) => each.ticket === ticket);
    assert.deepEqual(listed?.escalation, own?.escalation);
  }
  return own?.escalation?.failed;
}

/** The report of the manifest the execution settled under. */
async function settledReport(
  routed: Routed,
  execution: ExecutionId,
): Promise<string | undefined> {
  const { partition } = routed.project;
  const [row] = (await rig.harness.query(
    `SELECT r.report FROM execution e
       JOIN execution_result_report r
         ON r.tenant=e.tenant AND r.project=e.project AND r.manifest=e.result_manifest
      WHERE e.tenant=$1 AND e.project=$2 AND e.execution=$3`,
    [partition.tenant, partition.project, execution],
  )) as readonly { report: string }[];
  return row?.report;
}

/** The report each failed step settles its execution under. */
const stepReports = {
  RunCloneFailed: "The clone failed.",
  RunSetupFailed: "A setup line failed.",
  RunCommitFailed: "The commit failed.",
  RunPushFailed: "The push failed.",
  RunTimedOut: "The run passed its deadline.",
} as const;

const workLost = { phase: "Escalated", escalation: "WorkFailureEscalated" };
const evaluationLost = {
  phase: "Escalated",
  escalation: "EvaluationBlockedEscalated",
};

test("an evaluation lost on its runner is resumed by the scheduler, and its next run passes", async () => {
  const { routed, execution } = await routedTicket("loss-evaluation");
  const pool = await poolOf(routed);
  const work = await claimed(routed, execution, pool);
  await reported(routed, work.attempt, "Pass");
  const evaluation = await claimed(routed, await newestAdmitted(routed), pool);
  await lostOnRunner(routed, evaluation.bearer);
  assert.deepEqual(await standing(routed), evaluationLost);
  assert.equal(await resumedByScheduler(routed), 1);
  assert.equal(await schedulerAnswers(routed), 1);
  assert.equal((await standing(routed))?.["phase"], "Evaluation");
  const again = await claimed(routed, await newestAdmitted(routed), pool);
  await reported(routed, again.attempt, "Pass");
  assert.deepEqual(await standing(routed), {
    phase: "Finalization",
    escalation: "NoEscalation",
  });
  assert.equal(await resumedByScheduler(routed), 0);
  assert.equal(await schedulerAnswers(routed), 1);
});

test("work lost on its runner is resumed until the budget is spent, and the last loss waits for a person", async () => {
  const { routed, execution } = await routedTicket("loss-work-bound");
  const pool = await poolOf(routed);
  let next = execution;
  for (let loss = 1; loss < service.config.attemptRetriesMax; loss++) {
    const { bearer } = await claimed(routed, next, pool);
    if (loss % 2 === 0) await leaseLapsedOnRunner(routed, next);
    else await lostOnRunner(routed, bearer);
    assert.deepEqual(await standing(routed), workLost);
    const lost = await readLoss(routed);
    assert.deepEqual(
      { losses: lost?.losses, resumed: lost?.resumed },
      { losses: loss, resumed: loss - 1 },
    );
    assert.equal(await resumedByScheduler(routed), 1);
    assert.equal((await standing(routed))?.["phase"], "Work");
    next = await newestAdmitted(routed);
  }
  const { bearer } = await claimed(routed, next, pool);
  await lostOnRunner(routed, bearer);
  assert.equal(await resumedByScheduler(routed), 0);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(
    await schedulerAnswers(routed),
    service.config.attemptRetriesMax - 1,
  );
  const lost = await readLoss(routed);
  assert.equal(lost?.losses, service.config.attemptRetriesMax);
  assert.equal(lost.resumed, service.config.attemptRetriesMax - 1);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  await resumedByPerson(routed, "loss-work-bound-member");
  const { bearer: after } = await claimed(
    routed,
    await newestAdmitted(routed),
    pool,
  );
  await lostOnRunner(routed, after);
  assert.equal(await resumedByScheduler(routed), 0);
  assert.equal(
    (await readLoss(routed))?.losses,
    service.config.attemptRetriesMax + 1,
  );
});

/**
 * The pass answers at most a batch of desks, so one it would refuse must not
 * take a place in it: the ticket lost to its bound sorts before the one still
 * resumable, and a batch of one still reaches the second.
 */
test("a ticket lost to its bound takes no place in a pass's batch", async () => {
  const bound = await routedTicket("loss-a-bound");
  const pool = await poolOf(bound.routed);
  let next = bound.execution;
  for (let loss = 1; loss <= service.config.attemptRetriesMax; loss++) {
    const { bearer } = await claimed(bound.routed, next, pool);
    await lostOnRunner(bound.routed, bearer);
    if (loss < service.config.attemptRetriesMax) {
      assert.equal(await resumedByScheduler(bound.routed), 1);
      next = await newestAdmitted(bound.routed);
    }
  }
  const resumable = await routedTicket("loss-b-resumable");
  const { bearer } = await claimed(
    resumable.routed,
    resumable.execution,
    await poolOf(resumable.routed),
  );
  await lostOnRunner(resumable.routed, bearer);
  assert.equal(
    await executionSchedulerResume({
      ...service,
      config: { ...service.config, resumesPerPassMax: 1 },
    }),
    1,
  );
  await drained(resumable.routed);
  assert.equal((await standing(resumable.routed))?.["phase"], "Work");
  assert.deepEqual(await standing(bound.routed), workLost);
});

test("a verdict between two losses starts the count again", async () => {
  const { routed, execution } = await routedTicket("loss-count-broken");
  const pool = await poolOf(routed);
  const first = await claimed(routed, execution, pool);
  await lostOnRunner(routed, first.bearer);
  assert.equal(await resumedByScheduler(routed), 1);
  const failed = await claimed(routed, await newestAdmitted(routed), pool);
  await reported(routed, failed.attempt, "Fail");
  assert.equal(await resumedByScheduler(routed), 0);
  await resumedByPerson(routed, "loss-count-broken-member");
  const lostAgain = await claimed(routed, await newestAdmitted(routed), pool);
  await lostOnRunner(routed, lostAgain.bearer);
  const lost = await readLoss(routed);
  assert.deepEqual(
    { losses: lost?.losses, resumed: lost?.resumed },
    { losses: 1, resumed: 0 },
  );
  assert.equal(await resumedByScheduler(routed), 1);
  assert.equal(await schedulerAnswers(routed), 2);
});

test("a ticket read names the pool a job was lost on, its attempt and the error its worker kept", async () => {
  const { routed, execution } = await routedTicket("loss-read");
  const pool = await poolOf(routed);
  const { attempt, bearer } = await claimed(routed, execution, pool);
  await lostOnRunner(routed, bearer, 61);
  assert.deepEqual(await readLoss(routed), {
    runner: { kind: "Pool", pool: poolName },
    execution,
    attempt: attempt.attempt,
    evidence: "RunFailed",
    error: { bytes: 61 },
    losses: 1,
    resumed: 0,
  });
  await resumedByScheduler(routed);
  const { bearer: second } = await claimed(
    routed,
    await newestAdmitted(routed),
    pool,
  );
  await lostOnRunner(routed, second);
  const lost = await readLoss(routed);
  assert.equal(lost?.error, undefined);
  assert.deepEqual(
    { losses: lost?.losses, resumed: lost?.resumed },
    { losses: 2, resumed: 1 },
  );
});

test("a ticket read names the member whose own runner a job was lost on", async () => {
  const { routed, execution } = await routedTicket("loss-personal");
  const { partition } = routed.project;
  const owner: Principal = asPrincipal(
    `https://issuer.invalid#member-${randomUUID()}`,
  );
  const principal = asPrincipal(
    `https://issuer.invalid#personal-${randomUUID()}`,
  );
  const key = { tenant: partition.tenant, owner };
  const personal = postgresPersonalRunnerRegistry(apiPool);
  assert.equal(
    await personal.register({
      ...key,
      capabilities: ["Platform:Linux:Amd64"],
      clientId: `chuggy-personal-${randomUUID()}`,
      principal,
    }),
    "Registered",
  );
  assert.equal(await personal.allow(key, partition.project), "Allowed");
  await rig.harness.query(
    `UPDATE execution SET owner=$4, owner_fallback='Strict'
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [partition.tenant, partition.project, execution, owner],
  );
  await invokedAttempt(routed, execution);
  const bearer = `bearer-${randomUUID()}`;
  assert.notEqual(
    await assignments.claimPersonal(
      { ...key, principal },
      { leaseSecs: service.config.attemptLeaseSecs, heldMax: 1 },
      `assignment-${randomUUID()}`,
      bearer,
      [partition.project],
    ),
    undefined,
  );
  await lostOnRunner(routed, bearer);
  assert.deepEqual((await readLoss(routed))?.runner, {
    kind: "Personal",
    owner,
  });
  await resumedByScheduler(routed);
  assert.equal((await standing(routed))?.["phase"], "Work");
});

test("work whose run ended itself out of turns is the run's own outcome, and is never resumed", async () => {
  const { routed, execution } = await routedTicket("loss-turns");
  const pool = await poolOf(routed);
  const { bearer } = await claimed(routed, execution, pool);
  await lostOnRunner(routed, bearer, undefined, "RunTurnsExhausted");
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(await resumedByScheduler(routed), 0);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(await readLoss(routed), undefined);
});

test("work its worker reported failed is never resumed, and its read names no runner", async () => {
  const { routed, execution } = await routedTicket("loss-reported-fail");
  const pool = await poolOf(routed);
  const { attempt } = await claimed(routed, execution, pool);
  await reported(routed, attempt, "Fail");
  assert.deepEqual(await standing(routed), workLost);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.equal(await resumedByScheduler(routed), 0);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(await schedulerAnswers(routed), 0);
  assert.equal(await readLoss(routed), undefined);
});

test("work lost in the cluster until its budget ran out is left for a person", async () => {
  const project = await schedulerProject(rig, "loss-in-cluster", { tasks: 1 });
  const routed: Routed = { project, memory: project.memory };
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("loss-in-cluster"),
    ),
    1,
    schedulerInCluster,
  );
  const { execution, attempt } = await schedulerPlacedAttempt(
    rig,
    project,
    "loss-in-cluster",
  );
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  await rig.harness.query(
    `UPDATE execution SET retries_spent=$4, placement_backoff_from=NULL
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      execution,
      service.config.attemptRetriesMax,
    ],
  );
  await executionSchedulerLaunch(service, project.epoch);
  await drained(routed);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(await resumedByScheduler(routed), 0);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal(await schedulerAnswers(routed), 0);
  assert.equal(await readLoss(routed), undefined);
});

test("work whose push failed on its runner waits for a person and is never resumed, as does every other failed step", async () => {
  for (const step of runStepEvidences) {
    const { routed, execution } = await routedTicket(`step-${step}`);
    const pool = await poolOf(routed);
    const { attempt, bearer } = await claimed(routed, execution, pool);
    await lostOnRunner(routed, bearer, 61, step);
    assert.deepEqual(await standing(routed), workLost, step);
    assert.equal(await resumedByScheduler(routed), 0, step);
    assert.deepEqual(await standing(routed), workLost, step);
    assert.deepEqual(
      await resumedAtDoor(routed),
      { resumed: "NotResumable" },
      step,
    );
    assert.equal(await schedulerAnswers(routed), 0, step);
    assert.equal(await readLoss(routed), undefined, step);
    assert.deepEqual(
      await readFailed(routed),
      {
        evidence: step,
        execution,
        attempt: attempt.attempt,
        error: { bytes: 61 },
      },
      step,
    );
    assert.equal(
      await settledReport(routed, execution),
      stepReports[step],
      step,
    );
  }
});

test("work whose lease lapsed on its runner is still resumed, as is work whose run failed", async () => {
  const { routed, execution } = await routedTicket("step-lease-lapsed");
  const pool = await poolOf(routed);
  await claimed(routed, execution, pool);
  await leaseLapsedOnRunner(routed, execution);
  assert.deepEqual(await standing(routed), workLost);
  assert.equal((await readLoss(routed))?.evidence, "LeaseExpired");
  assert.equal(await readFailed(routed), undefined);
  assert.equal(
    await settledReport(routed, execution),
    "The attempt a pool claimed ended before it reported a result.",
  );
  assert.equal(await resumedByScheduler(routed), 1);
  assert.equal((await standing(routed))?.["phase"], "Work");
  const { bearer } = await claimed(routed, await newestAdmitted(routed), pool);
  await lostOnRunner(routed, bearer);
  assert.equal((await readLoss(routed))?.evidence, "RunFailed");
  assert.equal(await readFailed(routed), undefined);
  assert.equal(await resumedByScheduler(routed), 1);
  assert.equal((await standing(routed))?.["phase"], "Work");
});

test("work whose push failed in the cluster concludes at once, and work whose run failed there is opened again", async () => {
  for (const [evidence, opened] of [
    ["RunPushFailed", "StepFailed"],
    ["RunFailed", "Opened"],
  ] as const) {
    const label = `step-in-cluster-${evidence}`;
    const project = await schedulerProject(rig, label, { tasks: 1 });
    const routed: Routed = { project, memory: project.memory };
    await rig.store.registerSpawn(
      await schedulerClaimFor(
        rig,
        project.partition,
        project.request,
        schedulerOwner(label),
      ),
      1,
      schedulerInCluster,
    );
    const { execution, attempt } = await schedulerPlacedAttempt(
      rig,
      project,
      label,
    );
    assert.equal(await rig.store.attemptEnded(attempt, "Lost", evidence), true);
    await rig.harness.query(
      `UPDATE execution SET placement_backoff_from=NULL
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [project.partition.tenant, project.partition.project, execution],
    );
    const next = await rig.store.openAttempt({
      partition: project.partition,
      execution,
      epoch: project.epoch,
      leaseSecs: service.config.attemptLeaseSecs,
      retriesMax: service.config.attemptRetriesMax,
      placementBackoffSecs: service.config.placementBackoffSecs,
      runtime: schedulerRuntime,
    });
    assert.equal(next.opened, opened, evidence);
    if (next.opened !== "StepFailed") continue;
    const settled = await rig.store.stepFailed(project.partition, execution);
    assert.ok(settled.terminalized === "Terminalized");
    assert.equal(settled.outcome, "ProcessFailed");
    await drained(routed);
    assert.deepEqual(await standing(routed), workLost);
    assert.equal(await settledReport(routed, execution), "The push failed.");
    assert.deepEqual(await readFailed(routed), {
      evidence,
      execution,
      attempt: attempt.attempt,
    });
    assert.equal(await resumedByScheduler(routed), 0);
    assert.equal(await readLoss(routed), undefined);
  }
});
