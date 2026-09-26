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
import { allProjectAccessKinds } from "../../src/interpreter/projectAccess.ts";
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
    principal,
  };
  return {
    register: () => Promise.resolve(true),
    clientOf: () => Promise.resolve(undefined),
    deregister: () => Promise.resolve(false),
    identify: (asked) =>
      Promise.resolve(asked === principal ? identity : undefined),
  };
}

test("a registered pool the authority permits is admitted as the registration its principal names", async () => {
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
      principal,
    },
  );
});

test("a pool's relation carries Execute and no other permit the project answers", async () => {
  const partition = ketoHarnessPartition("pool-bounded");
  const principal = oidcPrincipal(ketoHarnessIssuer, "chuggy-pool-bounded");
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "chuggy-pool-bounded",
      tenant: partition.tenant,
      project: partition.project,
      relation: "pools",
    }),
  );
  for (const kind of allProjectAccessKinds)
    assert.equal(
      (await access.authorize(principal, partition, kind)) !== undefined,
      kind === "Execute",
      kind,
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
