/**
 * Whether the scheduler counts a registered pool as able to run its project's
 * work, asked of a real database and a real authority together.
 *
 * WHAT NEITHER HALF CAN ANSWER ALONE. `test/postgres/schedulerPools.test.ts`
 * grants every pool it registers from memory, and `./workerPoolAdmission.test.ts`
 * asks the authority with no row behind it. Whether the principal a pool's row
 * holds is the one its `pools` tuple names, so that taking the tuple away
 * revokes the pool for the scheduler as it does for a poll, is a claim about
 * the join.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerPoolRegistry } from "../../src/adapters/postgres/workerPool.ts";
import { executionSchedulerLaunch } from "../../src/interpreter/executionSchedulerRun.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { postgresHarnessRolePool } from "../postgres/harness.ts";
import { schedulerRigOpen } from "../postgres/schedulerHarness.ts";
import {
  poolRoutedExecution,
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
const grants = ketoHarnessGrants();

/** Registers one pool of the routed execution's project under a principal of the harness issuer, and answers the `pools` tuple that would permit it. */
async function poolRegistered(
  routed: PoolRouted,
  pool: string,
  capabilities: readonly string[],
): Promise<ProjectGrant> {
  const { partition } = routed.project;
  const subject = `chuggy-pool-${pool}-${randomUUID()}`;
  assert.equal(
    await registry.register({
      partition,
      pool,
      capabilities,
      class: "Dedicated",
      clientId: subject,
      principal: oidcPrincipal(ketoHarnessIssuer, subject),
    }),
    true,
  );
  return projectPrincipalGrant({
    issuer: ketoHarnessIssuer,
    subject,
    tenant: partition.tenant,
    project: partition.project,
    relation: "pools",
  });
}

/** One launch pass over the routed execution, asking `access` of its pools. */
async function launched(routed: PoolRouted, access: ProjectAccess) {
  await executionSchedulerLaunch(
    poolRoutedService(rig, access),
    routed.project.epoch,
  );
  return poolRoutedStanding(rig, routed);
}

test("a pool whose tuple was taken away is revoked, so work only it would run is blocked", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-revoked");
  const revoked = await poolRegistered(routed, "revoked", [
    "Platform:Linux:Amd64",
  ]);
  await grants.write(revoked);
  await grants.remove(revoked);
  await grants.write(
    await poolRegistered(routed, "arm", ["Platform:Linux:Arm64"]),
  );
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), {
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
  });
});

test("a pool whose tuple stands leaves work it could run waiting on its attempt", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-permitted");
  await grants.write(
    await poolRegistered(routed, "amd", ["Platform:Linux:Amd64"]),
  );
  assert.deepEqual(await launched(routed, ketoHarnessAccess()), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: false,
    },
    attempts: [{ state: "Placing", evidence: null, pool: null }],
  });
});

test("an authority that cannot be reached decides nothing, so work no pool could run still waits", async () => {
  const routed = await poolRoutedExecution(rig, "keto-pools-outage");
  await poolRegistered(routed, "arm", ["Platform:Linux:Arm64"]);
  assert.deepEqual(
    await launched(routed, ketoHarnessAccessAt("http://127.0.0.1:1/")),
    {
      execution: {
        status: "Launching",
        ...poolRoutedUnsettled,
        backed_off: false,
      },
      attempts: [{ state: "Placing", evidence: null, pool: null }],
    },
  );
});
