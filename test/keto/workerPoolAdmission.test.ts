/**
 * Whether a registered pool is admitted, asked of the authority an installation
 * actually runs. The registry is a stand-in here because what is under test is
 * the permit: a pool is recorded in PostgreSQL and authorized in Keto, and the
 * suite beside this one drives the other half.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { projectPrincipalGrant } from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  workerPoolAdmitted,
  type WorkerPoolIdentity,
  type WorkerPoolRegistry,
} from "../../src/interpreter/workerPool.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAccessAt,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();

/** A registry that knows one pool, so nothing but the permit decides the answer. */
function registryOf(
  partition: Partition,
  principal: Principal,
): WorkerPoolRegistry {
  const identity: WorkerPoolIdentity = {
    partition,
    pool: "pool-one",
    capabilities: ["linux-containers"],
  };
  return {
    register: () => Promise.resolve(true),
    deregister: () => Promise.resolve(undefined),
    identify: (asked) =>
      Promise.resolve(asked === principal ? identity : undefined),
  };
}

test("a registered pool the authority permits is admitted with what it declared", async () => {
  const partition = ketoHarnessPartition("pool-admitted");
  const principal = oidcPrincipal(ketoHarnessIssuer, "chuggy-pool-admitted");
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "chuggy-pool-admitted",
      tenant: partition.tenant,
      project: partition.project,
      relation: "pools",
    }),
  );
  assert.deepEqual(
    await workerPoolAdmitted(
      registryOf(partition, principal),
      access,
      principal,
    ),
    {
      partition,
      pool: "pool-one",
      capabilities: ["linux-containers"],
    },
  );
});

test("a registered pool the authority names nothing about is not admitted", async () => {
  const partition = ketoHarnessPartition("pool-ungranted");
  const principal = oidcPrincipal(ketoHarnessIssuer, "chuggy-pool-ungranted");
  assert.equal(
    await workerPoolAdmitted(
      registryOf(partition, principal),
      access,
      principal,
    ),
    undefined,
  );
});

test("a pool polling through an authority that cannot answer is left undecided", async () => {
  const partition = ketoHarnessPartition("pool-outage");
  const principal = oidcPrincipal(ketoHarnessIssuer, "chuggy-pool-outage");
  await assert.rejects(
    workerPoolAdmitted(
      registryOf(partition, principal),
      ketoHarnessAccessAt("http://127.0.0.1:1/"),
      principal,
    ),
    { name: "ProjectAccessUnavailable" },
  );
});
