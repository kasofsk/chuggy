/**
 * What the worker App reaches of a bound repository, read the way the plane's
 * mint would find it: the claim on the owner, then the installation's own
 * selection. Every read that settles nothing is `Unknown`, so no case here can
 * pass by an outage reading as covered.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import type {
  ForgeInstallationPermissionsRead,
  ForgeRepositoriesRead,
  ForgeRepositorySummary,
} from "../../src/interpreter/forgeDirectory.ts";
import {
  asForgeAccount,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeInstallation,
  type ForgeInstallationQuery,
} from "../../src/interpreter/forgeInstallation.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  repositoryWorkerReaches,
  type RepositoryWorkerReachPorts,
} from "../../src/interpreter/repositoryWorkerReach.ts";

const tenant = asTenantId("vteng");
const forge = asForgeId("github");
const owner = asForgeAccount("kasofsk");
const installationId = asForgeInstallationId("156786211");
const settingsUrl =
  "https://github.com/organizations/kasofsk/settings/installations/156786211";
const chuggy = asRepositoryId("https://github.com/kasofsk/chuggy.git");
const common = asRepositoryId("https://github.com/kasofsk/chuggy-common.git");
const elsewhere = asRepositoryId("https://git.vteng.io/vteng/fabric.git");

function summaryOf(url: RepositoryId): ForgeRepositorySummary {
  return {
    name: asForgeRepositoryName(url.split("/").at(-1) ?? "x"),
    fullName: url,
    url,
    defaultBranch: "main",
    private: true,
  };
}

/** The installation selecting `chuggy` alone, which is what kasofsk's did. */
const selectingChuggy: ForgeRepositoriesRead = {
  read: "Repositories",
  repositories: [summaryOf(chuggy)],
  truncated: false,
};

interface FixtureAsked {
  readonly claims: ForgeInstallationQuery[];
  readonly listed: ForgeInstallation[];
  readonly settings: string[];
}

function fixturePorts(
  given: {
    readonly claimed?: boolean;
    readonly listed?: ForgeRepositoriesRead | Error;
    readonly settings?: ForgeInstallationPermissionsRead;
  } = {},
): {
  readonly ports: RepositoryWorkerReachPorts;
  readonly asked: FixtureAsked;
} {
  const asked: FixtureAsked = { claims: [], listed: [], settings: [] };
  const listed = given.listed ?? selectingChuggy;
  return {
    asked,
    ports: {
      forge,
      app: "worker",
      addressOf: (repository) => {
        const address =
          /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(
            repository,
          );
        return address?.[1] === undefined || address[2] === undefined
          ? undefined
          : { account: asForgeAccount(address[1]), name: address[2] };
      },
      installations: {
        installation: (query) => {
          asked.claims.push(query);
          return Promise.resolve(
            given.claimed === false
              ? undefined
              : {
                  forge: query.forge,
                  app: query.app,
                  account: query.account,
                  installationId,
                },
          );
        },
      },
      installationRepositories: {
        repositories: (installation) => {
          asked.listed.push(installation);
          return listed instanceof Error
            ? Promise.reject(listed)
            : Promise.resolve(listed);
        },
      },
      directory: {
        installationPermissions: (asking) => {
          asked.settings.push(asking);
          return Promise.resolve(
            given.settings ?? {
              read: "Permissions",
              permissions: "Current",
              settingsUrl,
            },
          );
        },
      },
    },
  };
}

test("a repository the owner's installation selects is covered, and one it does not names the installation and its settings", async () => {
  const { ports, asked } = fixturePorts();
  const reaches = await repositoryWorkerReaches(ports, tenant, [
    chuggy,
    common,
  ]);
  assert.deepEqual(
    reaches,
    new Map([
      [chuggy, { reach: "Covered" }],
      [common, { reach: "Unselected", installationId, settingsUrl }],
    ]),
  );
  assert.deepEqual(
    asked.claims,
    [
      { forge, app: "worker", account: owner, tenant },
      { forge, app: "worker", account: owner, tenant },
    ],
    "the claim is looked up under the asking tenant, as the mint looks it up",
  );
  assert.equal(asked.listed.length, 1, "one installation is listed once");
  assert.deepEqual(asked.settings, [installationId]);
});

test("an owner the tenant claims no installation on is unclaimed, and no forge is asked", async () => {
  const { ports, asked } = fixturePorts({ claimed: false });
  assert.deepEqual(
    await repositoryWorkerReaches(ports, tenant, [common]),
    new Map([[common, { reach: "Unclaimed", account: owner }]]),
  );
  assert.deepEqual(asked.listed, []);
});

test("a read that settled nothing is unknown, never covered", async () => {
  const cases: readonly (Parameters<typeof fixturePorts>[0] & {
    readonly name: string;
  })[] = [
    { name: "a listing outage", listed: { read: "Unavailable" } },
    { name: "a listing refused", listed: { read: "Denied" } },
    { name: "a listing that raised", listed: new Error("the forge went away") },
    {
      name: "a truncated listing not naming it",
      listed: { ...selectingChuggy, truncated: true },
    },
    { name: "a settings read outage", settings: { read: "Unavailable" } },
  ];
  for (const { name, ...given } of cases)
    assert.deepEqual(
      await repositoryWorkerReaches(fixturePorts(given).ports, tenant, [
        common,
      ]),
      new Map([[common, { reach: "Unknown" }]]),
      name,
    );
});

test("a truncated listing that names the repository still covers it", async () => {
  const { ports } = fixturePorts({
    listed: { ...selectingChuggy, truncated: true },
  });
  assert.deepEqual(
    await repositoryWorkerReaches(ports, tenant, [chuggy]),
    new Map([[chuggy, { reach: "Covered" }]]),
  );
});

test("a binding written otherwise than the listing names the same repository, and is covered", async () => {
  const bareChuggy = asRepositoryId("https://github.com/kasofsk/chuggy");
  const casedChuggy = asRepositoryId("https://github.com/Kasofsk/Chuggy.git");
  const { ports } = fixturePorts();
  assert.deepEqual(
    await repositoryWorkerReaches(ports, tenant, [bareChuggy, casedChuggy]),
    new Map([
      [bareChuggy, { reach: "Covered" }],
      [casedChuggy, { reach: "Covered" }],
    ]),
  );
});

test("a repository this forge does not address is not asked about", async () => {
  const { ports, asked } = fixturePorts();
  assert.deepEqual(
    await repositoryWorkerReaches(ports, tenant, [elsewhere]),
    new Map(),
  );
  assert.deepEqual(asked.claims, []);
});

test("nothing is held between questions, so a selection changed on the forge is read as it now stands", async () => {
  const { ports, asked } = fixturePorts();
  await repositoryWorkerReaches(ports, tenant, [chuggy]);
  await repositoryWorkerReaches(ports, tenant, [chuggy]);
  assert.equal(asked.listed.length, 2);
});
