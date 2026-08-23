/**
 * The durable execution scheduler against a real server: that it registers the
 * work a decision authorized, admits it against the arithmetic the model
 * proves, runs attempts under a fence, and settles each logical task exactly
 * once through the one completion boundary.
 *
 * IT IS DRIVEN AS `chuggy_scheduler` THROUGHOUT. The store is opened on a pool
 * whose sessions run as that role, so every case is also a claim about the
 * grants: a statement the deployment could not run is a red case here rather
 * than a surprise in production. That is what makes the manifest-counter case
 * below worth writing at all.
 *
 * THE REFUSALS ARE DRIVEN RATHER THAN LOOKED UP. A case that asserted the
 * adapter's intent would be agreeing with the adapter; each of these puts the
 * store in the state the rule is about and reads back what the server holds.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  executionCapacityDefaults,
  type FencedAttempt,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import { asWorkloadId } from "../../src/interpreter/executionScheduler.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accountIdentityFunction,
  backlogFunction,
  schedulerRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  schedulerArtifact,
  schedulerClaimFor,
  schedulerExecutions,
  schedulerOwner,
  schedulerProject,
  schedulerReport,
  schedulerRequestStates,
  schedulerRevoke,
  schedulerRivalRequest,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** The attempt bounds a case works within when it is not about a bound. */
const attemptBounds = {
  leaseSecs: 300,
  retriesMax: 3,
  placementBackoffSecs: 1,
};

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

/** Admits and launches one registration, and hands back the attempt that was opened. */
async function placedAttempt(
  project: SchedulerProject,
  label: string,
): Promise<PhysicalAttempt> {
  const admitted = await rig.store.admit(project.cluster);
  assert.equal(admitted.admitted, "Admitted");
  assert.ok(admitted.admitted === "Admitted");
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    ...attemptBounds,
  });
  assert.ok(opened.opened === "Opened", `attempt was ${opened.opened}`);
  assert.equal(
    await rig.store.attemptPlaced(
      opened.attempt,
      asWorkloadId(`workload-${label}`),
    ),
    true,
  );
  return opened.attempt;
}

/** The row the completion boundary wrote for one settled execution. */
async function completionOf(project: SchedulerProject, operation: string) {
  const found = (await rig.harness.query(
    `SELECT o.authority_kind, o.authority_subject, o.admission, o.command_tag,
            d.base_priority
       FROM operation o
       JOIN decision_input d
         ON d.tenant=o.tenant AND d.project=o.project
        AND d.input_kind='Operation' AND d.input_id=o.operation
      WHERE o.tenant=$1 AND o.project=$2 AND o.operation=$3`,
    [project.partition.tenant, project.partition.project, operation],
  )) as readonly Record<string, string>[];
  return found[0];
}

test("a project provisioned after the migration draws a capacity account", async () => {
  const project = await schedulerProject(rig, "provisioned");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT policy_revision::text AS revision FROM capacity_account
        WHERE account=${accountIdentityFunction}($1,$2)`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ revision: "1" }],
  );
  assert.equal(
    (await registerAll(project, "provisioned")).registered,
    "Registered",
  );
});

test("two tenants holding one project name draw on entitlements of their own", async () => {
  const shared = asProjectId(`project-shared-${randomUUID()}`);
  const partitions = [
    { tenant: asTenantId(`tenant-earlier-${randomUUID()}`), project: shared },
    { tenant: asTenantId(`tenant-later-${randomUUID()}`), project: shared },
  ];
  for (const partition of partitions) {
    /**
     * Both tenants are invented here, so each is established before its project
     * can reference it.
     */
    await rig.harness.query(
      `INSERT INTO tenant (tenant, display_name, lifecycle)
         VALUES ($1, $1, 'Active') ON CONFLICT (tenant) DO NOTHING`,
      [partition.tenant],
    );
    await rig.harness.store.createProject(partition);
  }
  const drawn = `SELECT a.account, a.maximum::text AS maximum FROM project p
                   JOIN capacity_account a
                     ON a.account = ${accountIdentityFunction}(p.tenant, p.project)
                  WHERE p.project = $1 ORDER BY p.tenant`;
  const provisioned = (await rig.harness.query(drawn, [shared])) as readonly {
    account: string;
  }[];
  assert.equal(provisioned.length, partitions.length);
  assert.notEqual(provisioned[0]?.account, provisioned[1]?.account);

  await rig.harness.query(
    `UPDATE capacity_account SET maximum = 1
      WHERE account = ${accountIdentityFunction}($1,$2)`,
    [partitions[0]?.tenant, shared],
  );
  assert.deepEqual(
    (await rig.harness.query(drawn, [shared])).map(
      (row) => (row as { maximum: string }).maximum,
    ),
    ["1", String(executionCapacityDefaults.accountMaximum)],
  );
});

test("a temporary relation shadowing the attempts does not blind the reporter fence", async () => {
  const project = await schedulerProject(rig, "shadowed", { tasks: 1 });
  await registerAll(project, "shadowed");
  const attempt = await placedAttempt(project, "shadowed");
  const named = [
    project.partition.tenant,
    project.partition.project,
    attempt.execution,
    attempt.attempt,
  ];
  await rig.harness.query(
    `UPDATE execution_attempt
        SET state='Superseded', generation=generation+1, evidence='Fenced',
            ended_at=now(), lease_owner=NULL, lease_expires_at=NULL
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt=$4`,
    named,
  );
  const session = await rig.harness.begin();
  try {
    await session.query(
      `CREATE TEMP TABLE execution_attempt
         (tenant text, project text, execution text, attempt text, state text)`,
    );
    await assert.rejects(
      session.query(
        `INSERT INTO execution_result
           (tenant,project,manifest,execution,attempt,manifest_ordinal,
            schema_version,digest,verdict)
         VALUES ($1,$2,$5,$3,$4,1,1,repeat('a',64),'Fail')`,
        [...named, `manifest-shadowed-${randomUUID()}`],
      ),
      /was fenced/,
    );
  } finally {
    await session.rollback();
  }
});

test("the scheduler allocates a manifest ordinal from the counter it advances", async () => {
  const project = await schedulerProject(rig, "ordinal");
  assert.equal(
    await rig.harness.attemptAs(
      schedulerRole,
      `UPDATE project SET manifest_next = manifest_next + 1
        WHERE tenant='${project.partition.tenant}' AND project='${project.partition.project}'`,
    ),
    undefined,
  );
});

test("registering creates one execution per declared task, pinned to its request", async () => {
  const project = await schedulerProject(rig, "register");
  const registered = await registerAll(project, "register");
  assert.deepEqual(registered, {
    registered: "Registered",
    created: project.tasks,
  });
  const rows = await schedulerExecutions(rig, project.partition);
  assert.equal(rows.length, project.tasks);
  assert.deepEqual(
    rows.map((row) => row.status),
    rows.map(() => "Queued"),
  );
  assert.deepEqual(await schedulerRequestStates(rig, project.partition), {
    [project.request]: "Registered",
  });
});

test("a registration retry creates only the tasks that are missing", async () => {
  const project = await schedulerProject(rig, "partial");
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner("partial"),
  );
  await rig.harness.query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,
       account,cluster,configuration_revision,configuration_digest)
     SELECT q.tenant,q.project,'execution-partial-'||t.task::text,q.ticket,t.task,q.request,
            q.capacity_account,$4,q.configuration_revision,q.configuration_digest
       FROM execution_request q
       JOIN execution_request_task t
         ON t.tenant=q.tenant AND t.project=q.project AND t.request=q.request
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3 AND t.task<=2`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      project.cluster,
    ],
  );
  const before = await schedulerExecutions(rig, project.partition);
  assert.deepEqual(await rig.store.registerSpawn(claim), {
    registered: "Registered",
    created: project.tasks - 2,
  });
  const after = await schedulerExecutions(rig, project.partition);
  assert.equal(after.length, project.tasks);
  assert.deepEqual(after.slice(0, 2), before);
});

test("registering the same request again creates nothing", async () => {
  const project = await schedulerProject(rig, "again");
  await registerAll(project, "again");
  assert.deepEqual(await registerAll(project, "again"), {
    registered: "AlreadyRegistered",
    created: 0,
  });
  assert.equal(
    (await schedulerExecutions(rig, project.partition)).length,
    project.tasks,
  );
});

test("a logical task another request already holds is a conflicting registration", async () => {
  const project = await schedulerProject(rig, "conflict", { tasks: 2 });
  const rival = await schedulerRivalRequest(rig, project, "conflict");
  await rig.harness.query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,
       account,cluster,configuration_revision,configuration_digest)
     SELECT q.tenant,q.project,'execution-rival',q.ticket,1,$4,
            q.capacity_account,$5,q.configuration_revision,q.configuration_digest
       FROM execution_request q
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      rival,
      project.cluster,
    ],
  );
  const registered = await registerAll(project, "conflict");
  assert.equal(registered.registered, "Conflicting");
  const incidents = async () =>
    rig.harness.query(
      "SELECT kind FROM scheduler_incident WHERE tenant=$1 AND project=$2",
      [project.partition.tenant, project.partition.project],
    );
  assert.deepEqual(await incidents(), [{ kind: "ConflictingRegistration" }]);

  const states = await schedulerRequestStates(rig, project.partition);
  assert.equal(states[project.request], "Invalidated");
  assert.deepEqual(await registerAll(project, "conflict-again"), {
    registered: "Superseded",
  });
  assert.deepEqual(await incidents(), [{ kind: "ConflictingRegistration" }]);
});

test("admission takes one slot and refuses past the cluster ceiling", async () => {
  const project = await schedulerProject(rig, "clusterfull", {
    slotsMax: 2,
    maximum: 8,
    tasks: 3,
  });
  await registerAll(project, "clusterfull");
  assert.equal((await rig.store.admit(project.cluster)).admitted, "Admitted");
  assert.equal((await rig.store.admit(project.cluster)).admitted, "Admitted");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "ClusterFull",
  });
});

test("admission refuses past the account maximum while the cluster still has room", async () => {
  const project = await schedulerProject(rig, "accountmax", {
    slotsMax: 8,
    maximum: 1,
    tasks: 3,
  });
  await registerAll(project, "accountmax");
  assert.equal((await rig.store.admit(project.cluster)).admitted, "Admitted");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "AccountAtMaximum",
  });
});

test("admission with nothing queued has no candidate", async () => {
  const project = await schedulerProject(rig, "nocandidate");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "NoCandidate",
  });
});

test("admission prefers the account below its reservation over the one borrowing", async () => {
  const owed = await schedulerProject(rig, "owed", {
    slotsMax: 8,
    reserved: 2,
    maximum: 4,
    tasks: 1,
  });
  const borrower = await schedulerProject(rig, "borrower", {
    cluster: owed.cluster,
    reserved: 0,
    maximum: 4,
    tasks: 1,
  });
  await registerAll(borrower, "borrower");
  await registerAll(owed, "owed");
  const admitted = await rig.store.admit(owed.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const rows = await schedulerExecutions(rig, owed.partition);
  assert.deepEqual(
    rows.map((row) => row.execution),
    [admitted.execution],
  );
});

test("an attempt is opened, placed and settles the logical task exactly once", async () => {
  const project = await schedulerProject(rig, "settle", { tasks: 1 });
  await registerAll(project, "settle");
  const attempt = await placedAttempt(project, "settle");
  const report = schedulerReport(attempt, "Pass", [
    schedulerArtifact("handoff/one.txt"),
  ]);
  const settled = await rig.store.terminalize(report);
  assert.ok(settled.terminalized === "Terminalized");
  assert.equal(settled.outcome, "Passed");

  const execution = await rig.store.execution(
    project.partition,
    attempt.execution,
  );
  assert.equal(execution?.status, "Terminal");
  assert.equal(execution?.outcome, "Passed");
  assert.equal(execution?.resultManifest, report.manifest.manifest);
  assert.equal(execution?.completionOperation, settled.operation);
  assert.deepEqual(await completionOf(project, settled.operation), {
    authority_kind: "ExecutionScheduler",
    authority_subject: schedulerRole,
    admission: "CorrectnessReducing",
    command_tag: "TaskDone",
    base_priority: "Completion",
  });
  assert.deepEqual(
    await rig.harness.query(
      "SELECT role, path FROM execution_result_artifact WHERE tenant=$1 AND project=$2",
      [project.partition.tenant, project.partition.project],
    ),
    [{ role: "Handoff", path: "handoff/one.txt" }],
  );
  assert.deepEqual(await schedulerRequestStates(rig, project.partition), {
    [project.request]: "Fulfilled",
  });
});

test("an identical redelivery is absorbed and submits no second completion", async () => {
  const project = await schedulerProject(rig, "redelivery", { tasks: 1 });
  await registerAll(project, "redelivery");
  const attempt = await placedAttempt(project, "redelivery");
  const report = schedulerReport(attempt, "Pass");
  const first = await rig.store.terminalize(report);
  assert.ok(first.terminalized === "Terminalized");
  const again = await rig.store.terminalize(report);
  assert.deepEqual(again, {
    terminalized: "AlreadyTerminal",
    outcome: "Passed",
    operation: first.operation,
  });
  assert.deepEqual(
    await rig.harness.query(
      "SELECT count(*)::text AS count FROM operation WHERE tenant=$1 AND project=$2 AND command_tag='TaskDone'",
      [project.partition.tenant, project.partition.project],
    ),
    [{ count: "1" }],
  );
});

test("a contradictory terminal result preserves the first outcome and raises an incident", async () => {
  const project = await schedulerProject(rig, "contradiction", { tasks: 1 });
  await registerAll(project, "contradiction");
  const attempt = await placedAttempt(project, "contradiction");
  const first = await rig.store.terminalize(schedulerReport(attempt, "Pass"));
  assert.ok(first.terminalized === "Terminalized");
  const second = await rig.store.terminalize(schedulerReport(attempt, "Fail"));
  assert.equal(second.terminalized, "Conflicting");
  const execution = await rig.store.execution(
    project.partition,
    attempt.execution,
  );
  assert.equal(execution?.outcome, "Passed");
  assert.equal(execution?.completionOperation, first.operation);
  assert.deepEqual(
    await rig.harness.query(
      "SELECT kind FROM scheduler_incident WHERE tenant=$1 AND project=$2",
      [project.partition.tenant, project.partition.project],
    ),
    [{ kind: "ConflictingResult" }],
  );
});

test("a fenced attempt settles nothing, and neither does a stale generation", async () => {
  const project = await schedulerProject(rig, "fenced", { tasks: 1 });
  await registerAll(project, "fenced");
  const attempt = await placedAttempt(project, "fenced");
  const stale: FencedAttempt = {
    ...attempt,
    generation: attempt.generation + 1,
  };
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(stale, "Pass")),
    {
      terminalized: "Fenced",
    },
  );
  assert.equal(
    await rig.store.attemptPlaced(stale, asWorkloadId("late")),
    false,
  );
  assert.equal(await rig.store.attemptEnded(stale, "Lost", "Vanished"), false);

  await rig.harness.query(
    `UPDATE execution_attempt SET state='Superseded', generation=generation+1,
       evidence='Fenced', ended_at=now(), lease_owner=NULL, lease_expires_at=NULL
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  );
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "Fenced" },
  );
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))?.status,
    "Running",
  );
});

test("a lost attempt spends the retry budget and a withdrawn one does not", async () => {
  const project = await schedulerProject(rig, "budget", { tasks: 1 });
  await registerAll(project, "budget");
  const attempt = await placedAttempt(project, "budget");
  assert.equal(
    await rig.store.attemptEnded(attempt, "Withdrawn", "Evicted"),
    true,
  );
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))
      ?.retriesSpent,
    0,
  );
  const next = await rig.store.openAttempt({
    partition: project.partition,
    execution: attempt.execution,
    epoch: project.epoch,
    ...attemptBounds,
    placementBackoffSecs: 1,
  });
  assert.equal(next.opened, "BackingOff");

  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=NULL
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, attempt.execution],
  );
  const relaunched = await rig.store.openAttempt({
    partition: project.partition,
    execution: attempt.execution,
    epoch: project.epoch,
    ...attemptBounds,
  });
  assert.ok(
    relaunched.opened === "Opened",
    `the replacement attempt was ${relaunched.opened}`,
  );
  assert.equal(
    await rig.store.attemptEnded(relaunched.attempt, "Lost", "Vanished"),
    true,
  );
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))
      ?.retriesSpent,
    1,
  );
});

test("an exhausted retry budget settles one failed completion with an empty manifest", async () => {
  const project = await schedulerProject(rig, "exhausted", { tasks: 1 });
  await registerAll(project, "exhausted");
  const attempt = await placedAttempt(project, "exhausted");
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  await rig.harness.query(
    `UPDATE execution SET retries_spent=3, placement_backoff_from=NULL
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, attempt.execution],
  );
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: attempt.execution,
    epoch: project.epoch,
    ...attemptBounds,
  });
  assert.equal(opened.opened, "RetriesExhausted");
  const settled = await rig.store.retriesExhausted(
    project.partition,
    attempt.execution,
  );
  assert.ok(settled.terminalized === "Terminalized");
  assert.equal(settled.outcome, "Failed");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT r.verdict, count(a.ordinal)::text AS artifacts
         FROM execution_result r
         LEFT JOIN execution_result_artifact a
           ON a.tenant=r.tenant AND a.project=r.project AND a.manifest=r.manifest
        WHERE r.tenant=$1 AND r.project=$2 GROUP BY r.verdict`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ verdict: "Fail", artifacts: "0" }],
  );
});

test("a definitive inability blocks one execution and releases its slot", async () => {
  const project = await schedulerProject(rig, "blocked", { tasks: 1 });
  await registerAll(project, "blocked");
  const attempt = await placedAttempt(project, "blocked");
  await rig.store.attemptEnded(attempt, "Withdrawn", "PlacementDenied");
  const blocked = await rig.store.blockExecution(
    project.partition,
    attempt.execution,
    "ExecutionProfileUnavailable",
  );
  assert.ok(blocked.blocked === "Blocked");
  const execution = await rig.store.execution(
    project.partition,
    attempt.execution,
  );
  assert.equal(execution?.status, "Terminal");
  assert.equal(execution?.outcome, "Blocked");
  assert.equal(execution?.resultManifest, undefined);
  assert.equal(
    (await completionOf(project, blocked.operation))?.["command_tag"],
    "ExecutionBlocked",
  );
  assert.deepEqual(
    await rig.store.blockExecution(
      project.partition,
      attempt.execution,
      "ExecutionProfileUnavailable",
    ),
    { blocked: "AlreadyBlocked", operation: blocked.operation },
  );
});

test("cancellation retires the ticket's work, names its attempts and fulfils the request", async () => {
  const project = await schedulerProject(rig, "cancel", { tasks: 2 });
  await registerAll(project, "cancel");
  const attempt = await placedAttempt(project, "cancel");
  const cancellation = await schedulerRevoke(rig, project, "cancel");
  const registered = await rig.store.registerCancellation(
    await schedulerClaimFor(
      rig,
      project.partition,
      cancellation,
      schedulerOwner("cancel"),
    ),
  );
  assert.deepEqual(registered, {
    cancelled: "Registered",
    fenced: 2,
    workloads: [attempt.attempt],
  });
  assert.deepEqual(
    (await schedulerExecutions(rig, project.partition)).map(
      (row) => row.status,
    ),
    ["Cancelled", "Cancelled"],
  );
  assert.deepEqual(await schedulerRequestStates(rig, project.partition), {
    [project.request]: "Fulfilled",
    [cancellation]: "Fulfilled",
  });
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "Cancelled" },
  );
});

test("a spawn whose ticket a later cancellation retired is superseded", async () => {
  const project = await schedulerProject(rig, "revoked", { tasks: 1 });
  const cancellation = await schedulerRevoke(rig, project, "revoked");
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner("revoked"),
  );
  await rig.store.registerCancellation(
    await schedulerClaimFor(
      rig,
      project.partition,
      cancellation,
      schedulerOwner("revoked"),
    ),
  );
  assert.deepEqual(await rig.store.registerSpawn(claim), {
    registered: "Superseded",
  });
  assert.deepEqual(await schedulerExecutions(rig, project.partition), []);
  assert.equal(
    (await schedulerRequestStates(rig, project.partition))[project.request],
    "Invalidated",
  );
});

test("an unknown execution is nothing rather than an error", async () => {
  const project = await schedulerProject(rig, "unknown");
  assert.equal(
    await rig.store.execution(
      project.partition,
      asExecutionId("execution-nobody-registered"),
    ),
    undefined,
  );
});

test("the installation default cluster is the one a project draws on unbidden", async () => {
  assert.deepEqual(
    await rig.harness.query(
      "SELECT slots_max::text AS slots FROM execution_cluster WHERE cluster=$1",
      [executionCapacityDefaults.cluster],
    ),
    [{ slots: String(executionCapacityDefaults.clusterSlotsMax) }],
  );
});

test("a manifest bound to another execution settles nothing and is an incident", async () => {
  const mine = await schedulerProject(rig, "ownmanifest", { tasks: 1 });
  const other = await schedulerProject(rig, "foreignmanifest", { tasks: 1 });
  await registerAll(mine, "ownmanifest");
  await registerAll(other, "foreignmanifest");
  const attempt = await placedAttempt(mine, "ownmanifest");
  const stranger = await placedAttempt(other, "foreignmanifest");
  const grafted = {
    ...attempt,
    manifest: schedulerReport(stranger, "Pass").manifest,
  };
  const settled = await rig.store.terminalize(grafted);
  assert.equal(settled.terminalized, "Conflicting");
  assert.equal(
    (await rig.store.execution(mine.partition, attempt.execution))?.status,
    "Running",
  );
  assert.deepEqual(
    await rig.harness.query(
      "SELECT kind FROM scheduler_incident WHERE tenant=$1 AND project=$2",
      [mine.partition.tenant, mine.partition.project],
    ),
    [{ kind: "CrossProjectReference" }],
  );
});

test("a project in retention admits no completion and keeps no result", async () => {
  const project = await schedulerProject(rig, "retention", { tasks: 1 });
  await registerAll(project, "retention");
  const attempt = await placedAttempt(project, "retention");
  await rig.harness.store.fence(project.partition, "Retention");
  assert.deepEqual(
    await rig.store.terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "NotAdmitted" },
  );
  assert.deepEqual(
    await rig.store.blockExecution(
      project.partition,
      attempt.execution,
      "ExecutionPolicyDenied",
    ),
    { blocked: "NotAdmitted" },
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
  assert.equal(
    (await rig.store.execution(project.partition, attempt.execution))?.status,
    "Running",
  );
});

test("a cancelled ticket stops counting against the dispatch guard at once", async () => {
  const project = await schedulerProject(rig, "backlogged", { tasks: 3 });
  const cancellation = await schedulerRevoke(rig, project, "backlogged");
  const backlogOf = async () =>
    (
      (await rig.harness.query(
        `SELECT project_backlog::text AS backlog FROM ${backlogFunction}($1,$2)`,
        [project.partition.tenant, project.partition.project],
      )) as readonly { backlog: string }[]
    )[0]?.backlog;
  assert.equal(await backlogOf(), String(project.tasks));
  await rig.store.registerCancellation(
    await schedulerClaimFor(
      rig,
      project.partition,
      cancellation,
      schedulerOwner("backlogged"),
    ),
  );
  assert.equal(await backlogOf(), "0");
});
