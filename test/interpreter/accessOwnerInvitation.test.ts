/**
 * The site's invitation of a person into a tenant of their own, over an
 * authority, a directory and GitHub held in memory: when the tenant is free,
 * the person's or taken, who may ask what, what is written, and what is asked
 * of whom before each refusal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessOwnerInvitation } from "../../src/contract/accessPlane.ts";
import {
  projectNameCharsMax,
  reservedTenantNames,
} from "../../src/contract/requests.ts";
import { AccessDirectoryUnavailable } from "../../src/interpreter/accessDirectory.ts";
import { accessOwnerInvitationGrants } from "../../src/interpreter/accessOwnerInvitation.ts";
import {
  ProjectAccessUnavailable,
  projectAccessSiteObject,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectTenantGrant,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
} from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessMemoryOwnerInvitations,
  directoryMemory,
  directorySubject,
  githubMemory,
  githubUser,
  type DirectoryAccount,
} from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessMemory,
  type AccessMemoryKind,
} from "./accessPlaneFixture.ts";

const owned = asTenantId("octo-works");
const sita = accessFixturePrincipal("sita");

const sent: AccessOwnerInvitation = {
  tenant: owned,
  github: "octo-cat",
  email: "octo@example.com",
  createAccounts: true,
};

const everyPower: readonly AccessMemoryKind[] = [
  { on: "Site", kind: "CreateTenant" },
  { on: "Site", kind: "CreateAccount" },
  { on: "Site", kind: "ManageSiteAuthorities" },
];

/**
 * A tenant alice administers, sita holding `powers` on the site, a directory
 * holding `accounts`, and GitHub answering `answers`.
 */
async function owning(
  accounts: readonly DirectoryAccount[] = [],
  powers: readonly AccessMemoryKind[] = everyPower,
  answers: Parameters<typeof githubMemory>[0] = {
    "octo-cat": githubUser("990000001", "Octo-Cat"),
  },
) {
  const memory = accessMemory();
  await memory.grants.write(
    tenantAdministratorGrant(
      accessFixturePrincipal("alice"),
      asTenantId("acme"),
    ),
  );
  memory.changes.length = 0;
  accessGiven(memory, sita, powers);
  const directory = directoryMemory(accounts);
  const github = githubMemory(answers);
  const invitations = accessMemoryOwnerInvitations(memory, directory, github);
  return {
    memory,
    directory,
    github,
    invite: (invitation = sent, caller = sita) =>
      invitations.invite(caller, invitation),
  };
}

/** The writes an invitation of `subject` is expected to make, in order. */
function writesOf(subject: string, createAccounts = true) {
  return accessOwnerInvitationGrants(
    accessFixtureIssuer,
    owned,
    subject,
    createAccounts,
  ).map((grant) => ["write", grant] as const);
}

test("a free tenant and a GitHub account nothing holds make one account, the administrator, the tenant's defaults and the account creators, the administrator first", async () => {
  const { memory, directory, invite } = await owning();
  const subject = directorySubject(0);
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject,
    created: true,
  });
  assert.deepEqual(directory.creations, [
    {
      email: "octo@example.com",
      github: { id: "990000001", login: "Octo-Cat" },
      invitedBy: "sita",
      tenant: owned,
    },
  ]);
  assert.deepEqual(memory.changes, [
    ["write", tenantAdministratorGrant(accessFixturePrincipal(subject), owned)],
    ...tenantAuthorityDefaults(owned).map((grant) => ["write", grant]),
    [
      "write",
      {
        namespace: "Site",
        object: projectAccessSiteObject,
        relation: "account_creators",
        holder: {
          subject: "Holders",
          namespace: "Tenant",
          object: projectAccessTenantObject(owned),
          relation: "admins",
        },
      },
    ],
  ]);
});

test("not asking for account creation writes nothing on the site, and asks no `ManageSiteAuthorities`", async () => {
  const { memory, invite } = await owning(
    [],
    [
      { on: "Site", kind: "CreateTenant" },
      { on: "Site", kind: "CreateAccount" },
    ],
  );
  assert.equal(
    (await invite({ ...sent, createAccounts: false })).invited,
    "Invited",
  );
  assert.deepEqual(memory.changes, writesOf(directorySubject(0), false));
  assert.ok(memory.changes.every(([, grant]) => grant.namespace !== "Site"));
  assert.ok(!memory.asked.some(([kind]) => kind === "ManageSiteAuthorities"));
});

test("the same invitation again creates nothing, writes the same tuples, and answers the same subject not created", async () => {
  const { memory, directory, invite } = await owning();
  await invite();
  memory.changes.length = 0;
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject: directorySubject(0),
    created: false,
  });
  assert.equal(directory.creations.length, 1);
  assert.deepEqual(memory.changes, writesOf(directorySubject(0)));
});

test("an account carrying the GitHub credential is made the administrator whatever email was given, and no `CreateAccount` is asked", async () => {
  const held = directorySubject(7);
  const { memory, directory, invite } = await owning(
    [{ subject: held, email: "elsewhere@example.com", githubId: "990000001" }],
    [{ on: "Site", kind: "CreateTenant" }],
  );
  assert.deepEqual(await invite({ ...sent, createAccounts: false }), {
    invited: "Invited",
    subject: held,
    created: false,
  });
  assert.deepEqual(directory.asked, ["githubHolder:990000001"]);
  assert.deepEqual(memory.changes, writesOf(held, false));
  assert.ok(!memory.asked.some(([kind]) => kind === "CreateAccount"));
});

test("a tenant another administers, one holding only its site link, and one a project alone inherits from are each taken, with nothing made or written", async () => {
  const held = directorySubject(7);
  const holdings = [
    tenantAdministratorGrant(accessFixturePrincipal("someone"), owned),
    tenantAuthorityDefaults(owned)[0],
    projectTenantGrant(accessFixturePartition(owned, "web")),
  ];
  for (const holding of holdings)
    for (const accounts of [
      [],
      [{ subject: held, email: "o@example.com", githubId: "990000001" }],
    ]) {
      const { memory, directory, invite } = await owning(accounts);
      if (holding !== undefined) await memory.grants.write(holding);
      memory.changes.length = 0;
      assert.deepEqual(await invite(), { invited: "TenantTaken" });
      assert.deepEqual(directory.creations, []);
      assert.ok(
        !directory.asked.some((asked) => asked.startsWith("emailHeld")),
      );
      assert.deepEqual(memory.changes, []);
    }
});

test("a name outside the shape, past its bound or reserved is refused before GitHub, the directory or the authority is asked anything", async () => {
  const { memory, directory, github, invite } = await owning();
  for (const tenant of [
    "Octo",
    "-octo",
    "acme/co",
    "o".repeat(projectNameCharsMax + 1),
    ...reservedTenantNames,
  ])
    await assert.rejects(invite({ ...sent, tenant }), RangeError, tenant);
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
  assert.deepEqual(memory.asked, []);
  assert.equal(memory.pages, 0);
});

test("each power is asked by its own kind: `CreateTenant` before anything, `ManageSiteAuthorities` only for account creation, `CreateAccount` only where an account is made", async () => {
  const absent = await owning([], []);
  assert.deepEqual(await absent.invite(), { invited: "Absent" });
  assert.deepEqual(absent.github.looked, []);
  assert.deepEqual(absent.directory.asked, []);
  assert.deepEqual(absent.memory.asked, [
    ["CreateTenant", projectAccessSiteObject],
  ]);

  const tenantOnly: readonly AccessMemoryKind[] = [
    { on: "Site", kind: "CreateTenant" },
    { on: "Site", kind: "ManageSiteAuthorities" },
  ];
  const accountless = await owning([], tenantOnly);
  assert.deepEqual(await accountless.invite(), {
    invited: "AccountNotPermitted",
  });
  assert.deepEqual(accountless.directory.asked, ["githubHolder:990000001"]);
  assert.deepEqual(accountless.memory.changes, []);
  const existing = await owning(
    [
      {
        subject: directorySubject(7),
        email: "o@example.com",
        githubId: "990000001",
      },
    ],
    tenantOnly,
  );
  assert.equal((await existing.invite()).invited, "Invited");

  const unmanaging = await owning(
    [],
    [
      { on: "Site", kind: "CreateTenant" },
      { on: "Site", kind: "CreateAccount" },
    ],
  );
  assert.deepEqual(await unmanaging.invite(), { invited: "Refused" });
  assert.deepEqual(unmanaging.github.looked, []);
  assert.deepEqual(unmanaging.directory.creations, []);
  assert.deepEqual(unmanaging.memory.changes, []);
  assert.equal(
    (await unmanaging.invite({ ...sent, createAccounts: false })).invited,
    "Invited",
  );
});

test("GitHub's and the directory's refusals are the tenant invitation's own outcomes, and none writes a tuple", async () => {
  const answers = {
    "octo-cat": githubUser("990000001", "Octo-Cat"),
    nobody: { looked: "Unknown" },
    org: githubUser("1", "org", "Organization"),
    down: { looked: "Unavailable" },
  } as const;
  const cases: readonly (readonly [
    string,
    (directory: ReturnType<typeof directoryMemory>) => void,
    string,
  ])[] = [
    ["nobody", () => undefined, "GithubAccountUnknown"],
    ["org", () => undefined, "GithubAccountNotUser"],
    ["down", () => undefined, "GithubUnavailable"],
    [
      "octo-cat",
      (directory) =>
        directory.accounts.push({
          subject: directorySubject(9),
          email: "OCTO@example.com",
        }),
      "EmailHeld",
    ],
    [
      "octo-cat",
      (directory) => (directory.creationAnswer = "EmailRefused"),
      "EmailRefused",
    ],
    [
      "octo-cat",
      (directory) => (directory.creationAnswer = "Conflict"),
      "DirectoryRaced",
    ],
  ];
  for (const [github, prepared, expected] of cases) {
    const { memory, directory, invite } = await owning([], everyPower, answers);
    prepared(directory);
    assert.deepEqual(await invite({ ...sent, github }), { invited: expected });
    assert.deepEqual(memory.changes, [], expected);
  }
  const unavailable = await owning();
  unavailable.directory.unavailable = true;
  await assert.rejects(unavailable.invite(), AccessDirectoryUnavailable);
  assert.deepEqual(unavailable.memory.changes, []);
});

test("the authority unanswering after the account was made is thrown, and the same invitation sent again completes", async () => {
  const { memory, directory, invite } = await owning();
  directory.beforeCreation = () => {
    memory.unavailable = true;
  };
  await assert.rejects(invite(), ProjectAccessUnavailable);
  assert.equal(directory.accounts.length, 1);
  assert.deepEqual(memory.changes, []);
  memory.unavailable = false;
  directory.beforeCreation = undefined;
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject: directorySubject(0),
    created: false,
  });
  assert.deepEqual(memory.changes, writesOf(directorySubject(0)));
});

test("a plane with no directory, or no GitHub, answers not configured and asks nothing", async () => {
  const { memory } = await owning();
  const github = githubMemory({});
  for (const invitations of [
    accessMemoryOwnerInvitations(memory, undefined, github),
    accessMemoryOwnerInvitations(memory, directoryMemory(), undefined),
  ])
    assert.deepEqual(await invitations.invite(sita, sent), {
      invited: "NotConfigured",
    });
  assert.deepEqual(github.looked, []);
  assert.deepEqual(memory.asked, []);
  assert.deepEqual(memory.changes, []);
});
