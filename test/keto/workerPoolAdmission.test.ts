/**
 * Whether a registered pool or personal runner is admitted, asked of the
 * authority an installation actually runs. The registries are stand-ins here
 * because what is under test is the permit: each is recorded in PostgreSQL and
 * authorized in Keto, and the suite beside this one drives the other half.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { forgeCredentialMinting } from "../../src/interpreter/forgeCredentials.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import { allProjectAccessKinds } from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asRepositoryLanding } from "../../src/interpreter/repositoryBinding.ts";
import {
  workerPoolAdmitted,
  type PersonalRunnerIdentity,
  type PersonalRunnerPlaneRegistry,
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

/** A registry of personal runners that knows `runner` alone, or none. */
function personalOf(
  runner?: PersonalRunnerIdentity,
): PersonalRunnerPlaneRegistry {
  return {
    identify: (asked) =>
      Promise.resolve(asked === runner?.principal ? runner : undefined),
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
      personalOf(),
      access,
      principal,
    ),
    {
      kind: "Dedicated",
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
      personalOf(),
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
      personalOf(),
      ketoHarnessAccessAt("http://127.0.0.1:1/"),
      principal,
    ),
    { name: "ProjectAccessUnavailable" },
  );
});

/** A member's personal runner in the tenant of `partition`, its principal named by no relation. */
function personalRunner(
  partition: Partition,
  label: string,
): PersonalRunnerIdentity {
  return {
    tenant: partition.tenant,
    owner: oidcPrincipal(ketoHarnessIssuer, `member-${label}`),
    principal: oidcPrincipal(ketoHarnessIssuer, `chuggy-personal-${label}`),
  };
}

test("a personal runner is admitted while its owner may register one in its tenant, and not once they may not", async () => {
  const partition = ketoHarnessPartition("personal-admitted");
  const runner = personalRunner(partition, "personal-admitted");
  const admitted = () =>
    workerPoolAdmitted(
      registryOf(partition, oidcPrincipal(ketoHarnessIssuer, "no-pool")),
      personalOf(runner),
      access,
      runner.principal,
    );
  assert.equal(await admitted(), undefined);
  const permit = tenantPrincipalGrant({
    issuer: ketoHarnessIssuer,
    subject: "member-personal-admitted",
    tenant: partition.tenant,
    relation: "personal_runners",
  });
  await grants.write(permit);
  assert.deepEqual(await admitted(), { ...runner, kind: "Personal" });
  await grants.remove(permit);
  assert.equal(await admitted(), undefined);
});

test("a personal runner holds no permit of any project its owner serves, so a project's forge credential answers it nothing while it answers a pool", async () => {
  const partition = ketoHarnessPartition("personal-unminted");
  const runner = personalRunner(partition, "personal-unminted");
  const pool = oidcPrincipal(ketoHarnessIssuer, "chuggy-pool-minted");
  for (const grant of [
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "member-personal-unminted",
      tenant: partition.tenant,
      relation: "personal_runners",
    }),
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "member-personal-unminted",
      tenant: partition.tenant,
      project: partition.project,
      relation: "admins",
    }),
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "chuggy-pool-minted",
      tenant: partition.tenant,
      project: partition.project,
      relation: "pools",
    }),
  ])
    await grants.write(grant);
  for (const kind of allProjectAccessKinds)
    assert.equal(
      await access.authorize(runner.principal, partition, kind),
      undefined,
      kind,
    );
  const repository = asRepositoryId("github.com/owner/repo");
  const asked: string[] = [];
  const minting = forgeCredentialMinting(
    access,
    {
      landing: () =>
        Promise.resolve({
          repository,
          boundAt: "2026-10-01T00:00:00Z",
          landing: asRepositoryLanding("Push"),
          pipelinesWritable: false,
        }),
    },
    {
      token: (named) => {
        asked.push(named);
        return Promise.resolve({
          minted: "Token",
          token: asForgeInstallationToken("ghs_minted"),
          expiresAtMs: 1,
        });
      },
    },
  );
  const request = { repository, permissions: "read" } as const;
  assert.deepEqual(await minting.mint(runner.principal, partition, request), {
    result: "NotFound",
  });
  assert.deepEqual(asked, [], "a runner's mint reached the forge");
  assert.equal(
    (await minting.mint(pool, partition, request)).result,
    "Authorized",
  );
});
