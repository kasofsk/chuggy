/**
 * Who may grant a role, make an account or manage either, asked of the
 * authority the API authorizes with over the tuples each level starts with. A
 * default proved anywhere else would prove only that this suite and the
 * functions writing it agree.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allProjectAccessKinds,
  allSiteAccessKinds,
  allTenantAccessKinds,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccessKind,
  type SiteAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  projectAuthorityDefaults,
  projectRelationGrant,
  projectTenantGrant,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  tenantSiteRelation,
  type ProjectGrant,
  type ProjectGrantSubject,
} from "../../src/interpreter/projectGrant.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessRoleKinds,
  ketoHarnessSiteDefaults,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();

/** The tenant kinds a person's role gives, which every other tenant kind is not. */
const tenantRoleKinds: readonly TenantAccessKind[] = [
  "AdministerTenant",
  "InviteToTenant",
  "ExecuteHosted",
];

/** The kinds asked of a relation saying who may grant or manage, at each level. */
interface AuthorityHeld {
  readonly site: readonly SiteAccessKind[];
  readonly tenant: readonly TenantAccessKind[];
  readonly project: readonly ProjectAccessKind[];
}

const heldNothing: AuthorityHeld = { site: [], tenant: [], project: [] };

/** Every authority kind the principal holds on the site, the partition's tenant and the partition. */
async function authorityHeld(
  principal: Principal,
  partition: Partition,
): Promise<AuthorityHeld> {
  const site: SiteAccessKind[] = [];
  for (const kind of allSiteAccessKinds)
    if ((await access.authorizeSite(principal, kind)) !== undefined)
      site.push(kind);
  const tenant: TenantAccessKind[] = [];
  for (const kind of allTenantAccessKinds)
    if (
      !tenantRoleKinds.includes(kind) &&
      (await access.authorizeTenant(principal, partition.tenant, kind)) !==
        undefined
    )
      tenant.push(kind);
  const project: ProjectAccessKind[] = [];
  for (const kind of allProjectAccessKinds)
    if (
      !ketoHarnessRoleKinds.includes(kind) &&
      (await access.authorize(principal, partition, kind)) !== undefined
    )
      project.push(kind);
  return { site, tenant, project };
}

/** A principal no other case or run names. */
const someone = (label: string): Principal =>
  oidcPrincipal(ketoHarnessIssuer, `${label}-${randomUUID()}`);

const siteAdministratorGrant = (principal: Principal): ProjectGrant => ({
  namespace: projectAccessSiteNamespace,
  object: projectAccessSiteObject,
  relation: "admins",
  holder: { subject: "Principal", principal },
});

const tenantGrant = (
  partition: Partition,
  relation: string,
  holder: ProjectGrantSubject,
): ProjectGrant => ({
  namespace: projectAccessTenantNamespace,
  object: projectAccessTenantObject(partition.tenant),
  relation,
  holder,
});

/** The holders of one role on the partition's tenant. */
const tenantHolders = (
  partition: Partition,
  relation: "admins" | "members",
): ProjectGrantSubject => ({
  subject: "Holders",
  namespace: projectAccessTenantNamespace,
  object: projectAccessTenantObject(partition.tenant),
  relation,
});

async function written(named: readonly ProjectGrant[]): Promise<void> {
  for (const grant of named) await grants.write(grant);
}

/** A project under its tenant with the defaults of both, and the site's beside them. */
async function defaulted(partition: Partition): Promise<void> {
  await ketoHarnessSiteDefaults();
  await written([
    projectTenantGrant(partition),
    ...tenantAuthorityDefaults(partition.tenant),
    ...projectAuthorityDefaults(partition),
  ]);
}

/** Runs a case with a site administrator of its own, removed however the case ends. */
async function withSiteAdministrator(
  run: (administrator: Principal) => Promise<void>,
): Promise<void> {
  const administrator = someone("site-admin");
  await grants.write(siteAdministratorGrant(administrator));
  try {
    await run(administrator);
  } finally {
    await grants.remove(siteAdministratorGrant(administrator));
  }
}

const everyProjectAuthority: readonly ProjectAccessKind[] = [
  "GrantProjectAdmin",
  "GrantDeveloper",
  "GrantDispatcher",
  "ManageProjectAuthorities",
];

/**
 * The administrators of another project in the partition's tenant and of
 * another tenant, each with its defaults, who hold nothing in the partition.
 */
async function neighbours(
  partition: Partition,
): Promise<Readonly<Record<string, Principal>>> {
  const sibling = {
    tenant: partition.tenant,
    project: asProjectId(`sibling-${randomUUID()}`),
  };
  await written([
    projectTenantGrant(sibling),
    ...projectAuthorityDefaults(sibling),
  ]);
  const elsewhere = ketoHarnessPartition("authority-elsewhere");
  await defaulted(elsewhere);
  const otherTenantAdministrator = someone("other-tenant-admin");
  const siblingAdministrator = someone("sibling-admin");
  await written([
    tenantAdministratorGrant(otherTenantAdministrator, elsewhere.tenant),
    projectRelationGrant(siblingAdministrator, sibling, "admins"),
  ]);
  return { otherTenantAdministrator, siblingAdministrator };
}

test("the defaults give each role exactly the authority they say, and nobody else any", async () => {
  const partition = ketoHarnessPartition("authority-defaults");
  await defaulted(partition);
  const tenantAdministrator = someone("tenant-admin");
  const projectAdministrator = someone("project-admin");
  const member = someone("member");
  const developer = someone("developer");
  const stranger = someone("stranger");
  const memberGranter = someone("member-granter");
  await written([
    tenantAdministratorGrant(tenantAdministrator, partition.tenant),
    projectRelationGrant(projectAdministrator, partition, "admins"),
    tenantGrant(partition, "members", {
      subject: "Principal",
      principal: member,
    }),
    projectRelationGrant(developer, partition, "developers"),
    tenantGrant(partition, "member_granters", {
      subject: "Principal",
      principal: memberGranter,
    }),
  ]);

  await withSiteAdministrator(async (siteAdministrator) => {
    assert.deepEqual(await authorityHeld(siteAdministrator, partition), {
      site: ["AdministerSite", "CreateAccount", "ManageSiteAuthorities"],
      tenant: [
        "GrantHostedExecution",
        "ManageTenantAuthorities",
        "ManageSiteHeldAuthorities",
      ],
      project: ["ManageProjectAuthorities"],
    });
  });
  assert.deepEqual(await authorityHeld(tenantAdministrator, partition), {
    site: [],
    tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
    project: everyProjectAuthority,
  });
  assert.deepEqual(await authorityHeld(projectAdministrator, partition), {
    ...heldNothing,
    project: everyProjectAuthority,
  });
  assert.deepEqual(await authorityHeld(memberGranter, partition), {
    ...heldNothing,
    tenant: ["GrantMember"],
  });
  for (const [who, principal] of Object.entries({
    member,
    developer,
    stranger,
    ...(await neighbours(partition)),
  }))
    assert.deepEqual(
      await authorityHeld(principal, partition),
      heldNothing,
      who,
    );
});

test("a tenant with no site tuple is not managed from the site, and the site's administrators still grant hosted runs there", async () => {
  await ketoHarnessSiteDefaults();
  const partition = ketoHarnessPartition("authority-unsited");
  await written([
    projectTenantGrant(partition),
    ...tenantAuthorityDefaults(partition.tenant).filter(
      (grant) => grant.relation !== tenantSiteRelation,
    ),
    ...projectAuthorityDefaults(partition),
  ]);
  const tenantAdministrator = someone("unsited-admin");
  await grants.write(
    tenantAdministratorGrant(tenantAdministrator, partition.tenant),
  );
  assert.deepEqual(await authorityHeld(tenantAdministrator, partition), {
    site: [],
    tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
    project: everyProjectAuthority,
  });
  await withSiteAdministrator(async (siteAdministrator) => {
    const held = await authorityHeld(siteAdministrator, partition);
    assert.deepEqual(held.tenant, ["GrantHostedExecution"]);
    assert.deepEqual(held.project, []);
  });
});

test("with no tuple of the new relations nobody holds any authority, a person holding every role included", async () => {
  const partition = ketoHarnessPartition("authority-none");
  await grants.write(projectTenantGrant(partition));
  const everything = someone("every-role");
  await written([
    ...allTenantGrantRelations.map((relation) =>
      tenantGrant(partition, relation, {
        subject: "Principal",
        principal: everything,
      }),
    ),
    ...allProjectGrantRelations.map((relation) =>
      projectRelationGrant(everything, partition, relation),
    ),
  ]);
  assert.deepEqual(await authorityHeld(everything, partition), heldNothing);
  await withSiteAdministrator(async (siteAdministrator) => {
    const held = await authorityHeld(siteAdministrator, partition);
    assert.deepEqual(held.tenant, []);
    assert.deepEqual(held.project, []);
  });
});

test("one role's holders are added and removed alone, leaving a person and another role's holders", async () => {
  const partition = ketoHarnessPartition("authority-holders");
  const administrator = someone("holders-admin");
  const member = someone("holders-member");
  const direct = someone("holders-direct");
  await written([
    tenantAdministratorGrant(administrator, partition.tenant),
    tenantGrant(partition, "members", {
      subject: "Principal",
      principal: member,
    }),
  ]);
  const grantsMember = async (principal: Principal): Promise<boolean> =>
    (await access.authorizeTenant(
      principal,
      partition.tenant,
      "GrantMember",
    )) !== undefined;
  const members = tenantGrant(
    partition,
    "member_granters",
    tenantHolders(partition, "members"),
  );

  await grants.write(members);
  assert.equal(await grantsMember(member), true);
  assert.equal(await grantsMember(administrator), false);
  await grants.remove(members);
  assert.equal(await grantsMember(member), false);

  await written([
    members,
    tenantGrant(
      partition,
      "member_granters",
      tenantHolders(partition, "admins"),
    ),
    tenantGrant(partition, "member_granters", {
      subject: "Principal",
      principal: direct,
    }),
  ]);
  assert.equal(await grantsMember(member), true);
  await grants.remove(members);
  assert.equal(await grantsMember(member), false);
  assert.equal(await grantsMember(administrator), true);
  assert.equal(await grantsMember(direct), true);
});
