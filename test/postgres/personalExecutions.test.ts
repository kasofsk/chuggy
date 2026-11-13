/**
 * An execution a member's personal runner claims, against a real PostgreSQL
 * and under the roles a deployment runs: the owner and the fallback the
 * scheduler pins when it registers an execution, the door the API names a
 * project's fallback through, and what a runner holds once it has claimed —
 * renewed, settled and fenced through its own registration, across every
 * project it serves. The guard of the claim itself is held to the model's
 * cases in `./workerPoolClaim.test.ts`.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresProjectOwnerFallback } from "../../src/adapters/postgres/projectOwnerFallback.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerRunEnded } from "../../src/adapters/postgres/workerPlane.ts";
import { postgresWorkerPoolSessions } from "../../src/adapters/postgres/workerPoolSessions.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import { materialDigest } from "../../src/interpreter/ticketDefinition.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { WorkerPoolOwnerFallback } from "../../src/interpreter/projectOwnerFallback.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  asAttemptCapabilitySecret,
  type WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import type { RunLimit } from "../../src/interpreter/runEvidence.ts";
import type { ExecutionSummary } from "../../src/interpreter/operationsView.ts";
import { workerPoolAgentToken } from "../../src/interpreter/workerPoolAssignment.ts";
import {
  workerPoolReconcile,
  type PersonalRunnerIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import {
  agentAccountHarnessCommitted,
  agentAccountHarnessPressed,
} from "./agentAccountHarness.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  personalRunnerHarnessPlatform,
  personalRunnerHarnessPolled,
  type PersonalRunnerHarnessPolled,
} from "./personalRunnerHarness.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerRuntime,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);
const workerPool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await Promise.all([
    planePool.end(),
    apiPool.end(),
    schedulerPool.end(),
    workerPool.end(),
  ]);
  await rig.close();
});

const assignments = postgresWorkerPoolAssignments(planePool);
const personalRegistry = postgresPersonalRunnerRegistry(apiPool);
const fallbacks = postgresProjectOwnerFallback(apiPool);

const leaseSecs = 300;
/** The size a claim reads an execution naming no memory as. */
const memoryMibDefault = 4_096;
const platform = personalRunnerHarnessPlatform;

type Runner = PersonalRunnerIdentity & { readonly kind: "Personal" };

function principal(label: string): Principal {
  return asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`);
}

/** Has `member`'s authority be the one the project's ticket was first drafted under. */
async function draftedBy(
  project: SchedulerProject,
  member: Principal,
): Promise<void> {
  const drafted = (await rig.harness.query(
    `UPDATE draft_revision SET authority_kind='Member',authority_subject=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND authoring_version=1
      RETURNING 1 AS one`,
    [
      project.partition.tenant,
      project.partition.project,
      project.ticket,
      member,
    ],
  )) as readonly unknown[];
  assert.equal(drafted.length, 1, "the ticket has a first draft revision");
}

/** Registers the project's executions as the scheduler does. */
async function registered(
  project: SchedulerProject,
  label: string,
): Promise<void> {
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
}

/** The owner and fallback every execution of the project was registered with. */
async function pinned(
  project: SchedulerProject,
): Promise<readonly { owner: string | null; owner_fallback: string | null }[]> {
  return (await rig.harness.query(
    `SELECT DISTINCT owner, owner_fallback FROM execution
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { owner: string | null; owner_fallback: string | null }[];
}

/** Has every task of the project's ticket run a container of `image`, written into the release before registration copies it out. */
async function imagePinned(
  project: SchedulerProject,
  image: string,
): Promise<void> {
  const requirement = {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image,
  } as const;
  await rig.harness.query(
    `UPDATE ticket_definition d SET definition=jsonb_set(d.definition,'{tasks}',
       (SELECT jsonb_agg(jsonb_set(jsonb_set(t,'{executionRequirements,value}',$4::jsonb),
                         '{executionRequirements,digest}',to_jsonb($5::text)) ORDER BY o)
          FROM jsonb_array_elements(d.definition->'tasks') WITH ORDINALITY AS e(t,o)))
      WHERE d.tenant=$1 AND d.project=$2 AND d.ticket=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.ticket,
      JSON.stringify(requirement),
      materialDigest(requirement),
    ],
  );
}

/** A project of `member`'s, its fallback named before registration where a case names one. */
async function ownedProject(
  label: string,
  member: Principal,
  fallback: WorkerPoolOwnerFallback | undefined,
  tasks: number,
  partition?: Partition,
  image?: string,
): Promise<SchedulerProject> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks },
    undefined,
    partition,
  );
  await draftedBy(project, member);
  if (image !== undefined) await imagePinned(project, image);
  if (fallback !== undefined)
    assert.equal(
      await fallbacks.write(
        project.partition,
        fallback,
        memberAuthority(principal("administrator")),
      ),
      "Written",
    );
  await registered(project, label);
  return project;
}

/** The next execution admitted and opened as an attempt invoked as `invocation`, routed to runners. */
async function opened(
  project: SchedulerProject,
  invocation: WorkTaskInvocation = schedulerInvocation,
): Promise<string> {
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error("personal executions suite: nothing was admitted");
  await rig.harness.query(
    `UPDATE execution SET placement='Pool' WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, admitted.execution],
  );
  const attempt = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  });
  if (attempt.opened !== "Opened")
    throw new Error("personal executions suite: no attempt was opened");
  if (!(await rig.store.attemptInvoked(attempt.attempt, invocation)))
    throw new Error("personal executions suite: no invocation was recorded");
  return attempt.attempt.attempt;
}

/** One more of `member`'s runners in the tenant of `partition`, by the client it registered, adding `serves` to what their runners serve. */
async function runnerOf(
  partition: Partition,
  member: Principal,
  serves: readonly Partition[] = [partition],
): Promise<Runner & { readonly clientId: string }> {
  const key = { tenant: partition.tenant, owner: member };
  const registeredAs = principal("runner");
  const clientId = `chuggy-personal-${randomUUID()}`;
  assert.equal(
    await personalRegistry.register({
      ...key,
      capabilities: [platform],
      clientId,
      principal: registeredAs,
    }),
    "Registered",
  );
  for (const allowed of serves)
    assert.equal(await personalRegistry.allow(key, allowed.project), "Allowed");
  return { kind: "Personal", ...key, principal: registeredAs, clientId };
}

/** One claim by `runner` in `projects`, answering the assignment it bound or nothing. */
async function claimed(
  runner: Runner,
  projects: readonly Partition[],
  heldMax = 4,
): Promise<string | undefined> {
  const assignment = `assignment-${randomUUID()}`;
  const taken = await assignments.claimPersonal(
    runner,
    { leaseSecs, heldMax, memoryMibDefault },
    assignment,
    `bearer-${randomUUID()}`,
    projects.map((project) => project.project),
  );
  return taken === undefined ? undefined : assignment;
}

test("an execution is registered owned by the member who first drafted its ticket, with the fallback its project named then", async () => {
  const member = principal("member");
  const none = await ownedProject("owned-none", member, undefined, 1);
  assert.deepEqual(await pinned(none), [
    { owner: member, owner_fallback: null },
  ]);
  const strict = await ownedProject("owned-strict", member, "Strict", 1);
  assert.deepEqual(await pinned(strict), [
    { owner: member, owner_fallback: "Strict" },
  ]);
  assert.equal(
    await fallbacks.write(
      strict.partition,
      "Preferred",
      memberAuthority(member),
    ),
    "Written",
  );
  assert.deepEqual(
    await pinned(strict),
    [{ owner: member, owner_fallback: "Strict" }],
    "a setting changed later moves no execution already registered",
  );
});

test("the API reads an execution's fallback only where its owner's runner may take it, and whether the reader owns it", async () => {
  const member = principal("member");
  const project = await ownedProject("owned-read", member, "Strict", 1);
  const reads = postgresOperationalReads(apiPool);
  const listed = async (reader: Principal) =>
    (await reads.executions(project.partition, { limit: 10 }, reader))
      .executions[0];
  const inCluster = await listed(member);
  assert.equal(inCluster?.mine, true);
  assert.equal(
    inCluster.ownerFallback,
    undefined,
    "routed in cluster, no personal runner may take it",
  );
  await opened(project);
  const pooled = await listed(member);
  assert.equal(pooled?.ownerFallback, "Strict");
  assert.equal(pooled.mine, true);
  const stranger = await reads.execution(
    project.partition,
    pooled.execution,
    principal("stranger"),
  );
  assert.equal(stranger?.ownerFallback, "Strict");
  assert.equal(stranger?.mine, false, "another reader does not own it");
});

/** An invocation whose worker spends Claude, which is what an account's limit pauses and a runner is offered or not. */
const spendingClaude: WorkTaskInvocation = {
  ...schedulerInvocation,
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
};

/** One more of `member`'s runners in `project`'s tenant, serving it, as `polled` left it. */
async function runnerPolledOf(
  project: SchedulerProject,
  member: Principal,
  polled: PersonalRunnerHarnessPolled,
): Promise<Runner> {
  const runner = await runnerOf(project.partition, member);
  await personalRunnerHarnessPolled(rig.harness, runner.principal, polled);
  return runner;
}

/** A project of `member`'s under `fallback`, its one execution opened as an attempt spending Claude and waiting unclaimed. */
async function waitingProject(
  label: string,
  member: Principal,
  fallback: WorkerPoolOwnerFallback,
): Promise<SchedulerProject> {
  const project = await ownedProject(label, member, fallback, 1);
  await opened(project, spendingClaude);
  return project;
}

const operationalReads = postgresOperationalReads(apiPool, memoryMibDefault);

/** The project's one execution as `reader` reads it in the list. */
async function listedAs(
  project: SchedulerProject,
  reader: Principal,
): Promise<ExecutionSummary | undefined> {
  return (
    await operationalReads.executions(project.partition, { limit: 10 }, reader)
  ).executions[0];
}

/** Minutes from now until `pause` ends, to the nearest. */
function pauseMinutes(pause: { readonly until: string } | undefined): number {
  assert.ok(pause !== undefined, "a pause is answered");
  return Math.round((Date.parse(pause.until) - Date.now()) / 60_000);
}

const fallbacksBoth: readonly WorkerPoolOwnerFallback[] = [
  "Strict",
  "Preferred",
];

test("an owner's waiting run waits on a live runner of theirs offered its agent, to its owner alone, and on nothing where they hold none", async () => {
  const member = principal("member");
  const project = await waitingProject("wait-live", member, "Preferred");
  assert.equal(
    (await listedAs(project, member))?.personalRunnerWait,
    undefined,
  );
  await runnerPolledOf(project, member, { live: true });
  const listed = await listedAs(project, member);
  assert.equal(listed?.personalRunnerWait, "Live");
  assert.equal(listed.paused, undefined, "nothing pauses it");
  assert.ok(listed !== undefined);
  for (const reader of [member, principal("stranger")])
    assert.equal(
      (
        await operationalReads.execution(
          project.partition,
          listed.execution,
          reader,
        )
      )?.personalRunnerWait,
      reader === member ? "Live" : undefined,
      "another member's run answers nothing of the owner's runners",
    );
});

test("a live runner not offered the run's agent leaves it to a pool under Preferred and under Strict holds it on runners none of which can run it, and an offline one offered it beside that holds it offline", async () => {
  for (const fallback of fallbacksBoth) {
    const member = principal("member");
    const project = await waitingProject(
      `wait-unoffered-${fallback}`,
      member,
      fallback,
    );
    await runnerPolledOf(project, member, { live: true, offered: false });
    assert.equal(
      (await listedAs(project, member))?.personalRunnerWait,
      fallback === "Strict" ? "Unable" : undefined,
    );
    await runnerPolledOf(project, member, { live: false });
    assert.equal(
      (await listedAs(project, member))?.personalRunnerWait,
      fallback === "Strict" ? "Offline" : undefined,
    );
  }
});

test("a run none of whose owner's runners is live waits on them offline under Strict and on nothing under Preferred", async () => {
  for (const fallback of fallbacksBoth) {
    const member = principal("member");
    const project = await waitingProject(
      `wait-offline-${fallback}`,
      member,
      fallback,
    );
    const runner = await runnerPolledOf(project, member, { live: false });
    assert.equal(
      (await listedAs(project, member))?.personalRunnerWait,
      fallback === "Strict" ? "Offline" : undefined,
    );
    await personalRunnerHarnessPolled(rig.harness, runner.principal, {
      live: true,
    });
    assert.equal((await listedAs(project, member))?.personalRunnerWait, "Live");
  }
});

test("a runner that does not match the run's requirement, or whose owner lists another project, counts for nothing under either fallback", async () => {
  for (const fallback of fallbacksBoth) {
    const member = principal("member");
    const project = await waitingProject(
      `wait-unmatched-${fallback}`,
      member,
      fallback,
    );
    await runnerPolledOf(project, member, {
      live: true,
      capabilities: ["Platform:Windows:Amd64", workerPoolAgentToken("Claude")],
    });
    assert.equal(
      (await listedAs(project, member))?.personalRunnerWait,
      undefined,
    );
    const elsewhere = principal("elsewhere");
    const listing = await waitingProject(
      `wait-listing-${fallback}`,
      elsewhere,
      fallback,
    );
    const other = await ownedProject(
      `wait-other-${fallback}`,
      elsewhere,
      fallback,
      1,
      {
        tenant: listing.partition.tenant,
        project: asProjectId(`wait-other-${randomUUID()}`),
      },
    );
    const runner = await runnerOf(listing.partition, elsewhere, [
      other.partition,
    ]);
    await personalRunnerHarnessPolled(rig.harness, runner.principal, {
      live: true,
    });
    assert.equal(
      (await listedAs(listing, elsewhere))?.personalRunnerWait,
      undefined,
    );
  }
});

test("the API reads its owner's pause on a waiting execution's live runners to its owner alone, and only while it waits", async () => {
  const member = principal("member");
  const stranger = principal("stranger");
  const project = await waitingProject("owned-paused", member, "Strict");
  const runner = await runnerPolledOf(project, member, { live: true });
  const limit = { limit: { observedSecs: -60, resetsSecs: 3_600 } };
  await agentAccountHarnessCommitted(rig.harness, stranger, "Claude", limit);
  assert.equal(
    (await listedAs(project, member))?.paused,
    undefined,
    "another person's pause is not the owner's",
  );
  await agentAccountHarnessCommitted(rig.harness, member, "Codex", limit);
  assert.equal(
    (await listedAs(project, member))?.paused,
    undefined,
    "the other agent of the owner's account does not hold it",
  );
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", limit);
  const paused = (await listedAs(project, member))?.paused;
  assert.deepEqual(paused?.reasons, ["limit"]);
  assert.equal(paused.pressed, false);
  assert.equal(
    pauseMinutes(paused),
    60,
    "a runner naming no credential is held by the whole agent's",
  );
  const execution = (await listedAs(project, member))?.execution;
  assert.ok(execution !== undefined);
  for (const reader of [stranger, principal("reader")])
    assert.equal(
      (await operationalReads.execution(project.partition, execution, reader))
        ?.paused,
      undefined,
      "no reader but its owner is told the owner's pause",
    );
  assert.equal(await claimed(runner, [project.partition]), undefined);
  await agentAccountHarnessPressed(rig.harness, member, "Claude");
  assert.equal((await listedAs(project, member))?.paused?.pressed, true);
  assert.notEqual(await claimed(runner, [project.partition]), undefined);
  const taken = await listedAs(project, member);
  assert.equal(taken?.paused, undefined, "a claimed attempt waits on nothing");
  assert.equal(taken?.personalRunnerWait, undefined);
});

test("a live runner's pause is answered only while every credential it named is paused, the earliest end of them, and only while every live runner is held", async () => {
  const member = principal("member");
  const project = await waitingProject("named-paused", member, "Strict");
  const runner = await runnerPolledOf(project, member, {
    live: true,
    credentials: ["first", "second"],
  });
  const limited = (...ends: readonly (readonly [string, number])[]) =>
    agentAccountHarnessCommitted(rig.harness, member, "Claude", {
      limits: ends.map(([credential, resetsSecs]) => ({
        credential,
        observedSecs: -60,
        resetsSecs,
      })),
    });
  await limited(["first", 3_600]);
  assert.equal(
    (await listedAs(project, member))?.paused,
    undefined,
    "a runner with a credential free is held by nothing",
  );
  await limited(["first", 7_200], ["second", 3_600]);
  assert.equal(pauseMinutes((await listedAs(project, member))?.paused), 60);
  await personalRunnerHarnessPolled(rig.harness, runner.principal, {
    live: true,
    credentials: ["first"],
  });
  await runnerPolledOf(project, member, { live: true, credentials: ["third"] });
  assert.equal(
    (await listedAs(project, member))?.paused,
    undefined,
    "a second live runner on a free credential holds nothing back",
  );
  await limited(["first", 7_200], ["third", 1_800]);
  assert.equal(pauseMinutes((await listedAs(project, member))?.paused), 30);
});

test("a run waiting on offline runners says so and no pause", async () => {
  const member = principal("member");
  const project = await waitingProject("offline-paused", member, "Strict");
  await runnerPolledOf(project, member, { live: false });
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limit: { observedSecs: -60, resetsSecs: 3_600 },
  });
  const listed = await listedAs(project, member);
  assert.equal(listed?.personalRunnerWait, "Offline");
  assert.equal(listed.paused, undefined);
});

test("an execution whose ticket was first drafted under another kind of authority is owned by nobody", async () => {
  const project = await schedulerProject(rig, "owned-by-none", { tasks: 1 });
  assert.equal(
    await fallbacks.write(
      project.partition,
      "Strict",
      memberAuthority(principal("administrator")),
    ),
    "Written",
  );
  await registered(project, "owned-by-none");
  assert.deepEqual(await pinned(project), [
    { owner: null, owner_fallback: "Strict" },
  ]);
});

test("a project's fallback is written through its door by the API alone, and absent is a value it can name", async () => {
  const project = await schedulerProject(rig, "fallback-door", { tasks: 1 });
  const authority = memberAuthority(principal("administrator"));
  assert.equal(await fallbacks.fallback(project.partition), undefined);
  assert.equal(
    await fallbacks.write(project.partition, "Preferred", authority),
    "Written",
  );
  assert.equal(
    await fallbacks.write(project.partition, "Preferred", authority),
    "Unchanged",
  );
  assert.equal(await fallbacks.fallback(project.partition), "Preferred");
  assert.equal(
    await fallbacks.write(project.partition, undefined, authority),
    "Written",
  );
  assert.equal(await fallbacks.fallback(project.partition), undefined);
  assert.equal(
    await fallbacks.write(
      { ...project.partition, project: asProjectId("not-a-project") },
      "Strict",
      authority,
    ),
    "NotFound",
  );
  await assert.rejects(
    postgresProjectOwnerFallback(schedulerPool).write(
      project.partition,
      "Strict",
      authority,
    ),
    { code: "42501" },
  );
  await assert.rejects(
    apiPool.query(
      `INSERT INTO project_owner_fallback(tenant,project,fallback,set_by_kind,set_by_subject,set_at)
        VALUES($1,$2,'Strict','Member','someone',now())`,
      [project.partition.tenant, project.partition.project],
    ),
    { code: "42501" },
  );
});

test("a runner's claim returns the runtime its attempt was opened under, and stamps when it claimed an attempt that waited unleased", async () => {
  const member = principal("member");
  const project = await ownedProject("runtime", member, "Strict", 1);
  const attempt = await opened(project);
  const standing = async () =>
    (await rig.harness.query(
      `SELECT lease_owner IS NULL AS unleased, claimed_at IS NOT NULL AS claimed
         FROM execution_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, attempt],
    )) as readonly { unleased: boolean; claimed: boolean }[];
  assert.deepEqual(await standing(), [{ unleased: true, claimed: false }]);
  const runner = await runnerOf(project.partition, member);
  const taken = await assignments.claimPersonal(
    runner,
    { leaseSecs, heldMax: 4, memoryMibDefault },
    `assignment-${randomUUID()}`,
    `bearer-${randomUUID()}`,
    [project.partition.project],
  );
  assert.equal(taken?.runtime, schedulerRuntime);
  assert.deepEqual(await standing(), [{ unleased: false, claimed: true }]);
});

test("a runner's claim returns the project of the attempt it took, across every project it serves", async () => {
  const member = principal("member");
  const first = await ownedProject("named-one", member, "Strict", 1);
  const second = await ownedProject("named-two", member, "Strict", 1, {
    tenant: first.partition.tenant,
    project: asProjectId(`named-two-${randomUUID()}`),
  });
  await opened(first);
  await opened(second);
  const runner = await runnerOf(first.partition, member, [
    first.partition,
    second.partition,
  ]);
  const named: string[] = [];
  for (let claim = 0; claim < 2; claim += 1) {
    const assignment = `assignment-${randomUUID()}`;
    const taken = await assignments.claimPersonal(
      runner,
      { leaseSecs, heldMax: 4, memoryMibDefault },
      assignment,
      `bearer-${randomUUID()}`,
      [first.partition.project, second.partition.project],
    );
    const [row] = (await rig.harness.query(
      `SELECT project FROM execution_attempt WHERE assignment=$1`,
      [assignment],
    )) as readonly { project: string }[];
    assert.equal(taken?.project, row?.project);
    named.push(String(taken?.project));
  }
  assert.deepEqual(
    named.toSorted(),
    [first.partition.project, second.partition.project].toSorted(),
  );
});

test("a runner renews, settles and pulls the image of what it claimed, and another member's runner reaches none of it", async () => {
  const member = principal("member");
  const project = await ownedProject("holds", member, "Preferred", 2);
  await opened(project);
  await opened(project);
  const runner = await runnerOf(project.partition, member);
  const other = await runnerOf(project.partition, principal("other"));
  const kept = await claimed(runner, [project.partition]);
  const released = await claimed(runner, [project.partition]);
  assert.ok(kept !== undefined && released !== undefined);
  assert.equal(await claimed(other, [project.partition]), undefined);
  for (const call of [
    assignments.held(other, kept),
    assignments.renew(other, kept, leaseSecs),
    assignments.refuse(other, kept, "not mine"),
    assignments.release(other, kept),
  ])
    assert.equal(await call, false, "another member's runner reached it");
  assert.equal(await assignments.held(runner, kept), true);
  assert.equal(await assignments.renew(runner, kept, leaseSecs), true);
  assert.deepEqual(await assignments.heldImages(other, 4), []);
  assert.deepEqual(await assignments.heldImages(runner, 4), [
    ...(
      (await rig.harness.query(
        `SELECT DISTINCT requirement_value->>'image' AS image FROM execution
          WHERE tenant=$1 AND project=$2 AND requirement_value->>'image' IS NOT NULL`,
        [project.partition.tenant, project.partition.project],
      )) as readonly { image: string }[]
    ).map((row) => row.image),
    schedulerRuntime,
  ]);
  assert.equal(await assignments.release(runner, released), true);
  assert.equal(await assignments.held(runner, released), false);
  assert.equal(
    await assignments.refuse(
      runner,
      kept,
      "/workspace is not writable",
      "ImageWorkspaceUnwritable",
    ),
    true,
  );
  assert.equal(await assignments.renew(runner, kept, leaseSecs), false);
  assert.deepEqual(
    (
      await rig.pool.query(
        `SELECT pool_refusal, pool_refusal_fault FROM execution_attempt
          WHERE tenant=$1 AND assignment=$2`,
        [project.partition.tenant, kept],
      )
    ).rows,
    [
      {
        pool_refusal: "/workspace is not writable",
        pool_refusal_fault: "ImageWorkspaceUnwritable",
      },
    ],
  );
});

test("a runner's room is its own across every project it serves", async () => {
  const member = principal("member");
  const first = await ownedProject("room-one", member, "Strict", 1);
  const second = await ownedProject("room-two", member, "Strict", 1, {
    tenant: first.partition.tenant,
    project: asProjectId(`room-two-${randomUUID()}`),
  });
  await opened(first);
  await opened(second);
  const runner = await runnerOf(first.partition, member, [
    first.partition,
    second.partition,
  ]);
  const projects = [first.partition, second.partition];
  assert.notEqual(await claimed(runner, projects, 1), undefined);
  assert.equal(await claimed(runner, projects, 1), undefined);
  assert.notEqual(await claimed(runner, projects, 2), undefined);
});

test("each of a member's runners has room of its own, apart from what another of theirs holds", async () => {
  const member = principal("member");
  const project = await ownedProject("room-each", member, "Strict", 2);
  await opened(project);
  await opened(project);
  const first = await runnerOf(project.partition, member);
  const second = await runnerOf(project.partition, member, []);
  const projects = [project.partition];
  assert.notEqual(await claimed(first, projects, 1), undefined);
  assert.equal(await claimed(first, projects, 1), undefined);
  assert.notEqual(
    await claimed(second, projects, 1),
    undefined,
    "a runner was held to the bound of what another of its owner's holds",
  );
});

test("a runner claims only in a project its owner may still read, as the poll names them", async () => {
  const member = principal("member");
  const project = await ownedProject("unread", member, "Strict", 1);
  await opened(project);
  const runner = await runnerOf(project.partition, member);
  assert.equal(await claimed(runner, []), undefined);
  assert.notEqual(await claimed(runner, [project.partition]), undefined);
});

test("taking a project off a runner's allowlist stops what it holds there, and removing one runner fences what it claimed and nothing another of its owner's holds", async () => {
  const member = principal("member");
  const project = await ownedProject("fenced", member, "Strict", 2);
  const first = await opened(project);
  await opened(project);
  const runner = await runnerOf(project.partition, member);
  const held = await claimed(runner, [project.partition]);
  assert.ok(held !== undefined);
  const key = { tenant: runner.tenant, owner: runner.owner };
  assert.equal(
    await personalRegistry.disallow(key, project.partition.project),
    true,
  );
  assert.equal(await assignments.renew(runner, held, leaseSecs), false);
  assert.equal(
    await personalRegistry.allow(key, project.partition.project),
    "Allowed",
  );
  assert.equal(await assignments.renew(runner, held, leaseSecs), true);
  const again = await runnerOf(project.partition, member, []);
  assert.equal(
    await assignments.held(runner, held),
    true,
    "registering another runner fenced what the first held",
  );
  assert.equal(await assignments.renew(again, held, leaseSecs), false);
  const kept = await claimed(again, [project.partition]);
  assert.ok(kept !== undefined);
  assert.equal(await personalRegistry.deregister(key, runner.clientId), true);
  assert.equal(await assignments.held(runner, held), false);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT capability_secret_digest FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, first],
    ),
    [{ capability_secret_digest: null }],
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT capability_secret_digest IS NOT NULL AS bearer FROM execution_attempt
        WHERE tenant=$1 AND assignment=$2`,
      [project.partition.tenant, kept],
    ),
    [{ bearer: true }],
    "removing one runner fenced what another of its owner's held",
  );
  assert.equal(await assignments.held(again, kept), true);
  assert.equal(await assignments.renew(again, kept, leaseSecs), true);
});

test("a pool's claim defers to the owners whose runner allowlists the project, and names them for its authority", async () => {
  const member = principal("member");
  const project = await ownedProject("deferred", member, "Strict", 1);
  await opened(project);
  const pool = {
    partition: project.partition,
    pool: "pool-deferring",
    principal: principal("pool"),
  };
  assert.deepEqual(await assignments.ownersDeferredTo(pool, 4, "rotation"), []);
  await runnerOf(project.partition, member);
  await runnerOf(project.partition, member);
  assert.deepEqual(await assignments.ownersDeferredTo(pool, 4, "rotation"), [
    member,
  ]);
});

test("a pool's claim is held back while any one of the owner's runners could take it: under Strict while one is registered, under Preferred while one polled for executions lately", async () => {
  for (const fallback of ["Strict", "Preferred"] as const) {
    const member = principal("member");
    const project = await ownedProject(
      `deferring-${fallback}`,
      member,
      fallback,
      1,
    );
    await opened(project);
    const pool = {
      kind: "Dedicated",
      partition: project.partition,
      pool: "pool-deferring",
      principal: principal("pool"),
    } as const;
    assert.equal(
      await postgresWorkerPoolRegistry(apiPool).register({
        ...pool,
        capabilities: [platform],
        class: "Dedicated",
        clientId: `chuggy-pool-${randomUUID()}`,
      }),
      true,
    );
    const poolClaimed = async () =>
      (await assignments.claim(
        pool,
        { leaseSecs, heldMax: 4, memoryMibDefault },
        `assignment-${randomUUID()}`,
        `bearer-${randomUUID()}`,
        [],
      )) !== undefined;
    await runnerOf(project.partition, member);
    const polling = await runnerOf(project.partition, member, []);
    await assignments.polled(polling, false);
    assert.equal(
      await assignments.waiting(
        pool,
        { leaseSecs, heldMax: 4, memoryMibDefault },
        [],
      ),
      fallback === "Preferred",
      `${fallback}: a poll with no room for an execution held a pool back`,
    );
    await assignments.polled(polling, true);
    assert.equal(await poolClaimed(), false, fallback);
    assert.equal(
      await personalRegistry.deregister(
        { tenant: polling.tenant, owner: member },
        polling.clientId,
      ),
      true,
    );
    assert.equal(await poolClaimed(), fallback === "Preferred", fallback);
  }
});

test("a runner's poll naming capabilities replaces what it registered with, so what it claims and what a pool defers to it follow the set named", async () => {
  const member = principal("member");
  const project = await ownedProject("advertised", member, "Strict", 2);
  await opened(project);
  await opened(project);
  const runner = await runnerOf(project.partition, member);
  const runners = postgresWorkerPoolRunners(planePool);
  await runners.named(runner, undefined, []);
  assert.equal(
    await claimed(runner, [project.partition]),
    undefined,
    "a runner claims nothing its poll's set does not run",
  );
  const pool = {
    kind: "Dedicated",
    partition: project.partition,
    pool: "pool-advertised",
    principal: principal("pool"),
  } as const;
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      ...pool,
      capabilities: [platform],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
    }),
    true,
  );
  assert.notEqual(
    await assignments.claim(
      pool,
      { leaseSecs, heldMax: 4, memoryMibDefault },
      `assignment-${randomUUID()}`,
      `bearer-${randomUUID()}`,
      [],
    ),
    undefined,
    "a pool defers to no runner whose set does not run the work",
  );
  await runners.named(runner, undefined, [platform]);
  assert.notEqual(await claimed(runner, [project.partition]), undefined);
});

/** The order a rotation draws `owners` in, as the window's digest orders them. */
function rotated(
  owners: readonly Principal[],
  rotation: string,
): readonly Principal[] {
  const digest = (owner: Principal) =>
    createHash("md5").update(`${owner}${rotation}`).digest("hex");
  return [...owners].sort((one, two) =>
    digest(one) < digest(two) ? -1 : digest(one) > digest(two) ? 1 : 0,
  );
}

test("a pool asks a bounded window of the owners it defers to, and an owner outside one rotation's window is inside another's", async () => {
  const project = await ownedProject(
    "windowed",
    principal("drafter"),
    "Strict",
    3,
  );
  const owners: Principal[] = [];
  for (const label of ["first", "second", "third"]) {
    const owner = principal(label);
    owners.push(owner);
    const attempt = await opened(project);
    await rig.harness.query(
      `UPDATE execution x SET owner=$4 FROM execution_attempt a
        WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3
          AND x.tenant=a.tenant AND x.project=a.project AND x.execution=a.execution`,
      [project.partition.tenant, project.partition.project, attempt, owner],
    );
    await runnerOf(project.partition, owner);
  }
  const pool = {
    partition: project.partition,
    pool: "pool-windowed",
    principal: principal("pool"),
  };
  const last = owners[2];
  assert.ok(last !== undefined);
  const rotations = Array.from({ length: 32 }, (_, n) => `rotation-${n}`);
  const outside = rotations.find(
    (rotation) => !rotated(owners, rotation).slice(0, 2).includes(last),
  );
  const inside = rotations.find((rotation) =>
    rotated(owners, rotation).slice(0, 2).includes(last),
  );
  assert.ok(outside !== undefined && inside !== undefined);
  for (const rotation of [outside, inside])
    assert.deepEqual(
      await assignments.ownersDeferredTo(pool, 2, rotation),
      rotated(owners, rotation).slice(0, 2),
      rotation,
    );
  assert.ok(
    !(await assignments.ownersDeferredTo(pool, 2, outside)).includes(last),
  );
  assert.ok(
    (await assignments.ownersDeferredTo(pool, 2, inside)).includes(last),
  );
});

test("a pool registered again fences none of a runner's attempts, even under a name the runner's owner shares", async () => {
  const member = principal("member");
  const project = await ownedProject("pool-fence", member, "Strict", 1);
  const attempt = await opened(project);
  const runner = await runnerOf(project.partition, member);
  const held = await claimed(runner, [project.partition]);
  assert.ok(held !== undefined);
  const pools = postgresWorkerPoolRegistry(apiPool);
  for (const registeredAs of [principal("pool"), principal("pool")])
    assert.equal(
      await pools.register({
        partition: project.partition,
        pool: member,
        capabilities: [platform],
        class: "Dedicated",
        clientId: `chuggy-pool-${randomUUID()}`,
        principal: registeredAs,
      }),
      true,
    );
  assert.equal(await assignments.renew(runner, held, leaseSecs), true);
  assert.notDeepEqual(
    await rig.harness.query(
      `SELECT capability_secret_digest FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, attempt],
    ),
    [{ capability_secret_digest: null }],
  );
});

test("a runner's poll is stamped under its own registration alone, and as one for executions only where it could take one, apart from another runner of its owner's", async () => {
  const member = principal("member");
  const project = await ownedProject("polled", member, "Preferred", 1);
  const runner = await runnerOf(project.partition, member);
  const stamps = async () =>
    (await rig.harness.query(
      `SELECT last_polled_at IS NOT NULL AS polled,
              executions_polled_at IS NOT NULL AS executions
         FROM personal_runner WHERE tenant=$1 AND owner=$2
        ORDER BY principal=$3 DESC`,
      [runner.tenant, runner.owner, runner.principal],
    )) as readonly { polled: boolean; executions: boolean }[];
  await assignments.polled({ ...runner, principal: principal("stale") }, true);
  assert.deepEqual(await stamps(), [{ polled: false, executions: false }]);
  await assignments.polled(runner, false);
  assert.deepEqual(await stamps(), [{ polled: true, executions: false }]);
  await assignments.polled(runner, true);
  assert.deepEqual(await stamps(), [{ polled: true, executions: true }]);
  await runnerOf(project.partition, member, []);
  assert.deepEqual(await stamps(), [
    { polled: true, executions: true },
    { polled: false, executions: false },
  ]);
});

test("a project taken off a runner's allowlist stops what it holds there alone, and what it holds in a project it still serves stands", async () => {
  const member = principal("member");
  const keptImage = `registry.invalid/kept@sha256:${"a".repeat(64)}`;
  const kept = await ownedProject(
    "scoped-kept",
    member,
    "Strict",
    1,
    undefined,
    keptImage,
  );
  const dropped = await ownedProject(
    "scoped-dropped",
    member,
    "Strict",
    1,
    {
      tenant: kept.partition.tenant,
      project: asProjectId(`scoped-dropped-${randomUUID()}`),
    },
    `registry.invalid/dropped@sha256:${"b".repeat(64)}`,
  );
  await opened(kept);
  await opened(dropped);
  const runner = await runnerOf(kept.partition, member, [
    kept.partition,
    dropped.partition,
  ]);
  const inKept = await claimed(runner, [kept.partition]);
  const inDropped = await claimed(runner, [dropped.partition]);
  assert.ok(inKept !== undefined && inDropped !== undefined);
  assert.deepEqual(await assignments.heldImages(runner, 4), [
    `registry.invalid/dropped@sha256:${"b".repeat(64)}`,
    schedulerRuntime,
    keptImage,
  ]);
  assert.equal(
    await personalRegistry.disallow(
      { tenant: runner.tenant, owner: runner.owner },
      dropped.partition.project,
    ),
    true,
  );
  assert.equal(await assignments.renew(runner, inDropped, leaseSecs), false);
  assert.equal(await assignments.held(runner, inDropped), false);
  assert.equal(await assignments.refuse(runner, inDropped, "no node"), false);
  assert.deepEqual(await assignments.heldImages(runner, 4), [
    keptImage,
    schedulerRuntime,
  ]);
  assert.equal(await assignments.renew(runner, inKept, leaseSecs), true);
  assert.equal(await assignments.held(runner, inKept), true);
  assert.equal(await assignments.refuse(runner, inKept, "no node"), true);
});

/** The pool plane's settings for a runner holding up to two jobs, one claimed per poll. */
const benchSettings: WorkerPoolPollSettings = {
  leaseSecs,
  cpuMillis: 500,
  memoryMib: memoryMibDefault,
  assignmentsPerPollMax: 1,
  heldMax: 2,
  sessionsPerPollMax: 1,
  sessionsHeldMax: 1,
  deadlineSecs: 600,
  callbackUrl: "https://plane.invalid/v1/ticket-execution",
  pollIntervalMs: 1,
  pollsMax: 1,
  imageHosts: new Map(),
};

/** The pool plane's ports over this suite's roles, every project readable by its owner and each name drawn fresh, the bearers among them kept by the assignment drawn before each. */
function benchPorts(): {
  readonly ports: WorkerPoolPorts;
  readonly bearers: Map<string, string>;
} {
  const bearers = new Map<string, string>();
  let drawn: string | undefined;
  return {
    bearers,
    ports: {
      assignments,
      runners: postgresWorkerPoolRunners(planePool),
      access: {
        authorize: (member) => Promise.resolve(memberAuthority(member)),
        authorizeTenant: () => Promise.resolve(undefined),
        authorizeSite: () => Promise.resolve(undefined),
      },
      sessions: {
        store: postgresWorkerPoolSessions(planePool),
        bindings: postgresProjectRepositoryBinding(planePool),
        bearers: sessionAttemptMint(),
      },
      mint: () => {
        const minted = `minted-${randomUUID()}`;
        if (drawn === undefined) drawn = minted;
        else {
          bearers.set(drawn, minted);
          drawn = undefined;
        }
        return minted;
      },
    },
  };
}

/** One reconciliation of `runner` holding `held` and wanting one job, as a poll naming `contract` makes it. */
function benchPolled(
  bench: ReturnType<typeof benchPorts>,
  runner: Runner,
  held: readonly string[],
  contract: string,
) {
  return workerPoolReconcile(
    bench.ports,
    runner,
    { jobs: held, sessions: [] },
    { wanted: 1, wantedSessions: 0, contract },
    benchSettings,
  );
}

/** Ends the run of `assignment` under `evidence`, as its harness does on the job plane. */
async function benchEnded(
  bench: ReturnType<typeof benchPorts>,
  assignment: string,
  evidence: "RunRateLimited" | "RunCreditsExhausted" | "RunFailed",
  limit?: RunLimit,
): Promise<void> {
  const bearer = bench.bearers.get(assignment);
  assert.ok(bearer !== undefined, "the assignment was claimed with a bearer");
  assert.equal(
    await postgresWorkerRunEnded(workerPool).end({
      secret: asAttemptCapabilitySecret(bearer),
      generation: 1,
      evidence,
      ...(limit === undefined ? {} : { limit }),
    }),
    true,
  );
}

/** Whether `member`'s Claude account is paused now, and whether it keeps a limit at all. */
async function benchAccount(member: Principal) {
  return rig.harness.query(
    `SELECT (SELECT paused_until IS NOT NULL FROM agent_account_pause($1,'Claude')) AS paused,
            EXISTS(SELECT 1 FROM agent_account_limit
                    WHERE principal=$1 AND agent='Claude') AS limited`,
    [member],
  );
}

/** A member's project of two Claude jobs both waiting, and one of their runners. */
async function benchProject(label: string) {
  const member = principal("member");
  const project = await ownedProject(label, member, "Strict", 2);
  await opened(project, spendingClaude);
  await opened(project, spendingClaude);
  return { member, runner: await runnerOf(project.partition, member) };
}

test("a runner whose release reads outcomes is told its job's usage limit beside its stop in every answer stopping it, and its owner's other work is claimed on", async () => {
  const { member, runner } = await benchProject("bench-limited");
  const bench = benchPorts();
  const first = (await benchPolled(bench, runner, [], workerContractRelease))
    .assignments[0]?.assignment;
  assert.ok(first !== undefined);
  const resetsAt = Math.floor(Date.now() / 1_000) + 7_200;
  await benchEnded(bench, first, "RunRateLimited", {
    window: "five_hour",
    resetsAt,
  });
  assert.deepEqual(await benchAccount(member), [
    { paused: false, limited: false },
  ]);
  const stopped = await benchPolled(
    bench,
    runner,
    [first],
    workerContractRelease,
  );
  assert.deepEqual(stopped.stop, [first]);
  assert.deepEqual(stopped.credentialOutcomes, [
    { assignment: first, outcome: "UsageLimited", resetsAt },
  ]);
  const second = stopped.assignments[0]?.assignment;
  assert.ok(second !== undefined, "the owner's other job is claimed on");
  const again = await benchPolled(
    bench,
    runner,
    [first, second],
    workerContractRelease,
  );
  assert.deepEqual(again.stop, [first]);
  assert.deepEqual(again.credentialOutcomes, stopped.credentialOutcomes);
  const released = await benchPolled(
    bench,
    runner,
    [second],
    workerContractRelease,
  );
  assert.deepEqual(released.stop, []);
  assert.equal(Object.hasOwn(released, "credentialOutcomes"), false);
});

test("a runner of an earlier release is named no outcome, and its job's usage limit pauses its owner's other work as it always did", async () => {
  const { member, runner } = await benchProject("bench-earlier");
  const bench = benchPorts();
  const first = (await benchPolled(bench, runner, [], "1.48.0")).assignments[0]
    ?.assignment;
  assert.ok(first !== undefined);
  await benchEnded(bench, first, "RunRateLimited", {
    resetsAt: Math.floor(Date.now() / 1_000) + 7_200,
  });
  assert.deepEqual(await benchAccount(member), [
    { paused: true, limited: true },
  ]);
  const stopped = await benchPolled(bench, runner, [first], "1.48.0");
  assert.deepEqual(stopped.stop, [first]);
  assert.equal(Object.hasOwn(stopped, "credentialOutcomes"), false);
  assert.deepEqual(stopped.assignments, [], "the paused account claims none");
  const upgraded = await benchPolled(
    bench,
    runner,
    [first],
    workerContractRelease,
  );
  assert.deepEqual(upgraded.stop, [first]);
  assert.equal(
    Object.hasOwn(upgraded, "credentialOutcomes"),
    false,
    "a job claimed by an earlier release paused the account, and benches nothing",
  );
});

test("each outcome a benching runner's job ended under is named for it alone: a limit with its reset, a limit naming none, and credits run out", async () => {
  const member = principal("member");
  const project = await ownedProject("bench-outcomes", member, "Strict", 4);
  for (let opening = 0; opening < 4; opening += 1)
    await opened(project, spendingClaude);
  const runner = await runnerOf(project.partition, member);
  const bench = benchPorts();
  const taken: string[] = [];
  for (let claiming = 0; claiming < 4; claiming += 1) {
    const answered = await workerPoolReconcile(
      bench.ports,
      runner,
      { jobs: taken, sessions: [] },
      { wanted: 1, wantedSessions: 0, contract: workerContractRelease },
      { ...benchSettings, heldMax: 4 },
    );
    const assignment = answered.assignments[0]?.assignment;
    assert.ok(assignment !== undefined);
    taken.push(assignment);
  }
  const [limited, unnamed, empty, failed] = taken as [
    string,
    string,
    string,
    string,
  ];
  const resetsAt = Math.floor(Date.now() / 1_000) + 3_600;
  await benchEnded(bench, limited, "RunRateLimited", { resetsAt });
  await benchEnded(bench, unnamed, "RunRateLimited");
  await benchEnded(bench, empty, "RunCreditsExhausted");
  await benchEnded(bench, failed, "RunFailed");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT a.assignment,l.usage_window,
              extract(epoch FROM l.resets_at)::bigint::text AS resets_at
         FROM execution_attempt_limit l
         JOIN execution_attempt a
           ON (a.tenant,a.project,a.execution,a.attempt)=(l.tenant,l.project,l.execution,l.attempt)
        WHERE l.tenant=$1 AND l.project=$2`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ assignment: limited, usage_window: null, resets_at: String(resetsAt) }],
  );
  const named = await assignments.credentialOutcomes(runner, [
    ...taken,
    "never-claimed",
  ]);
  assert.deepEqual(
    [...named].sort((left, right) =>
      left.assignment.localeCompare(right.assignment),
    ),
    [
      { assignment: limited, outcome: "UsageLimited", resetsAt },
      { assignment: unnamed, outcome: "UsageLimited" },
      { assignment: empty, outcome: "CreditsExhausted" },
    ].sort((left, right) => left.assignment.localeCompare(right.assignment)),
  );
  const sibling = await runnerOf(project.partition, member);
  assert.deepEqual(
    await assignments.credentialOutcomes(sibling, taken),
    [],
    "another of the owner's runners is named none of this one's outcomes",
  );
  assert.deepEqual(await benchAccount(member), [
    { paused: false, limited: false },
  ]);
});
