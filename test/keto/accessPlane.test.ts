/**
 * The access plane against a real authority: what a list reads back from the
 * tuples, a principal and a project object decoded from what the server
 * answers, a role or hosted runs granted being a permit `ProjectAccess` then
 * answers for, and what a caller may do following who holds each kind.
 *
 * NOTHING ON A FRESH TENANT IS WRITTEN BUT BY THE CASE. The plane writes a
 * tenant's first administrator and its defaults only through the site's
 * invitation into a tenant of one's own, and never a `tenant` link or a
 * project's defaults, so each case writes those itself, as creation and
 * provisioning do.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ketoAccessPageTuplesMax } from "../../src/adapters/keto/accessTuples.ts";
import { accessAbilities } from "../../src/interpreter/accessAbilities.ts";
import { accessInvitations } from "../../src/interpreter/accessInvitation.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
  type AccessChange,
} from "../../src/interpreter/accessPlane.ts";
import type {
  AccessProjectRole,
  AccessTenantRole,
} from "../../src/contract/accessPlane.ts";
import {
  oidcPrincipal,
  oidcPrincipalSubject,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectPartition,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  hostedRunsGranted,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  asProjectId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessSiteDefaults,
  ketoHarnessTuples,
  ketoHarnessWithSiteAdministrator,
} from "./harness.ts";
import {
  directoryMemory,
  githubMemory,
  githubUser,
} from "../interpreter/accessInvitationFixture.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const tuples = ketoHarnessTuples();
const plane = accessPlane(
  { access, tuples, grants },
  { issuer: ketoHarnessIssuer, bounds: accessPlaneBoundsDefault },
);
const abilities = accessAbilities(
  { access, tuples },
  { bounds: accessPlaneBoundsDefault },
);
const alice = oidcPrincipal(ketoHarnessIssuer, "alice");

/**
 * A fresh tenant administered by alice, with two projects linked to it and one
 * under its name that is not, the linked ones, the tenant and the site carrying
 * their defaults. Every project carries a `/`, as the harness's do.
 */
async function tenantOf(label: string) {
  const web = ketoHarnessPartition(label);
  const api: Partition = {
    tenant: web.tenant,
    project: asProjectId(`api/${web.project}`),
  };
  const loose: Partition = {
    tenant: web.tenant,
    project: asProjectId(`loose/${web.project}`),
  };
  await ketoHarnessSiteDefaults();
  for (const grant of [
    projectTenantGrant(web),
    projectTenantGrant(api),
    ...tenantAuthorityDefaults(web.tenant),
    ...projectAuthorityDefaults(web),
    ...projectAuthorityDefaults(api),
  ])
    await grants.write(grant);
  await grants.write(
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "alice",
      tenant: web.tenant,
      relation: "admins",
    }),
  );
  return { web, api, loose, tenant: web.tenant };
}

test("a tenant's administrator lists every holder the authority answers, the caller marked and the linked projects named", async () => {
  const { web, api, loose, tenant } = await tenantOf("people");
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, "b/o:1", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleGranted(alice, web, "b/o:1", "Developer"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleGranted(alice, api, "cy", "Dispatcher"),
    "Changed",
  );
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "stray",
      ...loose,
      relation: "developers",
    }),
  );
  await grants.write(
    tenantPrincipalGrant({
      issuer: "https://other.keto.test",
      subject: "x",
      tenant,
      relation: "members",
    }),
  );
  const people = await plane.tenantPeople(alice, tenant);
  assert.deepEqual(people?.projects, [api.project, web.project].sort());
  assert.deepEqual(
    people?.people.map((person) => [
      person.subject,
      person.mine,
      person.tenantRoles,
      person.projects,
    ]),
    [
      ["alice", true, ["Admin"], []],
      [
        "b/o:1",
        false,
        ["Member"],
        [{ project: web.project, roles: ["Developer"] }],
      ],
      ["cy", false, [], [{ project: api.project, roles: ["Dispatcher"] }]],
    ],
  );
  assert.equal(people?.otherIssuers, 1);
  assert.equal(people?.truncated, false);
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "alice", "Admin"),
    "LastTenantAdministrator",
  );
});

test("a principal and a project object read back from the authority decode to what was written", async () => {
  const partition = ketoHarnessPartition("decode");
  const subject = "a/b:c 7";
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      ...partition,
      relation: "developers",
    }),
  );
  const page = await tuples.page(
    {
      query: "Object",
      namespace: projectAccessNamespace,
      object: projectAccessObject(partition),
    },
    undefined,
  );
  const [tuple] = page.tuples;
  assert.deepEqual(
    projectAccessObjectPartition(tuple?.object ?? ""),
    partition,
  );
  assert.equal(
    tuple?.subject.subject === "Id"
      ? oidcPrincipalSubject(ketoHarnessIssuer, tuple.subject.id)
      : undefined,
    subject,
  );
});

/** Whether `subject` holds `kind` on `partition`, asked as the API asks it. */
async function holds(
  subject: string,
  partition: Partition,
  kind: ProjectAccessKind,
): Promise<boolean> {
  return (
    (await access.authorize(
      oidcPrincipal(ketoHarnessIssuer, subject),
      partition,
      kind,
    )) !== undefined
  );
}

test("a project role granted is the permit it carries, and removed is not", async () => {
  const { web } = await tenantOf("permits");
  for (const [role, kind] of [
    ["Developer", "Mutate"],
    ["Dispatcher", "DispatchTicket"],
    ["Viewer", "Read"],
    ["Admin", "Administer"],
  ] as const) {
    const subject = `holder-${role}`;
    assert.equal(await holds(subject, web, kind), false, role);
    await plane.projectRoleGranted(alice, web, subject, role);
    assert.equal(await holds(subject, web, kind), true, role);
    await plane.projectRoleRemoved(alice, web, subject, role);
    assert.equal(await holds(subject, web, kind), false, role);
  }
});

test("a tenant's administrator granted administers each of its projects, and removed does not", async () => {
  const { web, api, tenant } = await tenantOf("tenant-admin");
  await plane.tenantRoleGranted(alice, tenant, "dee", "Admin");
  for (const partition of [web, api])
    assert.equal(await holds("dee", partition, "Administer"), true);
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "dee", "Admin"),
    "Changed",
  );
  for (const partition of [web, api])
    assert.equal(await holds("dee", partition, "Administer"), false);
});

test("a list crosses the authority's page boundary and reads every holder past it", async () => {
  const { tenant } = await tenantOf("pages");
  const subjects = Array.from(
    { length: ketoAccessPageTuplesMax + 3 },
    (_, at) => `member-${String(at).padStart(3, "0")}`,
  );
  for (const subject of subjects)
    await plane.tenantRoleGranted(alice, tenant, subject, "Member");
  const first = await tuples.page(
    {
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
    },
    undefined,
  );
  assert.equal(first.tuples.length, ketoAccessPageTuplesMax);
  assert.notEqual(first.next ?? "", "");
  const people = await plane.tenantPeople(alice, tenant);
  assert.deepEqual(
    people?.people.map((person) => person.subject),
    ["alice", ...subjects],
  );
  assert.equal(people?.truncated, false);
});

/** The invitation over the real authority, with a directory and GitHub held in memory. */
function invitationsOf() {
  const directory = directoryMemory();
  const github = githubMemory({
    "octo-cat": githubUser("990000001", "Octo-Cat"),
  });
  return {
    directory,
    github,
    invitations: accessInvitations(
      { access, tuples, grants, directory: directory.directory, github },
      { issuer: ketoHarnessIssuer },
    ),
  };
}

test("an invitation by a caller who may not be answered the tenant's list is absent, and GitHub and the directory are asked nothing", async () => {
  const { tenant } = await tenantOf("invite-absent");
  await plane.tenantRoleGranted(alice, tenant, "mo", "Member");
  const { directory, github, invitations } = invitationsOf();
  for (const subject of ["mo", "nobody"])
    assert.deepEqual(
      await invitations.invite(
        oidcPrincipal(ketoHarnessIssuer, subject),
        tenant,
        { github: "octo-cat", email: "octo@example.com", role: "Member" },
      ),
      { invited: "Absent" },
      subject,
    );
  assert.deepEqual(github.looked, []);
  assert.deepEqual(directory.asked, []);
});

test("an invitation by a tenant administrator who is the site's grants the permits its roles carry and lists the person, and a project not linked to the tenant is refused", async () => {
  const { web, api, loose, tenant } = await tenantOf("invite-grants");
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    await grants.write(tenantAdministratorOf(administrator, tenant));
    const { directory, invitations } = invitationsOf();
    assert.deepEqual(
      await invitations.invite(administrator, tenant, {
        github: "octo-cat",
        email: "octo@example.com",
        role: "Member",
        projects: [{ project: loose.project, roles: ["Developer"] }],
      }),
      { invited: "ProjectUnknown" },
    );
    assert.deepEqual(directory.asked, []);
    const invited = await invitations.invite(administrator, tenant, {
      github: "octo-cat",
      email: "octo@example.com",
      role: "Member",
      projects: [{ project: web.project, roles: ["Developer", "Dispatcher"] }],
    });
    assert.equal(invited.invited, "Invited");
    assert.equal(invited.invited === "Invited" && invited.created, true);
    const subject = invited.invited === "Invited" ? invited.subject : "";
    assert.equal(await holds(subject, web, "Mutate"), true);
    assert.equal(await holds(subject, web, "DispatchTicket"), true);
    assert.equal(await holds(subject, web, "Administer"), false);
    assert.equal(await holds(subject, api, "Mutate"), false);
    const people = await plane.tenantPeople(alice, tenant);
    assert.deepEqual(
      people?.people.find((person) => person.subject === subject)?.tenantRoles,
      ["Member"],
    );
  });
});

/** One principal as the tenant's administrator. */
function tenantAdministratorOf(
  principal: Principal,
  tenant: TenantId,
): ProjectGrant {
  return {
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(tenant),
    relation: "admins",
    holder: { subject: "Principal", principal },
  };
}

/** One principal written straight into one of the tenant's relations saying who may grant. */
function tenantGranterOf(
  principal: Principal,
  tenant: TenantId,
  relation: "admin_granters" | "member_granters",
): ProjectGrant {
  return {
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(tenant),
    relation,
    holder: { subject: "Principal", principal },
  };
}

/** What granting and then removing each role on the tenant, where named, and on each partition came to, keyed by where and which. */
async function changed(
  caller: Principal,
  tenant: TenantId | undefined,
  partitions: readonly Partition[],
  subject = "target",
): Promise<Record<string, AccessChange>> {
  const answered: Record<string, AccessChange> = {};
  const tenantRoles: readonly AccessTenantRole[] = ["Admin", "Member"];
  const projectRoles: readonly AccessProjectRole[] = [
    "Admin",
    "Developer",
    "Dispatcher",
    "Viewer",
  ];
  if (tenant !== undefined)
    for (const role of tenantRoles) {
      answered[`grant ${role}`] = await plane.tenantRoleGranted(
        caller,
        tenant,
        subject,
        role,
      );
      answered[`remove ${role}`] = await plane.tenantRoleRemoved(
        caller,
        tenant,
        subject,
        role,
      );
    }
  for (const partition of partitions)
    for (const role of projectRoles) {
      answered[`grant ${partition.project} ${role}`] =
        await plane.projectRoleGranted(caller, partition, subject, role);
      answered[`remove ${partition.project} ${role}`] =
        await plane.projectRoleRemoved(caller, partition, subject, role);
    }
  return answered;
}

/** Whether every change `changed` answered came to `expected`. */
function allCameTo(
  answered: Record<string, AccessChange>,
  expected: AccessChange,
): void {
  for (const [change, came] of Object.entries(answered))
    assert.equal(came, expected, change);
}

test("a tenant's administrator grants and removes every role on the tenant and on each of its projects", async () => {
  const { web, api, tenant } = await tenantOf("change-tenant-admin");
  const answered = await changed(alice, tenant, [web, api]);
  assert.equal(Object.keys(answered).length, 20);
  allCameTo(answered, "Changed");
});

test("a project's administrator changes that project and is answered its list, and is absent on the tenant, the other project and an invitation", async () => {
  const { web, api, tenant } = await tenantOf("change-project-admin");
  await plane.projectRoleGranted(alice, web, "pat", "Admin");
  const pat = oidcPrincipal(ketoHarnessIssuer, "pat");
  allCameTo(await changed(pat, undefined, [web]), "Changed");
  assert.notEqual(await plane.projectPeople(pat, web), undefined);
  assert.equal(await plane.tenantPeople(pat, tenant), undefined);
  assert.equal(await plane.projectPeople(pat, api), undefined);
  allCameTo(await changed(pat, tenant, [api]), "Absent");
  assert.deepEqual(await abilities.projectAbilities(pat, web), {
    tenant,
    project: web.project,
    roles: ["Admin", "Developer", "Dispatcher", "Viewer"],
    manageAuthorities: true,
  });
  assert.equal(await abilities.tenantAbilities(pat, tenant), undefined);
  assert.equal(await abilities.projectAbilities(pat, api), undefined);
  assert.equal(await abilities.siteAbilities(pat), undefined);
  assert.deepEqual(
    await invitationsOf().invitations.invite(pat, tenant, {
      github: "octo-cat",
      email: "octo@example.com",
      role: "Member",
      projects: [{ project: web.project, roles: ["Developer"] }],
    }),
    { invited: "Absent" },
  );
});

test("a person written into `member_granters` is answered the list and changes `Member`, and is refused `Admin` with nothing written", async () => {
  const { web, api, tenant } = await tenantOf("member-granter");
  const mel = oidcPrincipal(ketoHarnessIssuer, "mel");
  await grants.write(tenantGranterOf(mel, tenant, "member_granters"));
  const melAbilities = await abilities.tenantAbilities(mel, tenant);
  assert.deepEqual(melAbilities?.roles, ["Member"]);
  assert.deepEqual(
    melAbilities?.projects.map((project) => [project.project, project.roles]),
    [api.project, web.project].sort().map((project) => [project, []]),
  );
  assert.notEqual(await plane.tenantPeople(mel, tenant), undefined);
  assert.equal(
    await plane.tenantRoleGranted(mel, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleRemoved(mel, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleGranted(mel, tenant, "zed", "Admin"),
    "Refused",
  );
  assert.equal(
    await plane.tenantRoleRemoved(mel, tenant, "alice", "Admin"),
    "Refused",
  );
  assert.deepEqual(
    (await plane.tenantPeople(alice, tenant))?.people.map((person) => [
      person.subject,
      person.tenantRoles,
    ]),
    [["alice", ["Admin"]]],
  );
});

test("a person written into `viewer_granters` is answered the project's list and abilities naming `Viewer`, grants and removes it, and one in `developer_granters` is refused it", async () => {
  const { web, tenant } = await tenantOf("viewer-granter");
  const vic = oidcPrincipal(ketoHarnessIssuer, "vic");
  const dee = oidcPrincipal(ketoHarnessIssuer, "dee");
  for (const [principal, relation] of [
    [vic, "viewer_granters"],
    [dee, "developer_granters"],
  ] as const)
    await grants.write({
      namespace: projectAccessNamespace,
      object: projectAccessObject(web),
      relation,
      holder: { subject: "Principal", principal },
    });
  assert.deepEqual(await abilities.projectAbilities(vic, web), {
    tenant,
    project: web.project,
    roles: ["Viewer"],
    manageAuthorities: false,
  });
  const rolesOf = async () =>
    (await plane.projectPeople(vic, web))?.people.find(
      (person) => person.subject === "zed",
    )?.roles;
  assert.equal(
    await plane.projectRoleGranted(vic, web, "zed", "Viewer"),
    "Changed",
  );
  assert.deepEqual(await rolesOf(), ["Viewer"]);
  assert.equal(
    await plane.projectRoleGranted(dee, web, "zed", "Viewer"),
    "Refused",
  );
  assert.equal(
    await plane.projectRoleRemoved(dee, web, "zed", "Viewer"),
    "Refused",
  );
  assert.equal(
    await plane.projectRoleRemoved(vic, web, "zed", "Viewer"),
    "Changed",
  );
  assert.equal(await rolesOf(), undefined);
});

test("with the tenant's administrators taken out of `admin_granters` its administrator is refused `Admin` and still changes `Member`, and a person written there grants it", async () => {
  const { tenant } = await tenantOf("admin-granters");
  assert.deepEqual((await abilities.tenantAbilities(alice, tenant))?.roles, [
    "Admin",
    "Member",
  ]);
  for (const grant of tenantAuthorityDefaults(tenant))
    if (grant.relation === "admin_granters") await grants.remove(grant);
  assert.deepEqual((await abilities.tenantAbilities(alice, tenant))?.roles, [
    "Member",
  ]);
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, "zed", "Admin"),
    "Refused",
  );
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "zed", "Member"),
    "Changed",
  );
  const ari = oidcPrincipal(ketoHarnessIssuer, "ari");
  await grants.write(tenantGranterOf(ari, tenant, "admin_granters"));
  assert.equal(
    await plane.tenantRoleGranted(ari, tenant, "zed", "Admin"),
    "Changed",
  );
  assert.deepEqual(
    (await plane.tenantPeople(alice, tenant))?.people.map((person) => [
      person.subject,
      person.tenantRoles,
    ]),
    [
      ["alice", ["Admin"]],
      ["zed", ["Admin"]],
    ],
  );
});

test("a tenant member, a project developer and a stranger are absent everywhere", async () => {
  const { web, api, tenant } = await tenantOf("absent-everywhere");
  await plane.tenantRoleGranted(alice, tenant, "mo", "Member");
  await plane.projectRoleGranted(alice, web, "dev", "Developer");
  for (const subject of ["mo", "dev", "stranger"]) {
    const caller = oidcPrincipal(ketoHarnessIssuer, subject);
    assert.equal(await plane.tenantPeople(caller, tenant), undefined, subject);
    for (const partition of [web, api])
      assert.equal(
        await plane.projectPeople(caller, partition),
        undefined,
        subject,
      );
    allCameTo(await changed(caller, tenant, [web, api]), "Absent");
    assert.equal(await abilities.tenantAbilities(caller, tenant), undefined);
    for (const partition of [web, api])
      assert.equal(
        await abilities.projectAbilities(caller, partition),
        undefined,
        subject,
      );
    assert.equal(await abilities.siteAbilities(caller), undefined, subject);
  }
});

test("the site's administrator, holding no role in the tenant, is answered every list and refused every change", async () => {
  const { web, api, tenant } = await tenantOf("site-admin");
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    assert.notEqual(await plane.tenantPeople(administrator, tenant), undefined);
    for (const partition of [web, api])
      assert.notEqual(
        await plane.projectPeople(administrator, partition),
        undefined,
        partition.project,
      );
    allCameTo(await changed(administrator, tenant, [web, api]), "Refused");
    assert.deepEqual(await abilities.tenantAbilities(administrator, tenant), {
      tenant,
      roles: [],
      grantHostedRuns: true,
      createAccount: true,
      manageAuthorities: true,
      manageSiteHeldAuthorities: true,
      projects: [api.project, web.project].sort().map((project) => ({
        project,
        roles: [],
        manageAuthorities: true,
      })),
      truncated: false,
    });
    assert.deepEqual(await abilities.siteAbilities(administrator), {
      administer: true,
      createAccount: true,
      createTenant: true,
      manageAuthorities: true,
    });
  });
});

test("a tenant's administrator may grant both tenant roles and every project role, and change the tenant's and each project's authorities and nothing the site holds", async () => {
  const { web, api, tenant } = await tenantOf("abilities-tenant-admin");
  assert.deepEqual(await abilities.tenantAbilities(alice, tenant), {
    tenant,
    roles: ["Admin", "Member"],
    grantHostedRuns: false,
    createAccount: false,
    manageAuthorities: true,
    manageSiteHeldAuthorities: false,
    projects: [api.project, web.project].sort().map((project) => ({
      project,
      roles: ["Admin", "Developer", "Dispatcher", "Viewer"],
      manageAuthorities: true,
    })),
    truncated: false,
  });
});

test("the site's administrator gives a member hosted runs and takes them back, the tenant's administrator is refused both and a stranger is absent", async () => {
  const { tenant } = await tenantOf("hosted-runs");
  await plane.tenantRoleGranted(alice, tenant, "mo", "Member");
  const mo = oidcPrincipal(ketoHarnessIssuer, "mo");
  const listed = async () =>
    (await plane.tenantPeople(alice, tenant))?.people.find(
      (person) => person.subject === "mo",
    )?.hostedRuns;
  const stranger = oidcPrincipal(ketoHarnessIssuer, "stranger");
  assert.equal(
    await plane.tenantHostedRunsGiven(alice, tenant, "mo"),
    "Refused",
  );
  assert.equal(
    await plane.tenantHostedRunsGiven(stranger, tenant, "mo"),
    "Absent",
  );
  assert.equal(await listed(), false);
  assert.equal(await hostedRunsGranted(access, mo, tenant), false);
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    assert.equal(
      await plane.tenantHostedRunsGiven(administrator, tenant, "mo"),
      "Changed",
    );
    assert.equal(await listed(), true);
    assert.equal(await hostedRunsGranted(access, mo, tenant), true);
    assert.equal(
      await plane.tenantHostedRunsTaken(alice, tenant, "mo"),
      "Refused",
    );
    assert.equal(
      await plane.tenantHostedRunsTaken(stranger, tenant, "mo"),
      "Absent",
    );
    assert.equal(await listed(), true);
    assert.equal(
      await plane.tenantHostedRunsTaken(administrator, tenant, "mo"),
      "Changed",
    );
    assert.equal(await listed(), false);
    assert.equal(await hostedRunsGranted(access, mo, tenant), false);
  });
});
