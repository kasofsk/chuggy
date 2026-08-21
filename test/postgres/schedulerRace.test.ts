/**
 * What the DDL alone could not be driven to prove: what two scheduler processes
 * do to each other, what a lapsed lease leaves behind, and what survives a
 * backend that dies in the middle of a transaction.
 *
 * EVERY CASE HERE USES A SECOND REAL CONNECTION OR A REAL KILLED BACKEND.
 * `docs/design/006-durable-project-dispatch.md` refuses an in-memory simulation
 * of a missing authority for exactly these claims: whether two admissions can
 * both take the last slot, whether a claim lapses to somebody else, and whether
 * a half-written settlement can be observed are all facts about what the server
 * does under concurrency, and a fake would answer them by agreeing with the
 * adapter.
 *
 * THE RACES ARE SET UP RATHER THAN HOPED FOR. A case that ran two calls at once
 * and asserted the happy answer would pass just as well against an adapter with
 * no serialization at all, because the two would usually not overlap. So each
 * one holds a lock the call must reach, waits until the server reports a backend
 * stalled behind it, and only then lets the second call in — which is what makes
 * removing the serialization turn these cases red rather than flaky.
 *
 * A KILLED BACKEND IS THE CRASH. `pg_terminate_backend` ends a real transaction
 * the way a dead process ends one, and what is asserted afterwards is what the
 * database kept. The terminal transaction is where that matters most: it is one
 * transaction precisely so the window between holding a verified result and
 * submitting its completion cannot be observed, and the only way to say that is
 * to try to observe it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { postgresExecutionScheduler } from "../../src/adapters/postgres/scheduler.ts";
import {
  asWorkloadId,
  executionSchedulerDefaults,
  type ExecutionSchedulerStore,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import type { RecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessNewEpoch } from "./harness.ts";
import {
  schedulerBlockade,
  schedulerClaimFor,
  schedulerExecutions,
  schedulerOutcome,
  schedulerOwner,
  schedulerProject,
  schedulerReport,
  schedulerRequestStates,
  schedulerRevoke,
  schedulerRigOpen,
  schedulerRolePool,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;
let rival: ExecutionSchedulerStore;
let rivalPool: ReturnType<typeof schedulerRolePool>;

before(async () => {
  rig = await schedulerRigOpen();
  rivalPool = schedulerRolePool();
  rival = postgresExecutionScheduler(rivalPool);
});

after(async () => {
  await rivalPool.end();
  await rig.close();
});

/** The attempt bounds a case works within when it is not about a bound. */
const attemptBounds = {
  leaseSecs: 300,
  retriesMax: 3,
  placementBackoffSecs: 1,
};

/** How many backends one held lock is expected to have stalled behind it. */
const oneStalledCall = 1;
const twoStalledCalls = 2;

/**
 * One focused request named the way the database keys it. A request identity is
 * the effect that authorized it, so it is unique inside a project and shared by
 * every project whose journal reached the same shape — the composite key is the
 * whole identity, and a case comparing the last part alone would be comparing
 * its neighbours' work with its own.
 */
function claimKey(named: {
  partition: { tenant: string; project: string };
  request: string;
}): string {
  return `${named.partition.tenant}/${named.partition.project}/${named.request}`;
}

/**
 * The launchable executions this project holds. `unlaunched` answers for the
 * whole installation, as the scheduler that calls it is one process for all of
 * it, so a case reading it filters to the work it made — and it is a read,
 * reaping being the separate call the lapsed-lease case below asserts.
 */
async function ownWaiting(project: SchedulerProject, epoch: RecoveryEpoch) {
  const waiting = await rig.store.unlaunched(epoch, 256);
  return waiting.filter(
    (row) => row.partition.project === project.partition.project,
  );
}

/** Registers every logical task one project's spawn request authorizes. */
async function registerAll(project: SchedulerProject, label: string) {
  return rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
  );
}

/**
 * The registrations a spawn would commit, written directly. A real one holds its
 * request row for the whole of its transaction, which is the row a case wanting
 * work to appear mid-cancellation has to be holding itself — so the rows are
 * written the way the registration writes them and the case controls when they
 * commit.
 */
async function registeredMidFlight(project: SchedulerProject): Promise<void> {
  await rig.harness.query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,
       account,cluster,configuration_revision,configuration_digest)
     SELECT q.tenant,q.project,$4||'-'||t.task::text,q.ticket,t.task,q.request,
            q.capacity_account,$5,q.configuration_revision,q.configuration_digest
       FROM execution_request q
       JOIN execution_request_task t
         ON t.tenant=q.tenant AND t.project=q.project AND t.request=q.request
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      `execution-midflight-${randomUUID()}`,
      project.cluster,
    ],
  );
}

/** Admits and launches one registration, and hands back the attempt that was opened. */
async function placedAttempt(
  project: SchedulerProject,
  label: string,
): Promise<PhysicalAttempt> {
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(
    admitted.admitted === "Admitted",
    `admission was ${admitted.admitted}`,
  );
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: await rig.harness.store.currentRecoveryEpoch(),
    ...attemptBounds,
  });
  assert.ok(opened.opened === "Opened", `attempt was ${opened.opened}`);
  await rig.store.attemptPlaced(
    opened.attempt,
    asWorkloadId(`workload-${label}`),
  );
  return opened.attempt;
}

test("a request another process holds is skipped rather than waited for", async () => {
  const held = await schedulerProject(rig, "skiplocked");
  const free = await schedulerProject(rig, "skipfree");
  const blockade = await schedulerBlockade(
    "SELECT request FROM execution_request WHERE tenant=$1 AND project=$2 FOR UPDATE",
    [held.partition.tenant, held.partition.project],
  );
  try {
    const claimed = await rig.store.claimRequests(
      schedulerOwner("skiplocked"),
      ["SpawnWork"],
      64,
      30,
    );
    const requests = claimed.map(claimKey);
    assert.ok(requests.includes(claimKey(free)));
    assert.equal(requests.includes(claimKey(held)), false);
  } finally {
    await blockade.release();
  }
});

test("a lapsed claim is redrawn by another owner at a later generation", async () => {
  const project = await schedulerProject(rig, "lapsed");
  const first = schedulerOwner("lapsed-first");
  const drawn = await rig.store.claimRequests(first, ["SpawnWork"], 64, 30);
  const mine = drawn.find((claim) => claimKey(claim) === claimKey(project));
  assert.ok(mine !== undefined);
  assert.equal(mine.owner, first);

  const second = schedulerOwner("lapsed-second");
  assert.equal(
    (await rig.store.claimRequests(second, ["SpawnWork"], 64, 30)).some(
      (claim) => claimKey(claim) === claimKey(project),
    ),
    false,
  );
  await rig.harness.query(
    `UPDATE execution_request SET claim_expires_at = now() - interval '1 second'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  const redrawn = await rig.store.claimRequests(second, ["SpawnWork"], 64, 30);
  const taken = redrawn.find((claim) => claimKey(claim) === claimKey(project));
  assert.ok(taken !== undefined);
  assert.equal(taken.owner, second);
  assert.equal(taken.generation, mine.generation + 1);
});

test("two admissions racing for the last slot take it once between them", async () => {
  const project = await schedulerProject(rig, "lastslot", {
    slotsMax: 1,
    maximum: 8,
    tasks: 2,
  });
  await registerAll(project, "lastslot");
  const [first] = await schedulerExecutions(rig, project.partition);
  assert.ok(first !== undefined);
  const blockade = await schedulerBlockade(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2 AND task=1 FOR UPDATE",
    [project.partition.tenant, project.partition.project],
  );
  const leading = schedulerOutcome(rig.store.admit(project.cluster));
  try {
    await blockade.stalled(oneStalledCall);
    const trailing = schedulerOutcome(rival.admit(project.cluster));
    await blockade.stalled(twoStalledCalls);
    await blockade.release();
    assert.deepEqual(
      [await leading, await trailing]
        .map((outcome) =>
          typeof outcome === "string" ? outcome : outcome.admitted,
        )
        .sort(),
      ["Admitted", "ClusterFull"],
    );
  } finally {
    await blockade.release();
  }
  assert.deepEqual(
    (await schedulerExecutions(rig, project.partition))
      .map((row) => row.status)
      .sort(),
    ["Admitted", "Queued"],
  );
});

test("a backend killed inside the terminal transaction leaves no half-settled task", async () => {
  const project = await schedulerProject(rig, "crash", { tasks: 1 });
  await registerAll(project, "crash");
  const attempt = await placedAttempt(project, "crash");
  const blockade = await schedulerBlockade(
    "SELECT request FROM execution_request WHERE tenant=$1 AND project=$2 AND request=$3 FOR UPDATE",
    [project.partition.tenant, project.partition.project, project.request],
  );
  const settling = schedulerOutcome(
    rig.store.terminalize(schedulerReport(attempt, "Pass")),
  );
  try {
    await blockade.stalled(oneStalledCall);
    assert.equal(await blockade.killStalled(), oneStalledCall);
    assert.equal(typeof (await settling), "string");
  } finally {
    await blockade.release();
  }
  const partitioned = [project.partition.tenant, project.partition.project];
  assert.deepEqual(
    await rig.harness.query(
      `SELECT
         (SELECT count(*) FROM execution_result WHERE tenant=$1 AND project=$2)::text AS results,
         (SELECT count(*) FROM operation WHERE tenant=$1 AND project=$2
           AND authority_kind='ExecutionScheduler')::text AS completions,
         (SELECT count(*) FROM execution_result_artifact WHERE tenant=$1 AND project=$2)::text AS artifacts`,
      partitioned,
    ),
    [{ results: "0", completions: "0", artifacts: "0" }],
  );
  const execution = await rig.store.execution(
    project.partition,
    attempt.execution,
  );
  assert.equal(execution?.status, "Running");
  assert.equal(execution?.outcome, undefined);

  const settled = await rig.store.terminalize(schedulerReport(attempt, "Pass"));
  assert.ok(settled.terminalized === "Terminalized");
});

test("two reports racing on one execution settle it once", async () => {
  const project = await schedulerProject(rig, "raceresult", { tasks: 1 });
  await registerAll(project, "raceresult");
  const attempt = await placedAttempt(project, "raceresult");
  const report = schedulerReport(attempt, "Pass");
  const blockade = await schedulerBlockade(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2 AND task=1 FOR UPDATE",
    [project.partition.tenant, project.partition.project],
  );
  const leading = schedulerOutcome(rig.store.terminalize(report));
  const trailing = schedulerOutcome(rival.terminalize(report));
  try {
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  assert.deepEqual(
    [await leading, await trailing]
      .map((outcome) =>
        typeof outcome === "string" ? outcome : outcome.terminalized,
      )
      .sort(),
    ["AlreadyTerminal", "Terminalized"],
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT count(*)::text AS count FROM operation
        WHERE tenant=$1 AND project=$2 AND authority_kind='ExecutionScheduler'`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ count: "1" }],
  );
});

test("a registration and the cancellation of its ticket leave no live work either way", async () => {
  const project = await schedulerProject(rig, "regcancel", { tasks: 2 });
  const cancellation = await schedulerRevoke(rig, project, "regcancel");
  const blockade = await schedulerBlockade(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND request=$3 FOR NO KEY UPDATE`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  const cancelling = schedulerOutcome(
    rival.registerCancellation(
      await schedulerClaimFor(
        rig,
        project.partition,
        cancellation,
        schedulerOwner("regcancel-cancel"),
      ),
    ),
  );
  try {
    await blockade.stalled(oneStalledCall);
    await registeredMidFlight(project);
  } finally {
    await blockade.release();
  }
  assert.deepEqual(await cancelling, {
    cancelled: "Registered",
    fenced: project.tasks,
    workloads: [],
  });
  const rows = await schedulerExecutions(rig, project.partition);
  assert.equal(rows.length, project.tasks);
  assert.deepEqual(
    rows.filter((row) => row.status !== "Cancelled"),
    [],
  );
  const states = await schedulerRequestStates(rig, project.partition);
  assert.equal(states[cancellation], "Fulfilled");
  assert.ok(
    states[project.request] === "Invalidated" ||
      states[project.request] === "Fulfilled",
    `the spawn request was ${String(states[project.request])}`,
  );
});

test("a launch and the cancellation of its ticket leave no live work either way", async () => {
  const project = await schedulerProject(rig, "launchcancel", { tasks: 1 });
  await registerAll(project, "launchcancel");
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const cancellation = await schedulerRevoke(rig, project, "launchcancel");
  const blockade = await schedulerBlockade(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3 FOR UPDATE",
    [project.partition.tenant, project.partition.project, admitted.execution],
  );
  const launching = schedulerOutcome(
    rig.store.openAttempt({
      partition: project.partition,
      execution: admitted.execution,
      epoch: project.epoch,
      ...attemptBounds,
    }),
  );
  let cancelling: Promise<unknown>;
  try {
    await blockade.stalled(oneStalledCall);
    cancelling = schedulerOutcome(
      rival.registerCancellation(
        await schedulerClaimFor(
          rig,
          project.partition,
          cancellation,
          schedulerOwner("launchcancel"),
        ),
      ),
    );
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  const opened = await launching;
  assert.ok(typeof opened === "object" && opened.opened === "Opened");
  assert.deepEqual(await cancelling, {
    cancelled: "Registered",
    fenced: 1,
    workloads: [opened.attempt.attempt],
  });
  assert.deepEqual(
    await rig.harness.query(
      "SELECT state, evidence FROM execution_attempt WHERE tenant=$1 AND project=$2",
      [project.partition.tenant, project.partition.project],
    ),
    [{ state: "Superseded", evidence: "Fenced" }],
  );
});

/** A project holding one placed attempt and the cancellation request for its ticket. */
async function reportedAgainstCancellation(label: string) {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  await registerAll(project, label);
  const attempt = await placedAttempt(project, label);
  const cancelling = await schedulerClaimFor(
    rig,
    project.partition,
    await schedulerRevoke(rig, project, label),
    schedulerOwner(label),
  );
  return { project, attempt, cancelling };
}

/** How many scheduler completions one project has been given. */
async function completionsOf(project: SchedulerProject) {
  return rig.harness.query(
    `SELECT count(*)::text AS count FROM operation
      WHERE tenant=$1 AND project=$2 AND authority_kind='ExecutionScheduler'`,
    [project.partition.tenant, project.partition.project],
  );
}

test("a report queued behind a cancellation is cancelled rather than deadlocked", async () => {
  const { project, attempt, cancelling } =
    await reportedAgainstCancellation("cancelfirst");
  const blockade = await schedulerBlockade(
    `SELECT attempt FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3 FOR UPDATE`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  const cancelled = schedulerOutcome(rival.registerCancellation(cancelling));
  let reporting: Promise<unknown>;
  try {
    await blockade.stalled(oneStalledCall);
    reporting = schedulerOutcome(
      rig.store.terminalize(schedulerReport(attempt, "Pass")),
    );
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  assert.deepEqual(await cancelled, {
    cancelled: "Registered",
    fenced: 1,
    workloads: [attempt.attempt],
  });
  assert.deepEqual(await reporting, { terminalized: "Cancelled" });
  assert.deepEqual(
    (await schedulerExecutions(rig, project.partition)).map(
      (row) => row.status,
    ),
    ["Cancelled"],
  );
  assert.deepEqual(await completionsOf(project), [{ count: "0" }]);
});

test("a cancellation queued behind a report retires nothing rather than deadlocking", async () => {
  const { project, attempt, cancelling } =
    await reportedAgainstCancellation("reportfirst");
  const blockade = await schedulerBlockade(
    `SELECT attempt FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3 FOR UPDATE`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  const reporting = schedulerOutcome(
    rig.store.terminalize(schedulerReport(attempt, "Pass")),
  );
  let cancelled: Promise<unknown>;
  try {
    await blockade.stalled(oneStalledCall);
    cancelled = schedulerOutcome(rival.registerCancellation(cancelling));
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  const settled = await reporting;
  assert.ok(
    typeof settled === "object" && settled.terminalized === "Terminalized",
    `the report was ${JSON.stringify(settled)}`,
  );
  assert.deepEqual(await cancelled, {
    cancelled: "Registered",
    fenced: 0,
    workloads: [],
  });
  assert.deepEqual(
    (await schedulerExecutions(rig, project.partition)).map(
      (row) => row.status,
    ),
    ["Terminal"],
  );
  assert.deepEqual(await completionsOf(project), [{ count: "1" }]);
});

test("an attempt ending under the cancellation of its ticket answers rather than deadlocking", async () => {
  const { project, attempt, cancelling } =
    await reportedAgainstCancellation("endcancel");
  const blockade = await schedulerBlockade(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3 FOR UPDATE",
    [project.partition.tenant, project.partition.project, attempt.execution],
  );
  const cancelled = schedulerOutcome(rival.registerCancellation(cancelling));
  let ending: Promise<unknown>;
  try {
    await blockade.stalled(oneStalledCall);
    ending = schedulerOutcome(
      rig.store.attemptEnded(attempt, "Lost", "PlacementDenied"),
    );
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  assert.deepEqual(await cancelled, {
    cancelled: "Registered",
    fenced: 1,
    workloads: [attempt.attempt],
  });
  assert.equal(await ending, false);
  assert.deepEqual(
    await rig.harness.query(
      "SELECT state, evidence FROM execution_attempt WHERE tenant=$1 AND project=$2",
      [project.partition.tenant, project.partition.project],
    ),
    [{ state: "Superseded", evidence: "Fenced" }],
  );
});

test("a reaping sweep and a report on the attempt it ends do not deadlock each other", async () => {
  const project = await schedulerProject(rig, "reapreport", { tasks: 1 });
  await registerAll(project, "reapreport");
  const attempt = await placedAttempt(project, "reapreport");
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at = now() - interval '1 second'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  const blockade = await schedulerBlockade(
    `SELECT attempt FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3 FOR UPDATE`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  const reaping = schedulerOutcome(
    rig.store.reapLapsedAttempts(
      epoch,
      executionSchedulerDefaults.attemptsPerPassMax,
    ),
  );
  let reporting: Promise<unknown>;
  try {
    await blockade.stalled(oneStalledCall);
    reporting = schedulerOutcome(
      rival.terminalize(schedulerReport(attempt, "Pass")),
    );
    await blockade.stalled(twoStalledCalls);
  } finally {
    await blockade.release();
  }
  const reaped = await reaping;
  assert.ok(
    typeof reaped === "number" && reaped >= 1,
    `reaping answered ${String(reaped)}`,
  );
  assert.deepEqual(await reporting, { terminalized: "Fenced" });
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))
      ?.retriesSpent,
    1,
  );
});

test("an admission whose only candidate is cancelled under it takes no slot", async () => {
  const project = await schedulerProject(rig, "admitcancel", { tasks: 1 });
  await registerAll(project, "admitcancel");
  const [candidate] = await schedulerExecutions(rig, project.partition);
  assert.ok(candidate !== undefined);
  const named = [
    project.partition.tenant,
    project.partition.project,
    candidate.execution,
  ];
  const blockade = await schedulerBlockade(
    "SELECT execution FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3 FOR UPDATE",
    named,
  );
  const admitting = schedulerOutcome(rig.store.admit(project.cluster));
  try {
    await blockade.stalled(oneStalledCall);
    await blockade.commit(
      `UPDATE execution SET status='Cancelled', terminal_at=now()
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      named,
    );
  } finally {
    await blockade.release();
  }
  assert.deepEqual(await admitting, { admitted: "NoCandidate" });
  assert.deepEqual(
    (await schedulerExecutions(rig, project.partition)).map(
      (row) => row.status,
    ),
    ["Cancelled"],
  );
});

test("a worker whose reaped attempt reports is fenced rather than settled", async () => {
  const project = await schedulerProject(rig, "reaped", { tasks: 1 });
  await registerAll(project, "reaped");
  const attempt = await placedAttempt(project, "reaped");
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at = now() - interval '1 second'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  assert.ok(
    (await rig.store.reapLapsedAttempts(
      epoch,
      executionSchedulerDefaults.attemptsPerPassMax,
    )) >= 1,
  );
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(attempt, "Pass")),
    {
      terminalized: "Fenced",
    },
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT
         (SELECT count(*) FROM execution_result WHERE tenant=$1 AND project=$2)::text AS results,
         (SELECT count(*) FROM operation WHERE tenant=$1 AND project=$2
           AND authority_kind='ExecutionScheduler')::text AS completions`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ results: "0", completions: "0" }],
  );
});

test("an attempt whose lease lapsed is ended and its execution offered again", async () => {
  const project = await schedulerProject(rig, "lapse", { tasks: 1 });
  await registerAll(project, "lapse");
  const attempt = await placedAttempt(project, "lapse");
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  assert.deepEqual(await ownWaiting(project, epoch), []);

  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at = now() - interval '1 second'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  assert.deepEqual(
    await ownWaiting(project, epoch),
    [],
    "the launch read reaped the lapsed lease itself, which is a write",
  );
  assert.equal(
    await rig.store.reapLapsedAttempts(
      postgresHarnessNewEpoch(),
      executionSchedulerDefaults.attemptsPerPassMax,
    ),
    0,
    "reaping ran under an epoch that is not the installation's",
  );
  assert.ok(
    (await rig.store.reapLapsedAttempts(
      epoch,
      executionSchedulerDefaults.attemptsPerPassMax,
    )) >= 1,
  );
  const waiting = await ownWaiting(project, epoch);
  assert.deepEqual(
    waiting.map((row) => row.execution),
    [attempt.execution],
  );
  assert.equal(waiting[0]?.retriesSpent, 1);
  await ownWaiting(project, epoch);
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))
      ?.retriesSpent,
    1,
  );
  assert.deepEqual(
    await rig.harness.query(
      "SELECT state, evidence FROM execution_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3",
      [project.partition.tenant, project.partition.project, attempt.attempt],
    ),
    [{ state: "Lost", evidence: "LeaseExpired" }],
  );
});

test("a restore fences the previous epoch's worker and offers its execution again", async () => {
  const project = await schedulerProject(rig, "restore", { tasks: 1 });
  await registerAll(project, "restore");
  const attempt = await placedAttempt(project, "restore");
  const before: RecoveryEpoch = await rig.harness.store.currentRecoveryEpoch();
  const after = await rig.harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );

  assert.ok(
    (await rig.store.fenceOldEpochAttempts(
      after,
      executionSchedulerDefaults.attemptsPerPassMax,
    )) >= 1,
  );
  assert.deepEqual(
    await rig.harness.query(
      "SELECT state, evidence FROM execution_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3",
      [project.partition.tenant, project.partition.project, attempt.attempt],
    ),
    [{ state: "Superseded", evidence: "Fenced" }],
  );
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "Fenced" },
  );
  assert.deepEqual(await ownWaiting(project, before), []);
  assert.deepEqual(
    (await ownWaiting(project, after)).map((row) => row.execution),
    [attempt.execution],
  );
  const reopened = await rig.store.openAttempt({
    partition: project.partition,
    execution: attempt.execution,
    epoch: after,
    ...attemptBounds,
    placementBackoffSecs: 1,
  });
  assert.ok(reopened.opened === "Opened");
  assert.equal(
    (await rig.store.terminalize(schedulerReport(reopened.attempt, "Pass")))
      .terminalized,
    "Terminalized",
  );
});

test("an account at its maximum is denied while the cluster and its neighbour still admit", async () => {
  const capped = await schedulerProject(rig, "capped", {
    slotsMax: 8,
    maximum: 1,
    tasks: 2,
  });
  const neighbour = await schedulerProject(rig, "neighbour", {
    cluster: capped.cluster,
    maximum: 4,
    tasks: 1,
  });
  await registerAll(capped, "capped");
  await registerAll(neighbour, "neighbour");
  const taken = [
    await rig.store.admit(capped.cluster),
    await rig.store.admit(capped.cluster),
    await rig.store.admit(capped.cluster),
  ].map((outcome) => outcome.admitted);
  assert.deepEqual(taken, ["Admitted", "Admitted", "AccountAtMaximum"]);
  assert.deepEqual(
    (await schedulerExecutions(rig, capped.partition))
      .map((row) => row.status)
      .sort(),
    ["Admitted", "Queued"],
  );
  assert.deepEqual(
    (await schedulerExecutions(rig, neighbour.partition)).map(
      (row) => row.status,
    ),
    ["Admitted"],
  );
});
