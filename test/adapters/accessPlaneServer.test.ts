/**
 * The access plane's server over an authority held in memory: a body read as
 * the API's media type, a removal served, every refusal in the API's
 * envelope, and no request reaching a relation the role rosters do not name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccessPlaneApp } from "../../src/adapters/http/accessPlaneServer.ts";
import type { BearerAuthentication } from "../../src/adapters/http/server.ts";
import { githubUserLookup } from "../../src/adapters/forge/githubUserLookup.ts";
import { kratosAccessDirectory } from "../../src/adapters/kratos/identities.ts";
import {
  accessEmailCharsMax,
  accessGithubLoginCharsMax,
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessInvitedSchema,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessPlanePath,
  accessPlaneRoutes,
  accessProjectPeopleSchema,
  accessProjectRoles,
  accessTenantPeopleSchema,
  accessTenantRoles,
  type AccessPlaneRouteName,
} from "../../src/contract/accessPlane.ts";
import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
} from "../../src/contract/http.ts";
import { classify } from "../../src/contract/outcomes.ts";
import {
  accessPlaneBoundsDefault,
  accessProjectRoleRelations,
  accessTenantRoleRelations,
} from "../../src/interpreter/accessPlane.ts";
import { principalCharsMax } from "../../src/interpreter/principal.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  checkedAccessDirectorySettings,
  type AccessDirectory,
} from "../../src/interpreter/accessDirectory.ts";
import {
  accessInvitations,
  type AccessInvitations,
} from "../../src/interpreter/accessInvitation.ts";
import {
  accessMemoryInvitations,
  directoryMemory,
  githubMemory,
  githubUser,
} from "../interpreter/accessInvitationFixture.ts";
import { fixtureForge } from "./forgeFixtures.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenProjectAdministrator,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryPlane,
  type AccessMemory,
} from "../interpreter/accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const tenant = web.tenant;

/** The tokens the fake issuer knows, each the subject it names. */
const tokens: Readonly<Record<string, string>> = {
  "alice-token": "alice",
  "priya-token": "priya",
  "mo-token": "mo",
  "dee-token": "dee",
};

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const typed = { "content-type": nativeHttpMediaType };

/** What the invitation is composed with, over the authority a case serves. */
type Invitations = (memory: AccessMemory) => AccessInvitations;

/** The directory and GitHub a case invites against where it composes none of its own. */
const invitedDirectory = directoryMemory();
const invitedGithub = githubMemory({
  "octo-cat": githubUser("990000001", "Octo-Cat"),
});

/**
 * A tenant alice administers with one linked project priya administers, each
 * holding what the defaults give them and alice `CreateAccount`. Mo may only
 * manage who grants the tenant's roles, and dee may grant `Member` and
 * `Developer` on the project and make no account.
 */
async function served(
  ready = true,
  invitations: Invitations = (memory) =>
    accessMemoryInvitations(memory, invitedDirectory, invitedGithub),
  directory?: AccessDirectory,
) {
  const memory = accessMemory();
  for (const grant of [
    projectTenantGrant(web),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
    projectPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "priya",
      ...web,
      relation: "admins",
    }),
  ])
    await memory.grants.write(grant);
  memory.changes.length = 0;
  const alice = accessFixturePrincipal("alice");
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  accessGiven(memory, alice, [{ on: "Site", kind: "CreateAccount" }]);
  accessGivenProjectAdministrator(memory, accessFixturePrincipal("priya"), web);
  accessGiven(memory, accessFixturePrincipal("mo"), [
    { on: "Tenant", tenant, kind: "ManageTenantAuthorities" },
  ]);
  accessGiven(memory, accessFixturePrincipal("dee"), [
    { on: "Tenant", tenant, kind: "GrantMember" },
    { on: "Project", partition: web, kind: "GrantDeveloper" },
  ]);
  const app = createAccessPlaneApp({
    authentication: {
      authenticateBearer: (token): Promise<BearerAuthentication> => {
        const subject = tokens[token];
        return Promise.resolve(
          subject === undefined
            ? { authenticated: "InvalidToken" }
            : {
                authenticated: "Bearer",
                bearer: { principal: accessFixturePrincipal(subject) },
              },
        );
      },
    },
    plane: accessMemoryPlane(memory, accessPlaneBoundsDefault, directory),
    invitations: invitations(memory),
    ready: () => Promise.resolve(ready && !memory.unavailable),
  });
  return { memory, app };
}

/** The path one route is asked at for `web`, its subject and role where it names them. */
function pathOf(name: AccessPlaneRouteName, subject = "zed", role = "Member") {
  return accessPlanePath(name, { ...web, subject, role });
}

/** Asserts a refusal reads as the API's envelope under `classify`, naming `code` where given. */
function enveloped(
  answered: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  },
  outcome: string,
  code?: string,
): void {
  const body: unknown = JSON.parse(answered.body);
  assert.ok(errorEnvelopeSchema.safeParse(body).success, answered.body);
  const classified = classify(
    answered.statusCode,
    (name) => {
      const value = answered.headers[name];
      return typeof value === "string" ? value : undefined;
    },
    body,
  );
  assert.equal(classified.outcome, outcome, answered.body);
  if (code !== undefined)
    assert.equal("code" in classified ? classified.code : undefined, code);
}

test("a grant sent as the API's media type is read, and a removal is served", async () => {
  const { memory, app } = await served();
  const granted = await app.inject({
    method: "POST",
    url: pathOf("tenantRoleGrant"),
    headers: { ...as("alice-token"), ...typed },
    payload: JSON.stringify({ role: "Member" }),
  });
  assert.equal(granted.statusCode, 204, granted.body);
  const removed = await app.inject({
    method: "DELETE",
    url: pathOf("tenantRoleRemoval"),
    headers: as("alice-token"),
  });
  assert.equal(removed.statusCode, 204, removed.body);
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [verb, grant.relation]),
    [
      ["write", "members"],
      ["remove", "members"],
    ],
  );
});

test("a list reads as its schema, the caller marked by the server", async () => {
  const { app } = await served();
  const tenantPeople = accessTenantPeopleSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: pathOf("tenantPeople"),
        headers: as("alice-token"),
      })
    ).json(),
  );
  assert.deepEqual(
    tenantPeople.people.map((person) => [person.subject, person.mine]),
    [
      ["alice", true],
      ["priya", false],
    ],
  );
  const projectPeople = accessProjectPeopleSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: pathOf("projectPeople"),
        headers: as("priya-token"),
      })
    ).json(),
  );
  assert.deepEqual(
    projectPeople.people.map((person) => [person.subject, person.mine]),
    [
      ["alice", false],
      ["priya", true],
    ],
  );
});

test("every refusal carries the API's envelope: unauthenticated, absent, rejected and the conflict by its own name", async () => {
  const { app } = await served();
  const missing = await app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
  });
  enveloped(missing, "Unauthenticated");
  assert.equal(missing.headers["www-authenticate"], "Bearer");
  const forged = await app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
    headers: as("forged"),
  });
  enveloped(forged, "Unauthenticated");
  enveloped(
    await app.inject({
      method: "GET",
      url: pathOf("tenantPeople"),
      headers: as("priya-token"),
    }),
    "Absent",
  );
  enveloped(
    await app.inject({
      method: "POST",
      url: pathOf("tenantRoleGrant"),
      headers: { ...as("alice-token"), ...typed },
      payload: JSON.stringify({ role: "Owner" }),
    }),
    "Rejected",
    "InvalidRequest",
  );
  enveloped(
    await app.inject({
      method: "POST",
      url: pathOf("tenantRoleGrant"),
      headers: { ...as("alice-token"), ...typed },
      payload: "{",
    }),
    "Rejected",
  );
  enveloped(
    await app.inject({
      method: "DELETE",
      url: pathOf("tenantRoleRemoval", "alice", "Admin"),
      headers: as("alice-token"),
    }),
    "Conflict",
    accessLastTenantAdministratorCode,
  );
  enveloped(
    await app.inject({ method: "GET", url: "/access/v1/nowhere" }),
    "Absent",
  );
});

test("a change refused a caller answered the list is forbidden under its own code, and nothing is written", async () => {
  const { memory, app } = await served();
  const listed = await app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
    headers: as("mo-token"),
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const granted = await app.inject({
    method: "POST",
    url: pathOf("tenantRoleGrant"),
    headers: { ...as("mo-token"), ...typed },
    payload: JSON.stringify({ role: "Member" }),
  });
  assert.equal(granted.statusCode, 403, granted.body);
  enveloped(granted, "Rejected", accessNotPermittedCode);
  enveloped(
    await app.inject({
      method: "DELETE",
      url: pathOf("projectRoleRemoval", "priya", "Admin"),
      headers: as("dee-token"),
    }),
    "Rejected",
    accessNotPermittedCode,
  );
  assert.deepEqual(memory.changes, []);
});

test("an authority that cannot answer is retryable on every route and unready on readiness", async () => {
  const { memory, app } = await served();
  memory.unavailable = true;
  for (const name of Object.keys(accessPlaneRoutes) as AccessPlaneRouteName[]) {
    const route = accessPlaneRoutes[name];
    const body =
      name === "tenantInvitation"
        ? { github: "octo-cat", email: "octo@example.com", role: "Admin" }
        : { role: "Admin" };
    const answered = await app.inject({
      method: route.method,
      url: pathOf(name, "zed", "Admin"),
      headers: {
        ...as("alice-token"),
        ...(route.method === "POST" ? typed : {}),
      },
      ...(route.method === "POST" ? { payload: JSON.stringify(body) } : {}),
    });
    enveloped(answered, "Retryable", "AuthorityUnavailable");
    assert.equal(answered.headers["retry-after"], "1", name);
  }
  assert.equal(
    (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    503,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    200,
  );
});

test("a subject in the path is carried whole, granted at the principal's bound and rejected past it", async () => {
  const { memory, app } = await served();
  const grant = (subject: string) =>
    app.inject({
      method: "POST",
      url: pathOf("projectRoleGrant", subject),
      headers: { ...as("priya-token"), ...typed },
      payload: JSON.stringify({ role: "Developer" }),
    });
  assert.equal((await grant("a/b:c?d")).statusCode, 204);
  const [, written] = memory.changes[0] ?? [];
  assert.deepEqual(written?.holder, {
    subject: "Principal",
    principal: accessFixturePrincipal("a/b:c?d"),
  });
  const prefix = `${String(accessFixtureIssuer.length)}:${accessFixtureIssuer}`;
  const widest = "w".repeat(principalCharsMax - prefix.length);
  assert.equal((await grant(widest)).statusCode, 204);
  enveloped(await grant(`${widest}w`), "Rejected", "InvalidRequest");
});

/**
 * Every relation the model declares, spelled as a request could spell it: by
 * its own name, and by every role name, on every grant and removal route.
 */
function accessSpellings(): readonly string[] {
  return [
    ...new Set([
      ...allTenantGrantRelations,
      ...allProjectGrantRelations,
      projectTenantRelation,
      ...accessTenantRoles,
      ...accessProjectRoles,
    ]),
  ];
}

async function accessReached(
  memory: AccessMemory,
  app: Awaited<ReturnType<typeof served>>["app"],
) {
  for (const role of accessSpellings())
    for (const [grant, removal] of [
      ["tenantRoleGrant", "tenantRoleRemoval"],
      ["projectRoleGrant", "projectRoleRemoval"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: pathOf(grant),
        headers: { ...as("alice-token"), ...typed },
        payload: JSON.stringify({ role }),
      });
      await app.inject({
        method: "DELETE",
        url: pathOf(removal, "zed", role),
        headers: as("alice-token"),
      });
    }
  return new Set(
    memory.changes.map(
      ([verb, grant]) => `${verb} ${grant.namespace} ${grant.relation}`,
    ),
  );
}

test("no request reaches a relation but the ones the role rosters name", async () => {
  const { memory, app } = await served();
  const reached = await accessReached(memory, app);
  const expected = new Set(
    (["write", "remove"] as const).flatMap((verb) => [
      ...Object.values(accessTenantRoleRelations).map(
        (relation) => `${verb} Tenant ${relation}`,
      ),
      ...Object.values(accessProjectRoleRelations).map(
        (relation) => `${verb} Project ${relation}`,
      ),
    ]),
  );
  assert.deepEqual(reached, expected);
});

/** A server inviting against fresh doubles, and the doubles, so a case reads what each was asked. */
async function inviting(
  accounts: Parameters<typeof directoryMemory>[0] = [],
  answers: Parameters<typeof githubMemory>[0] = {
    "octo-cat": githubUser("990000001", "Octo-Cat"),
  },
) {
  const directory = directoryMemory(accounts);
  const github = githubMemory(answers);
  const { memory, app } = await served(
    true,
    (held) => accessMemoryInvitations(held, directory, github),
    directory.directory,
  );
  const invite = (body: unknown, token = "alice-token") =>
    app.inject({
      method: "POST",
      url: pathOf("tenantInvitation"),
      headers: { ...as(token), ...typed },
      payload: JSON.stringify(body),
    });
  return { memory, app, directory, github, invite };
}

const invitation = {
  github: "octo-cat",
  email: "octo@example.com",
  role: "Member",
  projects: [{ project: "web", roles: ["Developer"] }],
};

test("an invitation answers the subject created, then the same subject not created, and the lists then name the account", async () => {
  const { app, invite } = await inviting();
  const first = await invite(invitation);
  assert.equal(first.statusCode, 201, first.body);
  const created = accessInvitedSchema.parse(first.json());
  assert.equal(created.created, true);
  const again = await invite(invitation);
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual(accessInvitedSchema.parse(again.json()), {
    subject: created.subject,
    created: false,
  });
  const people = accessTenantPeopleSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: pathOf("tenantPeople"),
        headers: as("alice-token"),
      })
    ).json(),
  );
  const invited = people.people.find(
    (person) => person.subject === created.subject,
  );
  assert.deepEqual(
    [
      invited?.account,
      invited?.email,
      invited?.githubLogin,
      invited?.tenantRoles,
    ],
    [true, "octo@example.com", "Octo-Cat", ["Member"]],
  );
  assert.equal(
    people.people.find((person) => person.subject === "alice")?.account,
    false,
  );
});

test("an invitation outside its shape is rejected before GitHub or the directory is asked anything", async () => {
  const { directory, github, invite } = await inviting();
  const projects = Array.from(
    { length: accessInvitationProjectsMax + 1 },
    (_, index) => ({ project: `p${String(index)}`, roles: ["Admin"] }),
  );
  for (const body of [
    { ...invitation, github: ".." },
    { ...invitation, github: "-octo" },
    { ...invitation, github: "octo-" },
    { ...invitation, github: "o".repeat(accessGithubLoginCharsMax + 1) },
    { ...invitation, email: `${"e".repeat(accessEmailCharsMax)}@example.com` },
    { ...invitation, email: "not an address" },
    { ...invitation, role: "Owner" },
    { ...invitation, projects },
    {
      ...invitation,
      projects: [
        { project: "web", roles: ["Admin"] },
        { project: "web", roles: ["Developer"] },
      ],
    },
    { ...invitation, projects: [{ project: "web", roles: ["Owner"] }] },
  ])
    enveloped(await invite(body), "Rejected", "InvalidRequest");
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
});

test("each refusal of an invitation carries its own code in the API's envelope", async () => {
  const held = await inviting([
    {
      subject: "00000000-0000-4000-8000-000000000009",
      email: "octo@example.com",
    },
  ]);
  enveloped(
    await held.invite(invitation),
    "Conflict",
    accessInvitationCodes.EmailHeld,
  );
  enveloped(await held.invite(invitation, "priya-token"), "Absent");
  const refused = await held.invite(invitation, "mo-token");
  assert.equal(refused.statusCode, 403, refused.body);
  enveloped(refused, "Rejected", accessNotPermittedCode);
  const uncreated = await inviting();
  const accountless = await uncreated.invite(invitation, "dee-token");
  assert.equal(accountless.statusCode, 403, accountless.body);
  enveloped(accountless, "Rejected", accessInvitationCodes.AccountNotPermitted);
  assert.deepEqual(uncreated.directory.creations, []);
  enveloped(
    await held.invite({
      ...invitation,
      projects: [{ project: "loose", roles: ["Admin"] }],
    }),
    "Rejected",
    accessInvitationCodes.ProjectUnknown,
  );
  const kinds = await inviting([], {
    "octo-cat": { looked: "Unknown" },
    org: githubUser("1", "org", "Organization"),
    down: { looked: "Unavailable" },
  });
  enveloped(
    await kinds.invite(invitation),
    "Rejected",
    accessInvitationCodes.GithubAccountUnknown,
  );
  enveloped(
    await kinds.invite({ ...invitation, github: "org" }),
    "Rejected",
    accessInvitationCodes.GithubAccountNotUser,
  );
  const down = await kinds.invite({ ...invitation, github: "down" });
  enveloped(down, "Retryable", accessInvitationCodes.GithubUnavailable);
  assert.equal(down.headers["retry-after"], "1");
});

test("a directory that raced, refused the email or could not answer is each answered under its own code, and a list asking it too", async () => {
  const raced = await inviting();
  raced.directory.creationAnswer = "Conflict";
  enveloped(
    await raced.invite(invitation),
    "Retryable",
    accessInvitationCodes.DirectoryRaced,
  );
  raced.directory.creationAnswer = "EmailRefused";
  enveloped(
    await raced.invite(invitation),
    "Rejected",
    accessInvitationCodes.EmailRefused,
  );
  raced.directory.unavailable = true;
  enveloped(
    await raced.invite(invitation),
    "Retryable",
    accessInvitationCodes.DirectoryUnavailable,
  );
  await raced.memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "00000000-0000-4000-8000-000000000009",
      tenant,
      relation: "members",
    }),
  );
  const people = await raced.app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
    headers: as("alice-token"),
  });
  enveloped(people, "Retryable", accessInvitationCodes.DirectoryUnavailable);
});

test("a plane with no directory answers an invitation not configured and its lists without the directory's fields", async () => {
  const { app } = await served(true, (memory) =>
    accessMemoryInvitations(memory, undefined, undefined),
  );
  const answered = await app.inject({
    method: "POST",
    url: pathOf("tenantInvitation"),
    headers: { ...as("alice-token"), ...typed },
    payload: JSON.stringify(invitation),
  });
  enveloped(answered, "Absent");
  assert.equal(
    errorEnvelopeSchema.parse(answered.json()).error.code,
    accessInvitationCodes.NotConfigured,
  );
  const people = (
    await app.inject({
      method: "GET",
      url: pathOf("tenantPeople"),
      headers: as("alice-token"),
    })
  ).body;
  assert.ok(!people.includes('"account"'), people);
});

const marker = "MARKER-not-for-a-response";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A server whose invitation and lists run through the real directory and GitHub adapters, over doubles answering `kratos` and `forge` in order. */
async function remote(
  kratos: readonly (Response | Error)[],
  forge: readonly (Response | Error)[],
) {
  const directory = kratosAccessDirectory(
    checkedAccessDirectorySettings({ adminUrl: "http://kratos.invalid/" }),
    fixtureForge(kratos).requestFetch,
  );
  const github = githubUserLookup({ fetch: fixtureForge(forge).requestFetch });
  return served(
    true,
    (memory) =>
      accessInvitations(
        {
          access: memory.access,
          tuples: memory.reader,
          grants: memory.grants,
          directory,
          github,
        },
        { issuer: accessFixtureIssuer },
      ),
    directory,
  );
}

const remoteEmail = `${marker}@example.com`;

/** A person as GitHub answers one, with a marker in a field the plane does not read. */
const remotePerson = () =>
  json({ id: 990000001, login: "Octo-Cat", type: "User", bio: marker });

/** An invitation of the person sent to `app` under an email carrying the marker. */
function remoteSent(app: Awaited<ReturnType<typeof served>>["app"]) {
  return app.inject({
    method: "POST",
    url: pathOf("tenantInvitation"),
    headers: { ...as("alice-token"), ...typed },
    payload: JSON.stringify({
      ...invitation,
      email: remoteEmail,
      projects: [],
    }),
  });
}

test("no remote text reaches a refusal: a directory refusal quoting the email, and a GitHub refusal with a message", async () => {
  const refused = await remote(
    [
      json([]),
      json([]),
      json(
        {
          error: { code: 400, reason: `"${remoteEmail}" is not valid "email"` },
        },
        400,
      ),
    ],
    [remotePerson()],
  );
  const refusal = await remoteSent(refused.app);
  enveloped(refusal, "Rejected", accessInvitationCodes.EmailRefused);
  assert.ok(!refusal.body.includes(marker), refusal.body);
  const github = await remote([], [json({ message: marker }, 403)]);
  const githubRefusal = await remoteSent(github.app);
  enveloped(
    githubRefusal,
    "Retryable",
    accessInvitationCodes.GithubUnavailable,
  );
  assert.ok(!githubRefusal.body.includes(marker), githubRefusal.body);
});

test("no remote text reaches an answer: a marker in a field neither the directory's nor GitHub's answer is read for", async () => {
  const subject = "5804d32a-77dc-4fd5-9ef6-8f102ea642b1";
  const listed = await remote(
    [
      json([]),
      json([]),
      json(
        { id: subject, traits: { email: "a@example.com" }, state: marker },
        201,
      ),
      json([
        {
          id: subject,
          traits: { email: "a@example.com" },
          metadata_admin: { github_login: "Octo-Cat", invited_by: marker },
          state: marker,
        },
      ]),
    ],
    [remotePerson()],
  );
  const created = await remoteSent(listed.app);
  assert.equal(created.statusCode, 201, created.body);
  assert.ok(!created.body.includes(marker), created.body);
  const people = await listed.app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
    headers: as("alice-token"),
  });
  assert.equal(people.statusCode, 200, people.body);
  assert.ok(people.body.includes("Octo-Cat"), people.body);
  assert.ok(!people.body.includes(marker), people.body);
});
