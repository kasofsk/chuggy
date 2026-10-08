/**
 * The invitation's decisions over an authority, a directory and GitHub held in
 * memory: when an account is found, created or refused, what is granted, and
 * what is asked of whom before each refusal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessInvitation } from "../../src/contract/accessPlane.ts";
import { AccessDirectoryUnavailable } from "../../src/interpreter/accessDirectory.ts";
import { ProjectAccessUnavailable } from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  accessMemoryInvitations,
  directoryMemory,
  directorySubject,
  githubMemory,
  githubUser,
  type DirectoryAccount,
  type DirectoryMemory,
  type GithubMemory,
} from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenTenantAdministrator,
  accessMemory,
  accessTenantAdministratorsNotLink,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme", "web");
const elsewhere = accessFixturePartition("other", "web");
const tenant = web.tenant;
const alice = accessFixturePrincipal("alice");
const mallory = accessFixturePrincipal("mallory");

const octo = githubUser("990000001", "Octo-Cat");

const invitation: AccessInvitation = {
  github: "octo-cat",
  email: "octo@example.com",
  role: "Member",
  projects: [{ project: "web", roles: ["Developer", "Dispatcher"] }],
};

interface Invited {
  readonly memory: AccessMemory;
  readonly directory: DirectoryMemory;
  readonly github: GithubMemory;
  readonly invite: (
    sent?: AccessInvitation,
    caller?: typeof alice,
  ) => ReturnType<ReturnType<typeof accessMemoryInvitations>["invite"]>;
}

/**
 * A tenant alice administers with one linked project, holding what the
 * defaults give her and, where `creates`, `CreateAccount`; a directory holding
 * `accounts`, and GitHub answering `answers`.
 */
async function invited(
  accounts: readonly DirectoryAccount[] = [],
  answers: Parameters<typeof githubMemory>[0] = { "octo-cat": octo },
  creates = true,
): Promise<Invited> {
  const memory = accessMemory();
  await memory.grants.write(projectTenantGrant(web));
  await memory.grants.write(projectTenantGrant(elsewhere));
  await memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
  );
  memory.changes.length = 0;
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  if (creates)
    accessGiven(memory, alice, [{ on: "Site", kind: "CreateAccount" }]);
  const directory = directoryMemory(accounts);
  const github = githubMemory(answers);
  const invitations = accessMemoryInvitations(memory, directory, github);
  return {
    memory,
    directory,
    github,
    invite: (sent = invitation, caller = alice) =>
      invitations.invite(caller, tenant, sent),
  };
}

/** The grants an invitation of `subject` is expected to write, in order. */
function grantsOf(subject: string) {
  const at = { issuer: accessFixtureIssuer, subject, tenant };
  return [
    ["write", tenantPrincipalGrant({ ...at, relation: "members" })],
    [
      "write",
      projectPrincipalGrant({
        ...at,
        project: web.project,
        relation: "developers",
      }),
    ],
    [
      "write",
      projectPrincipalGrant({
        ...at,
        project: web.project,
        relation: "dispatchers",
      }),
    ],
  ];
}

test("an invitation for a GitHub account nothing holds creates one account carrying it, grants the roles, and answers it created", async () => {
  const { memory, directory, invite } = await invited();
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
      invitedBy: "alice",
      tenant,
    },
  ]);
  assert.deepEqual(memory.changes, grantsOf(subject));
});

test("the same invitation again creates nothing, grants the same roles, and answers the same subject not created", async () => {
  const { memory, directory, invite } = await invited();
  const first = await invite();
  memory.changes.length = 0;
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject: directorySubject(0),
    created: false,
  });
  assert.equal(first.invited, "Invited");
  assert.equal(directory.creations.length, 1);
  assert.deepEqual(memory.changes, grantsOf(directorySubject(0)));
});

test("an invitation of a person with no account by a caller who may not make one is refused before the email is asked about, and nothing is made or written", async () => {
  const { memory, directory, invite } = await invited([], undefined, false);
  assert.deepEqual(await invite(), { invited: "AccountNotPermitted" });
  assert.deepEqual(directory.asked, ["githubHolder:990000001"]);
  assert.deepEqual(directory.creations, []);
  assert.deepEqual(memory.changes, []);
  assert.equal(memory.asked.at(-1)?.[0], "CreateAccount");
});

test("an account carrying the GitHub credential is the person whatever email was given, and neither the email nor `CreateAccount` is asked about", async () => {
  const held = directorySubject(7);
  const { memory, directory, invite } = await invited(
    [
      {
        subject: held,
        email: "someone-else@example.com",
        githubId: "990000001",
      },
    ],
    undefined,
    false,
  );
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject: held,
    created: false,
  });
  assert.deepEqual(directory.asked, ["githubHolder:990000001"]);
  assert.deepEqual(memory.changes, grantsOf(held));
  assert.ok(!memory.asked.some(([kind]) => kind === "CreateAccount"));
});

test("an email an account holds, where none carries the credential, is the conflict: reads and no write, and nothing granted", async () => {
  const { memory, directory, invite } = await invited([
    { subject: directorySubject(7), email: "OCTO@example.com" },
  ]);
  assert.deepEqual(await invite(), { invited: "EmailHeld" });
  assert.deepEqual(directory.asked, [
    "githubHolder:990000001",
    "emailHeld:octo@example.com",
  ]);
  assert.deepEqual(directory.creations, []);
  assert.deepEqual(memory.changes, []);
});

test("a creation that conflicts is followed by one more finding: the credential now held is granted to, an email now held is the conflict, and neither is retryable", async () => {
  const racer = directorySubject(9);
  const credential = await invited();
  credential.directory.beforeCreation = () => {
    credential.directory.accounts.push({
      subject: racer,
      email: "octo@example.com",
      githubId: "990000001",
    });
  };
  assert.deepEqual(await credential.invite(), {
    invited: "Invited",
    subject: racer,
    created: false,
  });
  assert.deepEqual(credential.memory.changes, grantsOf(racer));

  const email = await invited();
  email.directory.beforeCreation = () => {
    email.directory.accounts.push({
      subject: racer,
      email: "octo@example.com",
    });
  };
  assert.deepEqual(await email.invite(), { invited: "EmailHeld" });
  assert.deepEqual(email.memory.changes, []);

  const neither = await invited();
  neither.directory.creationAnswer = "Conflict";
  assert.deepEqual(await neither.invite(), { invited: "DirectoryRaced" });
  assert.deepEqual(neither.directory.asked, [
    "githubHolder:990000001",
    "emailHeld:octo@example.com",
    "create:octo@example.com",
    "githubHolder:990000001",
    "emailHeld:octo@example.com",
  ]);
  assert.deepEqual(neither.memory.changes, []);
});

test("an unknown username, an organisation and a bot are each refused, reaching neither the directory nor a grant; GitHub unanswering is retryable", async () => {
  const kinds = {
    "octo-cat": { looked: "Unknown" },
    org: githubUser("1", "org", "Organization"),
    bot: githubUser("2", "bot", "Bot"),
    down: { looked: "Unavailable" },
  } as const;
  for (const [github, expected] of [
    ["octo-cat", "GithubAccountUnknown"],
    ["org", "GithubAccountNotUser"],
    ["bot", "GithubAccountNotUser"],
    ["down", "GithubUnavailable"],
  ] as const) {
    const { memory, directory, invite } = await invited([], kinds);
    assert.deepEqual(await invite({ ...invitation, github }), {
      invited: expected,
    });
    assert.deepEqual(directory.asked, [], github);
    assert.deepEqual(memory.changes, [], github);
  }
});

test("a project the authority does not hold under the tenant is refused before GitHub or the directory is asked", async () => {
  const { memory, directory, github, invite } = await invited();
  await memory.grants.write(
    accessTenantAdministratorsNotLink(accessFixturePartition("acme", "held")),
  );
  memory.changes.length = 0;
  for (const project of ["loose", "absent", "held"])
    assert.deepEqual(
      await invite({
        ...invitation,
        projects: [{ project, roles: ["Admin"] }],
      }),
      { invited: "ProjectUnknown" },
    );
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
  assert.deepEqual(memory.changes, []);
});

test("an invitation naming a role the caller may not grant is refused before GitHub or the directory is asked, and nothing is written", async () => {
  const { memory, directory, github, invite } = await invited();
  const dee = accessFixturePrincipal("dee");
  accessGiven(memory, dee, [
    { on: "Tenant", tenant, kind: "GrantMember" },
    { on: "Project", partition: web, kind: "GrantDeveloper" },
    { on: "Site", kind: "CreateAccount" },
  ]);
  for (const sent of [
    invitation,
    { ...invitation, role: "Admin", projects: [] },
  ] satisfies AccessInvitation[])
    assert.deepEqual(await invite(sent, dee), { invited: "Refused" });
  assert.deepEqual(
    await invite(
      { ...invitation, projects: [{ project: "web", roles: ["Developer"] }] },
      dee,
    ),
    { invited: "Invited", subject: directorySubject(0), created: true },
  );
  assert.deepEqual(github.looked, ["octo-cat"]);
  assert.deepEqual(directory.asked[0], "githubHolder:990000001");
  assert.equal(memory.changes.length, 2);
});

test("a caller who may not invite is answered absent, and GitHub and the directory are asked nothing", async () => {
  const { memory, directory, github, invite } = await invited();
  assert.deepEqual(await invite(invitation, mallory), { invited: "Absent" });
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
  assert.deepEqual(memory.changes, []);
});

test("an email the directory will not hold is refused under the email's outcome, and nothing is granted", async () => {
  const { memory, directory, invite } = await invited();
  directory.creationAnswer = "EmailRefused";
  assert.deepEqual(await invite(), { invited: "EmailRefused" });
  assert.deepEqual(memory.changes, []);
});

test("the directory unanswering is thrown and grants nothing", async () => {
  const { memory, directory, invite } = await invited();
  directory.unavailable = true;
  await assert.rejects(invite(), AccessDirectoryUnavailable);
  assert.deepEqual(memory.changes, []);
});

test("the authority unanswering after the account was made is thrown, and the same invitation sent again completes", async () => {
  const { memory, directory, invite } = await invited();
  directory.beforeCreation = () => {
    memory.unavailable = true;
  };
  await assert.rejects(invite(), ProjectAccessUnavailable);
  assert.equal(directory.accounts.length, 1);
  memory.unavailable = false;
  directory.beforeCreation = undefined;
  assert.deepEqual(await invite(), {
    invited: "Invited",
    subject: directorySubject(0),
    created: false,
  });
  assert.deepEqual(memory.changes, grantsOf(directorySubject(0)));
});

test("a plane with no directory, or no GitHub, answers every invitation as not configured and asks nothing", async () => {
  const { memory } = await invited();
  const github = githubMemory({ "octo-cat": octo });
  for (const invitations of [
    accessMemoryInvitations(memory, undefined, github),
    accessMemoryInvitations(memory, directoryMemory(), undefined),
  ])
    assert.deepEqual(await invitations.invite(alice, tenant, invitation), {
      invited: "NotConfigured",
    });
  assert.deepEqual(github.looked, []);
  assert.deepEqual(memory.changes, []);
});
