/**
 * Whether the scheduler counts a runner as able to run a project's work,
 * asked of a real database and a real authority together.
 *
 * WHAT NEITHER HALF CAN ANSWER ALONE. `test/postgres/schedulerPools.test.ts`
 * grants every runner's owner from memory, and `./workerPoolAdmission.test.ts`
 * asks the authority with no row behind it. Whether the owner a personal
 * runner's row names is the one its owner's tuples name, so that taking a
 * tuple away revokes the runner for the scheduler as it does for a poll, and
 * whether a registered pool's tuple counts for nothing, are claims about the
 * join.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerPoolRegistry } from "../../src/adapters/postgres/workerPool.ts";
import { executionSchedulerLaunch } from "../../src/interpreter/executionSchedulerRun.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { postgresHarnessRolePool } from "../postgres/harness.ts";
import { schedulerRigOpen } from "../postgres/schedulerHarness.ts";
import {
  poolRoutedExecution,
  poolRoutedKey,
  poolRoutedService,
  poolRoutedStanding,
  poolRoutedUnsettled,
  type PoolRouted,
} from "../postgres/schedulerPoolsHarness.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAccessAt,
  ketoHarnessGrants,
  ketoHarnessIssuer,
} from "./harness.ts";

const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const personalRegistry = postgresPersonalRunnerRegistry(apiPool);
const grants = ketoHarnessGrants();

/** Registers one pool of the routed execution's project able to run its work, and writes the `pools` tuple that grants it `Execute`. */
async function poolRegistered(routed: PoolRouted): Promise<void> {
  const { partition } = routed.project;
  const subject = `chuggy-pool-${randomUUID()}`;
  assert.equal(
    await registry.register({
      partition,
      pool: "amd",
      capabilities: ["Platform:Linux:Amd64"],
      class: "Dedicated",
      clientId: subject,
      principal: oidcPrincipal(ketoHarnessIssuer, subject),
    }),
    true,
  );
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation: "pools",
    }),
  );
}

/** Makes a fresh member the routed execution's owner, answering their subject. */
async function ownerMade(routed: PoolRouted): Promise<string> {
  const subject = `member-${randomUUID()}`;
  await rig.harness.query(
    `UPDATE execution SET owner=$4
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), oidcPrincipal(ketoHarnessIssuer, subject)],
  );
  return subject;
}

/** The tuples that let the owner `subject` register a personal runner in the routed execution's tenant and read its project. */
function ownerGrants(
  routed: PoolRouted,
  subject: string,
): readonly [ProjectGrant, ProjectGrant] {
  const { partition } = routed.project;
  return [
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      relation: "personal_runners",
    }),
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation: "viewers",
    }),
  ];
}

/**
 * Makes a fresh member the routed execution's owner, registers a personal
 * runner of theirs listing its project and able to run its work, and answers
 * the tuples that admit the runner and let the owner read the project.
 */
async function runnerOwning(
  routed: PoolRouted,
): Promise<readonly [ProjectGrant, ProjectGrant]> {
  const { partition } = routed.project;
  const subject = await ownerMade(routed);
  const owner = oidcPrincipal(ketoHarnessIssuer, subject);
  assert.equal(
    await personalRegistry.register({
      tenant: partition.tenant,
      owner,
      capabilities: ["Platform:Linux:Amd64"],
      clientId: `chuggy-personal-${randomUUID()}`,
      principal: oidcPrincipal(ketoHarnessIssuer, `runner-${randomUUID()}`),
    }),
    "Registered",
  );
  assert.equal(
    await personalRegistry.allow(
      { tenant: partition.tenant, owner },
      partition.project,
    ),
    "Allowed",
  );
  return ownerGrants(routed, subject);
}

/** One launch pass over the routed execution, asking `access` of its runners. */
async function launched(routed: PoolRouted, access: ProjectAccess) {
  await executionSchedulerLaunch(
    poolRoutedService(rig, access),
    routed.project.epoch,
  );
  return poolRoutedStanding(rig, routed);
}

/** The standing of an execution blocked because nothing that takes work could run it. */
const blocked = {
  execution: {
    status: "Terminal",
    outcome: "Blocked",
    blocked_reason: "RequiredCapabilityUnavailable",
    retries_spent: 0,
    backed_off: true,
  },
  attempts: [
    { state: "Withdrawn", evidence: "PlacementIncompatible", pool: null },
  ],
};

/** The standing of an execution waiting on its attempt for a runner to claim it. */
const waiting = {
  execution: {
    status: "Launching",
    ...poolRoutedUnsettled,
    backed_off: false,
  },
  attempts: [{ state: "Placing", evidence: null, pool: null }],
};

test("a registered pool whose tuple stands runs nothing, so work its owner has no runner for is blocked", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-refused");
  await poolRegistered(routed);
  for (const grant of ownerGrants(routed, await ownerMade(routed)))
    await grants.write(grant);
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), blocked);
});

test("an execution with no owner is blocked though a pool whose tuple stands could run it", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-ownerless");
  await poolRegistered(routed);
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), blocked);
});

test("an owner's runner whose tuples stand leaves work it could run waiting on its attempt while it does not poll", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-permitted");
  for (const grant of await runnerOwning(routed)) await grants.write(grant);
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), waiting);
});

test("an owner's runner whose owner's tuple was taken away is revoked, so work only it would run is blocked", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-revoked");
  const [permit, member] = await runnerOwning(routed);
  await grants.write(member);
  await grants.write(permit);
  await grants.remove(permit);
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), blocked);
});

test("an authority that cannot be reached decides nothing, so work an owner's runner might run still waits", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-outage");
  await runnerOwning(routed);
  assert.deepEqual(
    await launched(routed, ketoHarnessAccessAt("http://127.0.0.1:1/")),
    waiting,
  );
});
