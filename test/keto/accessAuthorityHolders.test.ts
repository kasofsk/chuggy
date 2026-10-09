/**
 * Adding and removing an authority's holders, against a real authority: a
 * holder added gives the kind its authority names and removing it ends that,
 * every group a record admits is one the server follows, and what a caller is
 * refused writes nothing.
 *
 * THE SITE IS SHARED, so every principal here is a case's own, and a holder a
 * case adds to the site is removed however the case ends.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  accessProjectAuthorityAdmits,
  accessProjectGroups,
  accessTenantAuthorityAdmits,
  type AccessGroup,
  type AccessProjectAuthority,
  type AccessTenantAuthority,
} from "../../src/contract/accessPlane.ts";
import { accessAuthorities } from "../../src/interpreter/accessAuthorities.ts";
import {
  accessAuthorityHolders,
  type AccessHeld,
  type AccessHolder,
} from "../../src/interpreter/accessAuthorityHolders.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
} from "../../src/interpreter/accessPlane.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  tenantSiteRelation,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessSiteDefaults,
  ketoHarnessTuples,
  ketoHarnessWithSiteAdministrator,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const tuples = ketoHarnessTuples();
const settings = {
  issuer: ketoHarnessIssuer,
  bounds: accessPlaneBoundsDefault,
};
const holders = accessAuthorityHolders({ access, tuples, grants }, settings);
const authorities = accessAuthorities({ access, tuples }, settings);
const plane = accessPlane({ access, tuples, grants }, settings);

/** A subject no other case or run names, and the principal it is. */
function someone(label: string) {
  const subject = `${label}-${randomUUID()}`;
  return { subject, principal: oidcPrincipal(ketoHarnessIssuer, subject) };
}

/** The roles each group's holders are written into, by group. */
interface KetoHolders {
  readonly web: Partition;
  readonly admin: ReturnType<typeof someone>;
  readonly member: ReturnType<typeof someone>;
  readonly projectAdmin: ReturnType<typeof someone>;
  readonly developer: ReturnType<typeof someone>;
}

/** The roles of `KetoHolders` written on `web`, and `extra` beside them. */
async function rolesWritten(
  label: string,
  extra: (web: Partition) => readonly ProjectGrant[],
): Promise<KetoHolders> {
  const web = ketoHarnessPartition(label);
  const holding = {
    web,
    admin: someone("admin"),
    member: someone("member"),
    projectAdmin: someone("project-admin"),
    developer: someone("developer"),
  };
  const onTenant = (subject: string, relation: string) =>
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: web.tenant,
      relation,
    });
  const onProject = (subject: string, relation: string) =>
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      ...web,
      relation,
    });
  for (const grant of [
    ...extra(web),
    onTenant(holding.admin.subject, "admins"),
    onTenant(holding.member.subject, "members"),
    onProject(holding.projectAdmin.subject, "admins"),
    onProject(holding.developer.subject, "developers"),
  ])
    await grants.write(grant);
  return holding;
}

/** A tenant and its linked project carrying their defaults, each role held by a principal of the case's own. */
async function tenantOf(label: string): Promise<KetoHolders> {
  await ketoHarnessSiteDefaults();
  return rolesWritten(label, (web) => [
    projectTenantGrant(web),
    ...tenantAuthorityDefaults(web.tenant),
    ...projectAuthorityDefaults(web),
  ]);
}

const person = (subject: string): AccessHolder => ({
  holder: "Person",
  subject,
});

const group = (named: AccessGroup): AccessHolder => ({
  holder: "Group",
  group: named,
});

const onTenant = (
  holding: KetoHolders,
  authority: AccessTenantAuthority,
  holder: AccessHolder,
): AccessHeld => ({
  level: "Tenant",
  tenant: holding.web.tenant,
  authority,
  holder,
});

const onProject = (
  holding: KetoHolders,
  authority: AccessProjectAuthority,
  holder: AccessHolder,
): AccessHeld => ({
  level: "Project",
  partition: holding.web,
  authority,
  holder,
});

/** The groups and the people's subjects holding one of the tenant's authorities. */
async function tenantHeld(
  holding: KetoHolders,
  authority: AccessTenantAuthority,
) {
  const held = (
    await authorities.tenantAuthorities(
      holding.admin.principal,
      holding.web.tenant,
    )
  )?.authorities.find((one) => one.authority === authority);
  return {
    groups: held?.groups,
    people: held?.people.map((one) => one.subject),
    unnamed: held?.unnamed,
  };
}

async function tenantKindHeld(
  principal: Principal,
  holding: KetoHolders,
  kind: TenantAccessKind,
): Promise<boolean> {
  return (
    (await access.authorizeTenant(principal, holding.web.tenant, kind)) !==
    undefined
  );
}

test("a member made a granter of `Member` grants and removes it, is refused `Admin`, and is absent once removed", async () => {
  const holding = await tenantOf("holders-delegation");
  const { admin, member } = holding;
  const delegated = onTenant(holding, "MemberGranters", person(member.subject));
  assert.equal(
    await holders.holderAdded(admin.principal, delegated),
    "Changed",
  );
  const tenant = holding.web.tenant;
  assert.equal(
    await plane.tenantRoleGranted(member.principal, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleRemoved(member.principal, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleGranted(member.principal, tenant, "zed", "Admin"),
    "Refused",
  );
  assert.equal(
    await holders.holderRemoved(admin.principal, delegated),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleGranted(member.principal, tenant, "zed", "Member"),
    "Absent",
  );
});

test("the tenant's members made granters of `Member` grant it, and removing the group ends that and leaves the tenant's administrators", async () => {
  const holding = await tenantOf("holders-group");
  const { admin, member } = holding;
  const tenant = holding.web.tenant;
  const members = onTenant(holding, "MemberGranters", group("TenantMembers"));
  assert.equal(await holders.holderAdded(admin.principal, members), "Changed");
  assert.equal(
    await plane.tenantRoleGranted(member.principal, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await holders.holderRemoved(admin.principal, members),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleGranted(member.principal, tenant, "zed", "Member"),
    "Absent",
  );
  assert.deepEqual((await tenantHeld(holding, "MemberGranters")).groups, [
    "TenantAdmins",
  ]);
});

test("who gives hosted runs is the site's to change: the tenant's administrator is refused before the holder is looked at, and the site's administrator adds them", async () => {
  const holding = await tenantOf("holders-site-held");
  const { admin } = holding;
  for (const holder of [group("TenantAdmins"), group("TenantMembers")])
    assert.equal(
      await holders.holderAdded(
        admin.principal,
        onTenant(holding, "HostedRunsGranters", holder),
      ),
      "Refused",
    );
  assert.deepEqual(await tenantHeld(holding, "HostedRunsGranters"), {
    groups: ["SiteAdmins"],
    people: [],
    unnamed: 0,
  });
  assert.equal(
    await tenantKindHeld(admin.principal, holding, "GrantHostedExecution"),
    false,
  );
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    assert.equal(
      await holders.holderAdded(
        administrator,
        onTenant(holding, "HostedRunsGranters", group("TenantAdmins")),
      ),
      "Changed",
    );
  });
  assert.equal(
    await tenantKindHeld(admin.principal, holding, "GrantHostedExecution"),
    true,
  );
});

test("a group the authority does not admit is refused and nothing is written", async () => {
  const holding = await tenantOf("holders-not-admitted");
  assert.equal(
    await holders.holderAdded(
      holding.admin.principal,
      onTenant(holding, "AdminGranters", group("TenantMembers")),
    ),
    "NotAdmitted",
  );
  assert.deepEqual((await tenantHeld(holding, "AdminGranters")).groups, [
    "TenantAdmins",
  ]);
  assert.equal(
    await holders.holderAdded(
      holding.projectAdmin.principal,
      onProject(holding, "AdminGranters", group("ProjectDevelopers")),
    ),
    "NotAdmitted",
  );
  const projectHeld = await authorities.projectAuthorities(
    holding.projectAdmin.principal,
    holding.web,
  );
  assert.deepEqual(
    projectHeld?.authorities.find((one) => one.authority === "AdminGranters")
      ?.groups,
    ["TenantAdmins", "ProjectAdmins"],
  );
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    for (const named of accessProjectGroups)
      assert.equal(
        await holders.holderAdded(administrator, {
          level: "Site",
          authority: "AuthorityManagers",
          holder: group(named),
        }),
        "NotAdmitted",
        named,
      );
    const site = await authorities.siteAuthorities(administrator);
    assert.deepEqual(
      site?.authorities.find((one) => one.authority === "AuthorityManagers")
        ?.groups,
      [],
    );
  });
});

test("a tenant made one of the site's account creators gives its administrator `CreateAccount` until it is removed, and a tenant nobody made is absent there", async () => {
  const holding = await tenantOf("holders-creators");
  const unmade = await rolesWritten("holders-unmade", () => []);
  const creators = (tenant: Partition["tenant"]): AccessHeld => ({
    level: "Site",
    authority: "AccountCreators",
    holder: { holder: "Tenant", tenant },
  });
  const creates = async () =>
    (await access.authorizeSite(holding.admin.principal, "CreateAccount")) !==
    undefined;
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    try {
      assert.equal(await creates(), false);
      assert.equal(
        await holders.holderAdded(administrator, creators(holding.web.tenant)),
        "Changed",
      );
      assert.equal(await creates(), true);
      assert.equal(
        await holders.holderRemoved(
          administrator,
          creators(holding.web.tenant),
        ),
        "Changed",
      );
      assert.equal(await creates(), false);
      assert.equal(
        await holders.holderAdded(administrator, creators(unmade.web.tenant)),
        "Absent",
      );
      const site = await authorities.siteAuthorities(administrator);
      assert.ok(
        !site?.authorities
          .find((one) => one.authority === "AccountCreators")
          ?.tenants.includes(unmade.web.tenant),
      );
    } finally {
      await holders.holderRemoved(administrator, creators(holding.web.tenant));
    }
  });
});

/** The kind each of a tenant's authorities gives its holders. */
const ketoTenantAuthorityKinds: Readonly<
  Record<AccessTenantAuthority, TenantAccessKind>
> = {
  AdminGranters: "GrantTenantAdmin",
  MemberGranters: "GrantMember",
  HostedRunsGranters: "GrantHostedExecution",
  AuthorityManagers: "ManageTenantAuthorities",
};

/** The kind each of a project's authorities gives its holders. */
const ketoProjectAuthorityKinds: Readonly<
  Record<AccessProjectAuthority, ProjectAccessKind>
> = {
  AdminGranters: "GrantProjectAdmin",
  DeveloperGranters: "GrantDeveloper",
  DispatcherGranters: "GrantDispatcher",
  ViewerGranters: "GrantViewer",
  AuthorityManagers: "ManageProjectAuthorities",
};

/** A tenant linked to the site and a project linked to it, no authority holding anybody, each role held by a principal of the case's own. */
function linkedOnly(label: string): Promise<KetoHolders> {
  return rolesWritten(label, (web) => [
    projectTenantGrant(web),
    ...tenantAuthorityDefaults(web.tenant).filter(
      (grant) => grant.relation === tenantSiteRelation,
    ),
  ]);
}

/** Who holds `named`'s role on `holding`, the site's administrator being `administrator`. */
function groupHolder(
  holding: KetoHolders,
  named: AccessGroup,
  administrator: Principal,
): Principal {
  switch (named) {
    case "SiteAdmins":
      return administrator;
    case "TenantAdmins":
      return holding.admin.principal;
    case "TenantMembers":
      return holding.member.principal;
    case "ProjectAdmins":
      return holding.projectAdmin.principal;
    case "ProjectDevelopers":
      return holding.developer.principal;
  }
}

test("every group a record admits is one the server follows: with it the only holder, a holder of its role holds the kind the authority gives", async () => {
  await ketoHarnessSiteDefaults();
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    for (const [authority, groups] of Object.entries(
      accessTenantAuthorityAdmits,
    ) as [AccessTenantAuthority, readonly AccessGroup[]][])
      for (const named of groups) {
        const holding = await linkedOnly("holders-pair-tenant");
        const holder = groupHolder(holding, named, administrator);
        const kind = ketoTenantAuthorityKinds[authority];
        const pair = `${authority} ${named}`;
        assert.equal(await tenantKindHeld(holder, holding, kind), false, pair);
        assert.equal(
          await holders.holderAdded(
            administrator,
            onTenant(holding, authority, group(named)),
          ),
          "Changed",
          pair,
        );
        assert.equal(await tenantKindHeld(holder, holding, kind), true, pair);
      }
    for (const [authority, groups] of Object.entries(
      accessProjectAuthorityAdmits,
    ) as [AccessProjectAuthority, readonly AccessGroup[]][])
      for (const named of groups) {
        const holding = await linkedOnly("holders-pair-project");
        const holder = groupHolder(holding, named, administrator);
        const kind = ketoProjectAuthorityKinds[authority];
        const held = async () =>
          (await access.authorize(holder, holding.web, kind)) !== undefined;
        const pair = `${authority} ${named}`;
        assert.equal(await held(), false, pair);
        assert.equal(
          await holders.holderAdded(
            administrator,
            onProject(holding, authority, group(named)),
          ),
          "Changed",
          pair,
        );
        assert.equal(await held(), true, pair);
      }
    assert.equal(
      await holders.holderAdded(administrator, {
        level: "Site",
        authority: "AccountCreators",
        holder: group("SiteAdmins"),
      }),
      "Changed",
    );
    assert.notEqual(
      await access.authorizeSite(administrator, "CreateAccount"),
      undefined,
    );
  });
});

test("a group written by hand that the record does not admit is removed, and a holder written twice is removed by one request", async () => {
  const holding = await tenantOf("holders-removal");
  const tenantObject = projectAccessTenantObject(holding.web.tenant);
  const twice = someone("twice");
  for (const grant of [
    {
      namespace: projectAccessTenantNamespace,
      object: tenantObject,
      relation: "admin_granters",
      holder: {
        subject: "Holders",
        namespace: projectAccessTenantNamespace,
        object: tenantObject,
        relation: "members",
      },
    },
    {
      ...tenantPrincipalGrant({
        issuer: ketoHarnessIssuer,
        subject: twice.subject,
        tenant: holding.web.tenant,
        relation: "admins",
      }),
      relation: "member_granters",
    },
  ] as const satisfies readonly ProjectGrant[]) {
    await grants.write(grant);
    await grants.write(grant);
  }
  assert.deepEqual((await tenantHeld(holding, "AdminGranters")).groups, [
    "TenantAdmins",
    "TenantMembers",
  ]);
  assert.equal(
    await holders.holderRemoved(
      holding.admin.principal,
      onTenant(holding, "AdminGranters", group("TenantMembers")),
    ),
    "Changed",
  );
  assert.equal(
    await holders.holderRemoved(
      holding.admin.principal,
      onTenant(holding, "MemberGranters", person(twice.subject)),
    ),
    "Changed",
  );
  assert.deepEqual(await tenantHeld(holding, "AdminGranters"), {
    groups: ["TenantAdmins"],
    people: [],
    unnamed: 0,
  });
  assert.deepEqual(await tenantHeld(holding, "MemberGranters"), {
    groups: ["TenantAdmins"],
    people: [],
    unnamed: 0,
  });
});

test("a tenant member, a project developer and a stranger are absent on every change of a holder", async () => {
  const holding = await tenantOf("holders-absent");
  const shapes: readonly AccessHolder[] = [
    person("zed"),
    group("TenantAdmins"),
    { holder: "Tenant", tenant: holding.web.tenant },
  ];
  const changes: readonly AccessHeld[] = shapes.flatMap((holder) => [
    { level: "Site", authority: "AccountCreators", holder },
    onTenant(holding, "MemberGranters", holder),
    onProject(holding, "DeveloperGranters", holder),
  ]);
  for (const caller of [
    holding.member.principal,
    holding.developer.principal,
    someone("stranger").principal,
  ])
    for (const held of changes) {
      assert.equal(await holders.holderAdded(caller, held), "Absent");
      assert.equal(await holders.holderRemoved(caller, held), "Absent");
    }
  assert.deepEqual(await tenantHeld(holding, "MemberGranters"), {
    groups: ["TenantAdmins"],
    people: [],
    unnamed: 0,
  });
});
