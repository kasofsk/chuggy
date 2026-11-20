/**
 * Whether a registered personal runner or chat host is admitted, asked
 * of the authority an installation actually runs. The registries are stand-ins here
 * because what is under test is the permit: each is recorded in PostgreSQL and
 * authorized in Keto, and the suite beside this one drives the other half.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import { forgeCredentialMinting } from "../../src/interpreter/forgeCredentials.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import { allProjectAccessKinds } from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  workerPoolAdmitted,
  type ChatHostIdentity,
  type ChatHostPlaneRegistry,
  type PersonalRunnerIdentity,
  type PersonalRunnerPlaneRegistry,
  type PoolPlaneRegistries,
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

/** A registry of personal runners that knows `runner` alone, or none. */
function personalOf(
  runner?: PersonalRunnerIdentity,
): PersonalRunnerPlaneRegistry {
  return {
    identify: (asked) =>
      Promise.resolve(asked === runner?.principal ? runner : undefined),
  };
}

/** A registry of chat hosts that knows `host` alone, or none. */
function chatHostsOf(host?: ChatHostIdentity): ChatHostPlaneRegistry {
  return {
    identify: (asked) =>
      Promise.resolve(asked === host?.principal ? host : undefined),
  };
}

/** The registries a poll is looked up in, no chat host among them unless named. */
function registriesOf(
  personal: PersonalRunnerPlaneRegistry,
  chatHosts: ChatHostPlaneRegistry = chatHostsOf(),
): PoolPlaneRegistries {
  return { personal, chatHosts };
}

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
      registriesOf(personalOf(runner)),
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

test("a personal runner polling through an authority that cannot answer is left undecided", async () => {
  const runner = personalRunner(
    ketoHarnessPartition("personal-outage"),
    "personal-outage",
  );
  await assert.rejects(
    workerPoolAdmitted(
      registriesOf(personalOf(runner)),
      ketoHarnessAccessAt("http://127.0.0.1:1/"),
      runner.principal,
    ),
    { name: "ProjectAccessUnavailable" },
  );
});

test("a chat host is admitted under its owner's permit to register a personal runner, and not once they lose it", async () => {
  const partition = ketoHarnessPartition("chat-host-admitted");
  const host: ChatHostIdentity = {
    tenant: partition.tenant,
    owner: oidcPrincipal(ketoHarnessIssuer, "member-chat-host-admitted"),
    principal: oidcPrincipal(ketoHarnessIssuer, "chuggy-host-admitted"),
  };
  const admitted = () =>
    workerPoolAdmitted(
      registriesOf(personalOf(), chatHostsOf(host)),
      access,
      host.principal,
    );
  assert.equal(await admitted(), undefined);
  const permit = tenantPrincipalGrant({
    issuer: ketoHarnessIssuer,
    subject: "member-chat-host-admitted",
    tenant: partition.tenant,
    relation: "personal_runners",
  });
  await grants.write(permit);
  assert.deepEqual(await admitted(), { ...host, kind: "ChatHost" });
  await grants.remove(permit);
  assert.equal(await admitted(), undefined);
});

test("a personal runner holds no permit of any project its owner serves, so a project's forge credential answers it nothing while it answers its owner", async () => {
  const partition = ketoHarnessPartition("personal-unminted");
  const runner = personalRunner(partition, "personal-unminted");
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
          landing: { kind: "GitMerge", mode: "Push", policy: "Direct" },
          pipelinesWritable: false,
          pipelinesRunnable: false,
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
    (await minting.mint(runner.owner, partition, request)).result,
    "Authorized",
  );
});
