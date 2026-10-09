/**
 * The access plane's server over an authority held in memory: a body read as
 * the API's media type, a removal served, every refusal of a caller in the
 * API's envelope, what a caller may do and who holds each authority read as their
 * schemas, each change of a holder's outcome, and no request reaching a
 * relation but the ones the role rosters and the authority rosters name,
 * hosted runs, and the `site` link a site's invitation writes on a new tenant,
 * which the site's tenant list then reads back, and a tenant's invite links
 * made, listed, revoked and redeemed, each route's refusals among them, and
 * the directory's registration gate, which holds no bearer and is answered in
 * the directory's own shape.
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
  accessHolderNotAdmittedCode,
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessInvitedSchema,
  accessInviteLinkEndedCode,
  accessInviteLinkLimitReachedCode,
  accessInviteLinkMintedSchema,
  accessInviteLinkRedeemedSchema,
  accessInviteLinksNotConfiguredCode,
  accessInviteLinksOpenMax,
  accessInviteLinksSchema,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessOwnerInvitedSchema,
  accessPlanePath,
  accessPlaneRoutes,
  accessProjectAbilitiesSchema,
  accessProjectAuthoritiesSchema,
  accessProjectPeopleSchema,
  accessProjectRoles,
  accessRegistrationGateMessageId,
  accessRegistrationGatePath,
  accessSiteAbilitiesSchema,
  accessSiteAuthorities,
  accessSiteAuthoritiesSchema,
  accessSiteTenantsSchema,
  accessTenantAbilitiesSchema,
  accessTenantAuthoritiesSchema,
  accessTenantPeopleSchema,
  accessTenantRoles,
  accessTenantTakenCode,
  accessWorkspaceLinkNameWantedCode,
  accessWorkspaceLinkNoteCharsMax,
  accessWorkspaceLinksSchema,
  type AccessPlaneRouteName,
} from "../../src/contract/accessPlane.ts";
import {
  projectNameCharsMax,
  reservedTenantNames,
} from "../../src/contract/requests.ts";
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
import {
  accessProjectAuthorityRelations,
  accessSiteAuthorityRelations,
  accessTenantAuthorityRelations,
} from "../../src/interpreter/accessAuthorities.ts";
import { principalCharsMax } from "../../src/interpreter/principal.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import { projectAccessTenantObject } from "../../src/interpreter/projectAccess.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  tenantSiteRelation,
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
  accessOwnerInvitations,
  type AccessOwnerInvitations,
} from "../../src/interpreter/accessOwnerInvitation.ts";
import {
  accessMemoryClaims,
  accessMemoryInvitations,
  accessMemoryOwnerInvitations,
  directoryMemory,
  directorySubject,
  githubMemory,
  githubUser,
} from "../interpreter/accessInvitationFixture.ts";
import { fixtureForge } from "./forgeFixtures.ts";
import {
  accessMemoryInviteLinks,
  inviteLinkMemory,
} from "../interpreter/accessInviteLinkFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenProjectAdministrator,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryAbilities,
  accessMemoryAuthorities,
  accessMemoryHolders,
  accessMemoryPlane,
  accessMemorySiteTenants,
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
  "hal-token": "hal",
  "sam-token": "sam",
  "sita-token": "sita",
};

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const typed = { "content-type": nativeHttpMediaType };

/** What the invitations are composed with, over the authority a case serves. */
interface Invitations {
  readonly tenant: (memory: AccessMemory) => AccessInvitations;
  readonly owner: (memory: AccessMemory) => AccessOwnerInvitations;
}

/** The directory and GitHub a case invites against where it composes none of its own. */
const invitedDirectory = directoryMemory();
const invitedGithub = githubMemory({
  "octo-cat": githubUser("990000001", "Octo-Cat"),
});

/** Every kind `served` gives its people beside what the tuples give. */
function servedKinds(memory: AccessMemory): void {
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
  accessGiven(memory, accessFixturePrincipal("hal"), [
    { on: "Tenant", tenant, kind: "GrantHostedExecution" },
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
    { on: "Site", kind: "ManageSiteAuthorities" },
  ]);
  accessGiven(memory, accessFixturePrincipal("sita"), [
    { on: "Site", kind: "CreateTenant" },
    { on: "Site", kind: "CreateAccount" },
    { on: "Site", kind: "ManageSiteAuthorities" },
  ]);
}

/**
 * A tenant alice administers with one linked project priya administers, each
 * holding what the defaults give them and alice `CreateAccount`. Mo may only
 * manage who grants the tenant's roles, dee may grant `Member` and
 * `Developer` on the project and make no account, hal may give hosted runs
 * and manage the site's authorities and the ones the site holds over the
 * tenant, and sita may make a tenant and an account and manage the site's
 * authorities.
 */
async function served(
  ready = true,
  invitations: Invitations = {
    tenant: (memory) =>
      accessMemoryInvitations(memory, invitedDirectory, invitedGithub),
    owner: (memory) =>
      accessMemoryOwnerInvitations(memory, invitedDirectory, invitedGithub),
  },
  directory?: AccessDirectory,
  stored = true,
) {
  const memory = accessMemory();
  const links = stored ? inviteLinkMemory() : undefined;
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
  servedKinds(memory);
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
    invitations: invitations.tenant(memory),
    ownerInvitations: invitations.owner(memory),
    inviteLinks: accessMemoryInviteLinks(memory, links, directory),
    abilities: accessMemoryAbilities(memory),
    authorities: accessMemoryAuthorities(
      memory,
      accessPlaneBoundsDefault,
      directory,
    ),
    holders: accessMemoryHolders(memory),
    siteTenants: accessMemorySiteTenants(
      memory,
      accessPlaneBoundsDefault,
      directory,
    ),
    ready: () => Promise.resolve(ready && !memory.unavailable),
  });
  return { memory, app, links };
}

/** The path one route is asked at for `web`, its subject, role, authority, group and link where it names them. */
function pathOf(
  name: AccessPlaneRouteName,
  subject = "zed",
  role = "Member",
  authority = "AuthorityManagers",
  group = "TenantAdmins",
  link = "link",
) {
  return accessPlanePath(name, {
    ...web,
    subject,
    role,
    authority,
    group,
    link,
  });
}

/** A mint of a link granting `grants` in `web`'s tenant, sent with `token`. */
function linkMinted(
  app: Awaited<ReturnType<typeof served>>["app"],
  token: string,
  grants: unknown,
) {
  return app.inject({
    method: "POST",
    url: pathOf("tenantInviteLinkCreation"),
    headers: { ...as(token), ...typed },
    payload: JSON.stringify(grants),
  });
}

/** A site's invitation of octo-cat into a tenant of their own that may make accounts. */
const ownerInvitation = {
  tenant: "octo-works",
  github: "octo-cat",
  email: "octo@example.com",
  createAccounts: true,
};

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

test("every refusal of a caller carries the API's envelope: unauthenticated, absent, rejected and the conflict by its own name", async () => {
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

test("what a caller may do reads as its strict schema at each level, and is absent to a caller that level's list is not answered to", async () => {
  const { app } = await served();
  const get = (name: AccessPlaneRouteName, token?: string) =>
    app.inject({
      method: "GET",
      url: pathOf(name),
      ...(token === undefined ? {} : { headers: as(token) }),
    });
  const tenantAbilities = accessTenantAbilitiesSchema.parse(
    (await get("tenantAbilities", "alice-token")).json(),
  );
  assert.deepEqual(
    [tenantAbilities.roles, tenantAbilities.createAccount],
    [["Admin", "Member"], true],
  );
  assert.deepEqual(tenantAbilities.projects, [
    {
      project: "web",
      roles: ["Admin", "Developer", "Dispatcher", "Viewer"],
      manageAuthorities: true,
    },
  ]);
  assert.deepEqual(
    accessProjectAbilitiesSchema.parse(
      (await get("projectAbilities", "dee-token")).json(),
    ),
    { tenant, project: "web", roles: ["Developer"], manageAuthorities: false },
  );
  assert.deepEqual(
    accessSiteAbilitiesSchema.parse(
      (await get("siteAbilities", "alice-token")).json(),
    ),
    {
      administer: false,
      createAccount: true,
      createTenant: false,
      manageAuthorities: false,
    },
  );
  for (const [name, token] of [
    ["tenantAbilities", "priya-token"],
    ["projectAbilities", "mo-token"],
    ["siteAbilities", "priya-token"],
  ] as const) {
    const absent = await get(name, token);
    assert.equal(absent.statusCode, 404, name);
    enveloped(absent, "Absent");
    enveloped(await get(name), "Unauthenticated");
  }
});

test("who holds each authority reads as its strict schema at each level, and is absent to a caller managing nothing there", async () => {
  const { memory, app } = await served();
  await memory.grants.write({
    ...tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "dee",
      tenant,
      relation: "admins",
    }),
    relation: "member_granters",
  });
  const get = (name: AccessPlaneRouteName, token?: string) =>
    app.inject({
      method: "GET",
      url: pathOf(name),
      ...(token === undefined ? {} : { headers: as(token) }),
    });
  const answered = async (name: AccessPlaneRouteName, token: string) => {
    const reply = await get(name, token);
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json<unknown>();
  };
  const tenantList = accessTenantAuthoritiesSchema.parse(
    await answered("tenantAuthorities", "mo-token"),
  );
  assert.deepEqual(
    tenantList.authorities.find((held) => held.authority === "MemberGranters")
      ?.people,
    [{ subject: "dee", mine: false }],
  );
  assert.equal(
    accessProjectAuthoritiesSchema.parse(
      await answered("projectAuthorities", "priya-token"),
    ).project,
    "web",
  );
  assert.deepEqual(
    accessSiteAuthoritiesSchema
      .parse(await answered("siteAuthorities", "hal-token"))
      .authorities.map((held) => held.authority),
    accessSiteAuthorities,
  );
  for (const name of [
    "tenantAuthorities",
    "projectAuthorities",
    "siteAuthorities",
  ] as const) {
    const absent = await get(name, "dee-token");
    assert.equal(absent.statusCode, 404, name);
    enveloped(absent, "Absent");
    const unauthenticated = await get(name);
    assert.equal(unauthenticated.statusCode, 401, name);
    enveloped(unauthenticated, "Unauthenticated");
  }
});

test("hosted runs are given and taken by a holder of `GrantHostedExecution`, forbidden to an administrator who is not one, and absent to a caller not answered the list", async () => {
  const { memory, app } = await served();
  const changed = (
    name: "tenantHostedRunsGrant" | "tenantHostedRunsRemoval",
    token: string,
  ) =>
    app.inject({
      method: accessPlaneRoutes[name].method,
      url: pathOf(name),
      headers: as(token),
    });
  const hosted = async () =>
    accessTenantPeopleSchema
      .parse(
        (
          await app.inject({
            method: "GET",
            url: pathOf("tenantPeople"),
            headers: as("alice-token"),
          })
        ).json(),
      )
      .people.some((person) => person.subject === "zed" && person.hostedRuns);
  assert.equal(
    (await changed("tenantHostedRunsGrant", "hal-token")).statusCode,
    204,
  );
  assert.equal(await hosted(), true);
  assert.equal(
    (await changed("tenantHostedRunsRemoval", "hal-token")).statusCode,
    204,
  );
  assert.equal(await hosted(), false);
  memory.changes.length = 0;
  for (const name of [
    "tenantHostedRunsGrant",
    "tenantHostedRunsRemoval",
  ] as const) {
    const refused = await changed(name, "alice-token");
    assert.equal(refused.statusCode, 403, refused.body);
    enveloped(refused, "Rejected", accessNotPermittedCode);
    enveloped(await changed(name, "priya-token"), "Absent");
  }
  assert.deepEqual(memory.changes, []);
});

/** One change of a holder sent to `app` by the bearer of `token`, naming `authority` and `group` where its path does. */
function holderChange(
  app: Awaited<ReturnType<typeof served>>["app"],
  name: AccessPlaneRouteName,
  token: string | undefined,
  authority = "MemberGranters",
  group = "TenantMembers",
) {
  return app.inject({
    method: accessPlaneRoutes[name].method,
    url: pathOf(name, "zed", "Member", authority, group),
    ...(token === undefined ? {} : { headers: as(token) }),
  });
}

test("a holder is added and removed at each level by a caller managing the authority, and the change written is the one the path names", async () => {
  const { memory, app } = await served();
  for (const [name, token, authority] of [
    ["tenantAuthorityPersonAddition", "alice-token", "MemberGranters"],
    ["tenantAuthorityGroupAddition", "alice-token", "MemberGranters"],
    ["tenantAuthorityGroupRemoval", "alice-token", "MemberGranters"],
    ["tenantAuthorityPersonRemoval", "alice-token", "MemberGranters"],
    ["projectAuthorityGroupAddition", "priya-token", "AdminGranters"],
    ["projectAuthorityPersonRemoval", "priya-token", "AdminGranters"],
    ["siteAuthorityPersonAddition", "hal-token", "AuthorityManagers"],
    ["siteAuthorityGroupRemoval", "hal-token", "AccountCreators"],
  ] as const) {
    const changed = await holderChange(
      app,
      name,
      token,
      authority,
      name.startsWith("project")
        ? "ProjectAdmins"
        : name.startsWith("site")
          ? "SiteAdmins"
          : "TenantMembers",
    );
    assert.equal(changed.statusCode, 204, `${name} ${changed.body}`);
  }
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [
      verb,
      grant.namespace,
      grant.relation,
      grant.holder.subject,
    ]),
    [
      ["write", "Tenant", "member_granters", "Principal"],
      ["write", "Tenant", "member_granters", "Holders"],
      ["remove", "Tenant", "member_granters", "Holders"],
      ["remove", "Tenant", "member_granters", "Principal"],
      ["write", "Project", "admin_granters", "Holders"],
      ["remove", "Project", "admin_granters", "Principal"],
      ["write", "Site", "authority_managers", "Principal"],
      ["remove", "Site", "account_creators", "Holders"],
    ],
  );
});

test("a change of a holder is absent, forbidden, a conflict under its own code or rejected, and none of them writes", async () => {
  const { memory, app } = await served();
  for (const name of [
    "tenantAuthorityPersonAddition",
    "projectAuthorityGroupRemoval",
    "siteAuthorityPersonAddition",
  ] as const) {
    const absent = await holderChange(
      app,
      name,
      "dee-token",
      "AuthorityManagers",
      "ProjectAdmins",
    );
    assert.equal(absent.statusCode, 404, name);
    enveloped(absent, "Absent");
    const unauthenticated = await holderChange(app, name, undefined);
    assert.equal(unauthenticated.statusCode, 401, name);
  }
  for (const [token, authority] of [
    ["alice-token", "HostedRunsGranters"],
    ["hal-token", "AdminGranters"],
  ] as const) {
    const refused = await holderChange(
      app,
      "tenantAuthorityGroupAddition",
      token,
      authority,
    );
    assert.equal(refused.statusCode, 403, refused.body);
    enveloped(refused, "Rejected", accessNotPermittedCode);
  }
  for (const [name, token, authority, group] of [
    [
      "tenantAuthorityGroupAddition",
      "alice-token",
      "AdminGranters",
      "TenantMembers",
    ],
    [
      "siteAuthorityGroupAddition",
      "hal-token",
      "AccountCreators",
      "TenantAdmins",
    ],
    [
      "tenantAuthorityGroupRemoval",
      "alice-token",
      "AdminGranters",
      "ProjectAdmins",
    ],
  ] as const) {
    const conflict = await holderChange(app, name, token, authority, group);
    assert.equal(conflict.statusCode, 409, conflict.body);
    enveloped(conflict, "Conflict", accessHolderNotAdmittedCode);
  }
  for (const [name, authority, group] of [
    ["tenantAuthorityPersonAddition", "Owners", "TenantMembers"],
    ["siteAuthorityPersonAddition", "AdminGranters", "TenantMembers"],
    ["projectAuthorityGroupAddition", "AdminGranters", "Everyone"],
  ] as const)
    enveloped(
      await holderChange(app, name, "alice-token", authority, group),
      "Rejected",
      "InvalidRequest",
    );
  assert.deepEqual(memory.changes, []);
});

test("a tenant's administrators are added to the site's account creators once the tenant carries its site link, and removed", async () => {
  const { memory, app } = await served();
  const unlinked = await holderChange(
    app,
    "siteAuthorityTenantAddition",
    "hal-token",
  );
  assert.equal(unlinked.statusCode, 404, unlinked.body);
  enveloped(
    await holderChange(app, "siteAuthorityTenantAddition", "alice-token"),
    "Absent",
  );
  assert.equal(memory.changes.length, 0);
  for (const grant of tenantAuthorityDefaults(tenant))
    await memory.grants.write(grant);
  memory.changes.length = 0;
  for (const name of [
    "siteAuthorityTenantAddition",
    "siteAuthorityTenantRemoval",
  ] as const)
    assert.equal(
      (await holderChange(app, name, "hal-token")).statusCode,
      204,
      name,
    );
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [verb, grant.relation, grant.holder]),
    (["write", "remove"] as const).map((verb) => [
      verb,
      "account_creators",
      {
        subject: "Holders",
        namespace: "Tenant",
        object: projectAccessTenantObject(tenant),
        relation: "admins",
      },
    ]),
  );
});

test("an authority that cannot answer is retryable on every route and unready on readiness", async () => {
  const { memory, app } = await served();
  const open = accessInviteLinkMintedSchema.parse(
    (await linkMinted(app, "alice-token", { role: "Member" })).json(),
  );
  memory.unavailable = true;
  for (const name of Object.keys(accessPlaneRoutes) as AccessPlaneRouteName[]) {
    const route = accessPlaneRoutes[name];
    const person = { github: "octo-cat", email: "octo@example.com" };
    const body =
      name === "tenantInvitation"
        ? { ...person, role: "Admin" }
        : name === "siteOwnerInvitation"
          ? { ...person, tenant: "octo-works", createAccounts: true }
          : name === "inviteLinkRedemption"
            ? { token: open.token }
            : name === "siteWorkspaceLinkCreation"
              ? { createAccounts: true, note: "for octo-cat" }
              : { role: "Admin" };
    const answered = await app.inject({
      method: route.method,
      url: pathOf(name, "zed", "Admin", undefined, undefined, open.link),
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
  for (const [method, name] of [
    ["POST", "tenantHostedRunsGrant"],
    ["DELETE", "tenantHostedRunsRemoval"],
  ] as const)
    await app.inject({ method, url: pathOf(name), headers: as("hal-token") });
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

/** Every holder route asked by a caller managing everything, its authority spelled every way a role is and as every authority and relation. */
async function accessHoldersReached(
  memory: AccessMemory,
  app: Awaited<ReturnType<typeof served>>["app"],
) {
  const spellings = [
    ...new Set([
      ...accessSpellings(),
      ...Object.entries({
        ...accessSiteAuthorityRelations,
        ...accessTenantAuthorityRelations,
        ...accessProjectAuthorityRelations,
      }).flat(),
    ]),
  ];
  for (const name of Object.keys(accessPlaneRoutes) as AccessPlaneRouteName[])
    if (name.includes("Authority") && accessPlaneRoutes[name].method !== "GET")
      for (const authority of spellings)
        await holderChange(app, name, "sam-token", authority, "TenantAdmins");
  return new Set(
    memory.changes.map(
      ([verb, grant]) => `${verb} ${grant.namespace} ${grant.relation}`,
    ),
  );
}

test("no request reaches a relation but the ones the role rosters and the authority rosters name, hosted runs, and the site link a site's invitation writes", async () => {
  const { memory, app } = await served();
  for (const grant of tenantAuthorityDefaults(tenant))
    await memory.grants.write(grant);
  memory.changes.length = 0;
  accessGiven(memory, accessFixturePrincipal("sam"), [
    { on: "Site", kind: "ManageSiteAuthorities" },
    { on: "Tenant", tenant, kind: "ManageTenantAuthorities" },
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
    { on: "Project", partition: web, kind: "ManageProjectAuthorities" },
  ]);
  const owned = await app.inject({
    method: "POST",
    url: pathOf("siteOwnerInvitation"),
    headers: { ...as("sita-token"), ...typed },
    payload: JSON.stringify(ownerInvitation),
  });
  assert.equal(owned.statusCode, 201, owned.body);
  const reached = new Set([
    ...(await accessReached(memory, app)),
    ...(await accessHoldersReached(memory, app)),
  ]);
  const expected = new Set(
    (["write", "remove"] as const).flatMap((verb) => [
      ...(verb === "write" ? [`write Tenant ${tenantSiteRelation}`] : []),
      `${verb} Tenant hosted_execution`,
      ...Object.values(accessTenantRoleRelations).map(
        (relation) => `${verb} Tenant ${relation}`,
      ),
      ...Object.values(accessProjectRoleRelations).map(
        (relation) => `${verb} Project ${relation}`,
      ),
      ...Object.values(accessSiteAuthorityRelations).map(
        (relation) => `${verb} Site ${relation}`,
      ),
      ...Object.values(accessTenantAuthorityRelations).map(
        (relation) => `${verb} Tenant ${relation}`,
      ),
      ...Object.values(accessProjectAuthorityRelations).map(
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
    {
      tenant: (held) => accessMemoryInvitations(held, directory, github),
      owner: (held) => accessMemoryOwnerInvitations(held, directory, github),
    },
    directory.directory,
  );
  const sent =
    (route: "tenantInvitation" | "siteOwnerInvitation") =>
    (body: unknown, token = "alice-token") =>
      app.inject({
        method: "POST",
        url: pathOf(route),
        headers: { ...as(token), ...typed },
        payload: JSON.stringify(body),
      });
  return {
    memory,
    app,
    directory,
    github,
    invite: sent("tenantInvitation"),
    own: sent("siteOwnerInvitation"),
  };
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
  const { app } = await served(true, {
    tenant: (memory) => accessMemoryInvitations(memory, undefined, undefined),
    owner: (memory) =>
      accessMemoryOwnerInvitations(memory, undefined, undefined),
  });
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
    {
      tenant: (memory) =>
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
      owner: (memory) =>
        accessOwnerInvitations(
          {
            access: memory.access,
            claims: accessMemoryClaims(memory),
            grants: memory.grants,
            directory,
            github,
          },
          { issuer: accessFixtureIssuer },
        ),
    },
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

test("a site's invitation answers the tenant and the subject created, then the same subject not created", async () => {
  const { memory, own } = await inviting();
  const first = await own(ownerInvitation, "sita-token");
  assert.equal(first.statusCode, 201, first.body);
  const created = accessOwnerInvitedSchema.parse(first.json());
  assert.deepEqual(created, {
    tenant: "octo-works",
    subject: created.subject,
    created: true,
  });
  const written = memory.changes.length;
  const again = await own(ownerInvitation, "sita-token");
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual(accessOwnerInvitedSchema.parse(again.json()), {
    ...created,
    created: false,
  });
  assert.equal(memory.changes.length, 2 * written);
});

test("the site's tenants read as their strict schema to a caller who may make one, the invited tenant among them, and are absent to anyone else", async () => {
  const { app, own } = await inviting();
  const invited = accessOwnerInvitedSchema.parse(
    (await own(ownerInvitation, "sita-token")).json(),
  );
  const get = (token?: string) =>
    app.inject({
      method: "GET",
      url: pathOf("siteTenants"),
      ...(token === undefined ? {} : { headers: as(token) }),
    });
  const listed = await get("sita-token");
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(
    accessSiteTenantsSchema
      .parse(listed.json())
      .tenants.map((one) => [
        one.tenant,
        one.administrators.map((person) => person.subject),
        one.createAccounts,
      ]),
    [
      [tenant, ["alice"], false],
      [invited.tenant, [invited.subject], true],
    ],
  );
  for (const token of ["alice-token", "hal-token"]) {
    const absent = await get(token);
    assert.equal(absent.statusCode, 404, token);
    enveloped(absent, "Absent");
  }
  const unauthenticated = await get();
  assert.equal(unauthenticated.statusCode, 401);
  enveloped(unauthenticated, "Unauthenticated");
});

test("a site's invitation naming a tenant outside its shape, past its bound or reserved is rejected before GitHub, the directory or the authority is asked anything", async () => {
  const { memory, directory, github, own } = await inviting();
  memory.asked.length = 0;
  for (const tenant of [
    "Octo",
    "octo-",
    "acme/co",
    "o".repeat(projectNameCharsMax + 1),
    ...reservedTenantNames,
  ])
    enveloped(
      await own({ ...ownerInvitation, tenant }, "sita-token"),
      "Rejected",
      "InvalidRequest",
    );
  enveloped(
    await own({ ...ownerInvitation, createAccounts: "yes" }, "sita-token"),
    "Rejected",
    "InvalidRequest",
  );
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
  assert.deepEqual(memory.asked, []);
});

test("a site's invitation is absent without `CreateTenant`, forbidden without the kind a power it uses needs, and a conflict under its own code where the tenant is taken", async () => {
  const absent = await inviting();
  enveloped(await absent.own(ownerInvitation, "alice-token"), "Absent");
  assert.deepEqual(absent.github.looked, []);
  assert.deepEqual(absent.directory.asked, []);

  const powers = await inviting();
  accessGiven(powers.memory, accessFixturePrincipal("mo"), [
    { on: "Site", kind: "CreateTenant" },
  ]);
  const accountless = await powers.own(
    { ...ownerInvitation, createAccounts: false },
    "mo-token",
  );
  assert.equal(accountless.statusCode, 403, accountless.body);
  enveloped(accountless, "Rejected", accessInvitationCodes.AccountNotPermitted);
  accessGiven(powers.memory, accessFixturePrincipal("mo"), [
    { on: "Site", kind: "CreateAccount" },
  ]);
  const unmanaging = await powers.own(ownerInvitation, "mo-token");
  assert.equal(unmanaging.statusCode, 403, unmanaging.body);
  enveloped(unmanaging, "Rejected", accessNotPermittedCode);
  assert.deepEqual(powers.directory.creations, []);
  assert.deepEqual(powers.memory.changes, []);

  const taken = await inviting();
  await taken.memory.grants.write(
    projectTenantGrant(accessFixturePartition("taken", "web")),
  );
  taken.memory.changes.length = 0;
  enveloped(
    await taken.own({ ...ownerInvitation, tenant: "taken" }, "sita-token"),
    "Conflict",
    accessTenantTakenCode,
  );
  assert.deepEqual(taken.memory.changes, []);
});

test("every refusal GitHub or the directory gives a site's invitation has the tenant invitation's status and code, and writes nothing", async () => {
  const unavailable = { looked: "Unavailable" } as const;
  const scenarios: readonly (readonly [
    Parameters<typeof inviting>,
    (directory: ReturnType<typeof directoryMemory>) => void,
  ])[] = [
    [[[], {}], () => undefined],
    [
      [[], { "octo-cat": githubUser("1", "org", "Organization") }],
      () => undefined,
    ],
    [[[], { "octo-cat": unavailable }], () => undefined],
    [
      [[{ subject: directorySubject(9), email: "octo@example.com" }]],
      () => undefined,
    ],
    [[], (directory) => (directory.creationAnswer = "EmailRefused")],
    [[], (directory) => (directory.creationAnswer = "Conflict")],
    [[], (directory) => (directory.unavailable = true)],
  ];
  for (const [arguments_, prepared] of scenarios) {
    const { memory, directory, invite, own } = await inviting(...arguments_);
    prepared(directory);
    const tenantAnswered = await invite(invitation);
    const ownerAnswered = await own(ownerInvitation, "sita-token");
    assert.ok(tenantAnswered.statusCode >= 400, tenantAnswered.body);
    assert.equal(ownerAnswered.statusCode, tenantAnswered.statusCode);
    assert.equal(
      errorEnvelopeSchema.parse(ownerAnswered.json()).error.code,
      errorEnvelopeSchema.parse(tenantAnswered.json()).error.code,
    );
    assert.deepEqual(memory.changes, []);
  }
});

test("a plane with no directory answers a site's invitation not configured", async () => {
  const { app } = await served(true, {
    tenant: (memory) => accessMemoryInvitations(memory, undefined, undefined),
    owner: (memory) =>
      accessMemoryOwnerInvitations(memory, undefined, undefined),
  });
  const answered = await app.inject({
    method: "POST",
    url: pathOf("siteOwnerInvitation"),
    headers: { ...as("sita-token"), ...typed },
    payload: JSON.stringify(ownerInvitation),
  });
  enveloped(answered, "Absent");
  assert.equal(
    errorEnvelopeSchema.parse(answered.json()).error.code,
    accessInvitationCodes.NotConfigured,
  );
});

test("no remote text reaches a site's invitation: neither a refusal GitHub or the directory wrote nor a field of an account created", async () => {
  const sentTo = (app: Awaited<ReturnType<typeof served>>["app"]) =>
    app.inject({
      method: "POST",
      url: pathOf("siteOwnerInvitation"),
      headers: { ...as("sita-token"), ...typed },
      payload: JSON.stringify({ ...ownerInvitation, email: remoteEmail }),
    });
  const subject = "5804d32a-77dc-4fd5-9ef6-8f102ea642b1";
  for (const [kratos, forge, status] of [
    [
      [
        json([]),
        json([]),
        json({ error: { reason: `"${remoteEmail}"` } }, 400),
      ],
      [remotePerson()],
      422,
    ],
    [[], [json({ message: marker }, 403)], 503],
    [
      [json([]), json([]), json({ id: subject, state: marker }, 201)],
      [remotePerson()],
      201,
    ],
  ] as const) {
    const answered = await sentTo((await remote(kratos, forge)).app);
    assert.equal(answered.statusCode, status, answered.body);
    assert.ok(!answered.body.includes(marker), answered.body);
  }
});

test("a link is made 201 with its id, token, expiry and `newAccounts`, listed 200 without its token, revoked 204, and then a conflict", async () => {
  const { app } = await served();
  const made = await linkMinted(app, "alice-token", {
    role: "Member",
    projects: [{ project: "web", roles: ["Developer"] }],
  });
  assert.equal(made.statusCode, 201, made.body);
  const minted = accessInviteLinkMintedSchema.parse(made.json());
  assert.deepEqual(Object.keys(minted).sort(), [
    "expiresAtMs",
    "link",
    "newAccounts",
    "token",
  ]);
  assert.equal(minted.newAccounts, true);
  const list = () =>
    app.inject({
      method: "GET",
      url: pathOf("tenantInviteLinks"),
      headers: as("alice-token"),
    });
  const listed = await list();
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(
    accessInviteLinksSchema
      .parse(listed.json())
      .links.map((one) => [one.link, one.state]),
    [[minted.link, "Open"]],
  );
  assert.ok(!listed.body.includes(minted.token), listed.body);
  const revoke = (token: string, link = minted.link) =>
    app.inject({
      method: "DELETE",
      url: pathOf("tenantInviteLinkRevocation", "zed", "Member", "", "", link),
      headers: as(token),
    });
  enveloped(await revoke("sam-token"), "Absent");
  assert.equal((await revoke("alice-token")).statusCode, 204);
  enveloped(await revoke("alice-token"), "Conflict", accessInviteLinkEndedCode);
  enveloped(await revoke("alice-token", "no/such link?"), "Absent");
  assert.equal(
    accessInviteLinksSchema.parse((await list()).json()).links[0]?.state,
    "Revoked",
  );
});

test("a mint is absent, refused under the plane's code, a project unknown under the invitation's, rejected or a conflict at the tenant's bound, and only a mint stores anything", async () => {
  const { app, links } = await served();
  enveloped(await linkMinted(app, "sam-token", { role: "Member" }), "Absent");
  enveloped(
    await linkMinted(app, "dee-token", {
      role: "Member",
      projects: [{ project: "web", roles: ["Dispatcher"] }],
    }),
    "Rejected",
    accessNotPermittedCode,
  );
  enveloped(
    await linkMinted(app, "alice-token", {
      role: "Member",
      projects: [{ project: "elsewhere", roles: ["Viewer"] }],
    }),
    "Rejected",
    accessInvitationCodes.ProjectUnknown,
  );
  enveloped(
    await linkMinted(app, "alice-token", {
      role: "Member",
      github: "octo-cat",
    }),
    "Rejected",
    "InvalidRequest",
  );
  assert.deepEqual(links?.rows, []);
  const dee = await linkMinted(app, "dee-token", { role: "Member" });
  assert.equal(
    accessInviteLinkMintedSchema.parse(dee.json()).newAccounts,
    false,
  );
  for (let minted = 1; minted < accessInviteLinksOpenMax; minted += 1)
    assert.equal(
      (await linkMinted(app, "alice-token", { role: "Member" })).statusCode,
      201,
    );
  enveloped(
    await linkMinted(app, "alice-token", { role: "Member" }),
    "Conflict",
    accessInviteLinkLimitReachedCode,
  );
  assert.equal(links?.rows.length, accessInviteLinksOpenMax);
});

test("a redemption answers what it granted to the caller, and the same again to them once spent writing nothing, is unauthenticated without a bearer, and is absent once spent to another caller or for a token nobody holds", async () => {
  const { memory, app } = await served();
  const minted = accessInviteLinkMintedSchema.parse(
    (
      await linkMinted(app, "alice-token", {
        role: "Member",
        projects: [{ project: "web", roles: ["Viewer"] }],
      })
    ).json(),
  );
  const redeem = (headers: Record<string, string>, token = minted.token) =>
    app.inject({
      method: "POST",
      url: pathOf("inviteLinkRedemption"),
      headers: { ...headers, ...typed },
      payload: JSON.stringify({ token }),
    });
  enveloped(await redeem({}), "Unauthenticated");
  enveloped(await redeem(as("sam-token"), "t".repeat(4_096)), "Rejected");
  const redeemed = await redeem(as("sam-token"));
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  assert.deepEqual(accessInviteLinkRedeemedSchema.parse(redeemed.json()), {
    tenant,
    role: "Member",
    projects: [{ project: "web", roles: ["Viewer"] }],
  });
  assert.deepEqual(
    memory.batches.flat().map((grant) => grant.holder),
    [
      { subject: "Principal", principal: accessFixturePrincipal("sam") },
      { subject: "Principal", principal: accessFixturePrincipal("sam") },
    ],
  );
  const again = await redeem(as("sam-token"));
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.body, redeemed.body);
  assert.equal(memory.batches.length, 1);
  enveloped(await redeem(as("dee-token")), "Absent");
  enveloped(await redeem(as("dee-token"), "token-nobody-holds"), "Absent");
});

test("a plane with no store answers every link route not configured, while an invitation and a people list still answer", async () => {
  const { memory, app } = await served(true, undefined, undefined, false);
  for (const name of [
    "tenantInviteLinkCreation",
    "tenantInviteLinks",
    "tenantInviteLinkRevocation",
    "siteWorkspaceLinkCreation",
    "siteWorkspaceLinks",
    "siteWorkspaceLinkRevocation",
    "inviteLinkRedemption",
  ] as const) {
    const route = accessPlaneRoutes[name];
    const answered = await app.inject({
      method: route.method,
      url: pathOf(name),
      headers: {
        ...as("alice-token"),
        ...(route.method === "POST" ? typed : {}),
      },
      ...(route.method === "POST"
        ? {
            payload: JSON.stringify(
              name === "inviteLinkRedemption"
                ? { token: "token-0", workspace: "alice-works" }
                : name === "siteWorkspaceLinkCreation"
                  ? { createAccounts: false }
                  : { role: "Member" },
            ),
          }
        : {}),
    });
    enveloped(answered, "Absent");
    assert.equal(
      errorEnvelopeSchema.parse(answered.json()).error.code,
      accessInviteLinksNotConfiguredCode,
      name,
    );
  }
  assert.deepEqual(memory.asked, []);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: pathOf("tenantPeople"),
        headers: as("alice-token"),
      })
    ).statusCode,
    200,
  );
  const invited = await app.inject({
    method: "POST",
    url: pathOf("tenantInvitation"),
    headers: { ...as("alice-token"), ...typed },
    payload: JSON.stringify(invitation),
  });
  assert.ok([200, 201].includes(invited.statusCode), invited.body);
});

/** A mint of a workspace link sent `body` with `token`. */
function workspaceLinkMinted(
  app: Awaited<ReturnType<typeof served>>["app"],
  token: string,
  body: unknown,
) {
  return app.inject({
    method: "POST",
    url: pathOf("siteWorkspaceLinkCreation"),
    headers: { ...as(token), ...typed },
    payload: JSON.stringify(body),
  });
}

/** A redemption sent `body` with `token`, or with no bearer where `token` is undefined. */
function redemption(
  app: Awaited<ReturnType<typeof served>>["app"],
  token: string | undefined,
  body: unknown,
) {
  return app.inject({
    method: "POST",
    url: pathOf("inviteLinkRedemption"),
    headers: { ...(token === undefined ? {} : as(token)), ...typed },
    payload: JSON.stringify(body),
  });
}

const workspaceNote = "for Octo Cat, handed over at the meetup";

test("a workspace link is made 201 with its id, token, expiry and `newAccounts`, listed 200 with its note and without its token, revoked 204, and then a conflict", async () => {
  const { app } = await served();
  const made = await workspaceLinkMinted(app, "sita-token", {
    createAccounts: true,
    note: workspaceNote,
  });
  assert.equal(made.statusCode, 201, made.body);
  const minted = accessInviteLinkMintedSchema.parse(made.json());
  assert.deepEqual(Object.keys(minted).sort(), [
    "expiresAtMs",
    "link",
    "newAccounts",
    "token",
  ]);
  assert.equal(minted.newAccounts, true);
  const list = (token = "sita-token") =>
    app.inject({
      method: "GET",
      url: pathOf("siteWorkspaceLinks"),
      headers: as(token),
    });
  const listed = await list();
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(
    accessWorkspaceLinksSchema
      .parse(listed.json())
      .links.map((one) => [one.link, one.state, one.note, one.createAccounts]),
    [[minted.link, "Open", workspaceNote, true]],
  );
  assert.ok(!listed.body.includes(minted.token), listed.body);
  const revoke = (token: string, link = minted.link) =>
    app.inject({
      method: "DELETE",
      url: pathOf("siteWorkspaceLinkRevocation", "", "", "", "", link),
      headers: as(token),
    });
  assert.equal((await revoke("sita-token")).statusCode, 204);
  enveloped(await revoke("sita-token"), "Conflict", accessInviteLinkEndedCode);
  enveloped(await revoke("sita-token", "no/such link?"), "Absent");
  assert.equal(
    accessWorkspaceLinksSchema.parse((await list()).json()).links[0]?.state,
    "Revoked",
  );
});

test("each workspace link route is unauthenticated without a bearer, absent without `CreateTenant`, and forbidden `createAccounts` without `ManageSiteAuthorities`, and only a mint stores anything", async () => {
  const { app, links, memory } = await served();
  const minted = accessInviteLinkMintedSchema.parse(
    (
      await workspaceLinkMinted(app, "sita-token", { createAccounts: true })
    ).json(),
  );
  const routes = [
    ["siteWorkspaceLinkCreation", { createAccounts: false }],
    ["siteWorkspaceLinks", undefined],
    ["siteWorkspaceLinkRevocation", undefined],
  ] as const;
  for (const [token, outcome] of [
    [undefined, "Unauthenticated"],
    ["alice-token", "Absent"],
    ["hal-token", "Absent"],
  ] as const)
    for (const [name, body] of routes)
      enveloped(
        await app.inject({
          method: accessPlaneRoutes[name].method,
          url: pathOf(name, "", "", "", "", minted.link),
          headers: {
            ...(token === undefined ? {} : as(token)),
            ...(body === undefined ? {} : typed),
          },
          ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        }),
        outcome,
      );
  accessGiven(memory, accessFixturePrincipal("mo"), [
    { on: "Site", kind: "CreateTenant" },
  ]);
  enveloped(
    await workspaceLinkMinted(app, "mo-token", { createAccounts: true }),
    "Rejected",
    accessNotPermittedCode,
  );
  enveloped(
    await app.inject({
      method: "DELETE",
      url: pathOf("siteWorkspaceLinkRevocation", "", "", "", "", minted.link),
      headers: as("mo-token"),
    }),
    "Rejected",
    accessNotPermittedCode,
  );
  assert.equal(links?.rows.length, 1);
  const plain = await workspaceLinkMinted(app, "mo-token", {
    createAccounts: false,
  });
  assert.equal(plain.statusCode, 201, plain.body);
  assert.equal(
    accessInviteLinkMintedSchema.parse(plain.json()).newAccounts,
    false,
  );
});

test("a workspace link's note past its bound or holding a line break, or a body outside its shape, is rejected, a note at its bound is kept, and the site's bound is a conflict", async () => {
  const { app, links } = await served();
  for (const body of [
    {
      createAccounts: true,
      note: "n".repeat(accessWorkspaceLinkNoteCharsMax + 1),
    },
    { createAccounts: true, note: "one\ntwo" },
    { createAccounts: true, note: "one\r\ntwo" },
    { createAccounts: true, note: "" },
    { createAccounts: true, role: "Admin" },
    { note: workspaceNote },
  ])
    enveloped(
      await workspaceLinkMinted(app, "sita-token", body),
      "Rejected",
      "InvalidRequest",
    );
  assert.deepEqual(links?.rows, []);
  const widest = '"é'.repeat(accessWorkspaceLinkNoteCharsMax / 2);
  const kept = await workspaceLinkMinted(app, "sita-token", {
    createAccounts: false,
    note: widest,
  });
  assert.equal(kept.statusCode, 201, kept.body);
  assert.equal(
    accessWorkspaceLinksSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: pathOf("siteWorkspaceLinks"),
          headers: as("sita-token"),
        })
      ).json(),
    ).links[0]?.note,
    widest,
  );
  for (let minted = 1; minted < accessInviteLinksOpenMax; minted += 1)
    assert.equal(
      (await workspaceLinkMinted(app, "sita-token", { createAccounts: false }))
        .statusCode,
      201,
    );
  enveloped(
    await workspaceLinkMinted(app, "sita-token", { createAccounts: false }),
    "Conflict",
    accessInviteLinkLimitReachedCode,
  );
});

test("a workspace link presented without a name, with a taken one or one no tenant may take is refused under its own code and stays open, with a free name makes its user the workspace's administrator, and is then answered the same to them alone", async () => {
  const { app, memory } = await served();
  await memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant: asTenantId("held-works"),
      relation: "admins",
    }),
  );
  const minted = accessInviteLinkMintedSchema.parse(
    (
      await workspaceLinkMinted(app, "sita-token", {
        createAccounts: true,
        note: workspaceNote,
      })
    ).json(),
  );
  const { token } = minted;
  enveloped(await redemption(app, undefined, { token }), "Unauthenticated");
  const wanted = await redemption(app, "sam-token", { token });
  enveloped(wanted, "Conflict", accessWorkspaceLinkNameWantedCode);
  for (const caller of ["sam-token", "alice-token"])
    enveloped(
      await redemption(app, caller, { token, workspace: "held-works" }),
      "Conflict",
      accessTenantTakenCode,
    );
  for (const workspace of ["Not A Name", "api", "w".repeat(40), 7])
    enveloped(
      await redemption(app, "sam-token", { token, workspace }),
      "Rejected",
      "InvalidRequest",
    );
  assert.equal((await registrationAsked(app, { token })).statusCode, 204);
  const redeemed = await redemption(app, "sam-token", {
    token,
    workspace: "sam-works",
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  assert.deepEqual(accessInviteLinkRedeemedSchema.parse(redeemed.json()), {
    tenant: "sam-works",
    role: "Admin",
    projects: [],
  });
  assert.ok(!redeemed.body.includes("Octo"), redeemed.body);
  assert.ok(!wanted.body.includes("Octo"), wanted.body);
  const batches = memory.batches.length;
  for (const workspace of [undefined, "sam-other-works", "Not A Name"]) {
    const again = await redemption(app, "sam-token", { token, workspace });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.body, redeemed.body);
  }
  assert.equal(memory.batches.length, batches);
  enveloped(
    await redemption(app, "dee-token", { token, workspace: "dee-works" }),
    "Absent",
  );
  enveloped(
    await redemption(app, "dee-token", {
      token: "token-nobody-holds",
      workspace: "Not A Name",
    }),
    "Absent",
  );
});

test("a tenant's link redeemed with a workspace's name or without one is used as before", async () => {
  const { app } = await served();
  for (const workspace of [undefined, "sam-works", "Not A Name"]) {
    const minted = accessInviteLinkMintedSchema.parse(
      (await linkMinted(app, "alice-token", { role: "Member" })).json(),
    );
    const redeemed = await redemption(app, "sam-token", {
      token: minted.token,
      ...(workspace === undefined ? {} : { workspace }),
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    assert.deepEqual(accessInviteLinkRedeemedSchema.parse(redeemed.json()), {
      tenant,
      role: "Member",
      projects: [],
    });
  }
});

/** The directory's question about a registration presenting `body`, sent as JSON as the directory sends it, with `headers` beside. */
function registrationAsked(
  app: Awaited<ReturnType<typeof served>>["app"],
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: accessRegistrationGatePath,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}

/** Asserts the gate refused, its body exactly the directory's message. */
function registrationRefused(answered: {
  statusCode: number;
  body: string;
}): void {
  assert.equal(answered.statusCode, 403, answered.body);
  assert.deepEqual(JSON.parse(answered.body), {
    messages: [
      {
        instance_ptr: "#/",
        messages: [
          {
            id: accessRegistrationGateMessageId,
            text: "Invite needed",
            type: "error",
          },
        ],
      },
    ],
  });
}

test("the registration gate admits an open link that may make accounts 204 with no body, with or without a bearer, and refuses every other token in the directory's shape", async () => {
  const { app } = await served();
  const opened = accessInviteLinkMintedSchema.parse(
    (await linkMinted(app, "alice-token", { role: "Member" })).json(),
  );
  const accountless = accessInviteLinkMintedSchema.parse(
    (await linkMinted(app, "dee-token", { role: "Member" })).json(),
  );
  for (const headers of [{}, as("forged"), as("alice-token")]) {
    const admitted = await registrationAsked(
      app,
      { token: opened.token },
      headers,
    );
    assert.equal(admitted.statusCode, 204, admitted.body);
    assert.equal(admitted.body, "");
    registrationRefused(
      await registrationAsked(app, { token: accountless.token }, headers),
    );
  }
  for (const body of [{}, { token: "" }, { token: "token-nobody-holds" }])
    registrationRefused(await registrationAsked(app, body));
  enveloped(
    await registrationAsked(app, { token: 7 }),
    "Rejected",
    "InvalidRequest",
  );
  const redeemed = await app.inject({
    method: "POST",
    url: pathOf("inviteLinkRedemption"),
    headers: { ...as("sam-token"), ...typed },
    payload: JSON.stringify({ token: opened.token }),
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  registrationRefused(await registrationAsked(app, { token: opened.token }));
});

test("the registration gate refuses on a plane with no store, and a store that rejects is a fault without the refusal's body", async () => {
  registrationRefused(
    await registrationAsked(
      (await served(true, undefined, undefined, false)).app,
      { token: "token-0" },
    ),
  );
  const { app, links } = await served();
  const minted = accessInviteLinkMintedSchema.parse(
    (await linkMinted(app, "alice-token", { role: "Member" })).json(),
  );
  if (links !== undefined)
    Object.assign(links.store, {
      opened: () => Promise.reject(new Error("store down")),
    });
  const faulted = await registrationAsked(app, { token: minted.token });
  assert.ok(faulted.statusCode >= 500, faulted.body);
  assert.ok(!faulted.body.includes("Invite needed"), faulted.body);
});
