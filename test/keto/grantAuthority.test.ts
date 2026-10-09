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
  projectAccessNamespace,
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type SiteAccessKind,
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
import type { Principal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAuthorityHeld,
  ketoHarnessGrants,
  ketoHarnessHeldNothing,
  ketoHarnessPartition,
  ketoHarnessProjectAuthorities,
  ketoHarnessSiteDefaults,
  ketoHarnessSomeone,
  ketoHarnessWithSiteAdministrator,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();

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
  const otherTenantAdministrator = ketoHarnessSomeone("other-tenant-admin");
  const siblingAdministrator = ketoHarnessSomeone("sibling-admin");
  await written([
    tenantAdministratorGrant(otherTenantAdministrator, elsewhere.tenant),
    projectRelationGrant(siblingAdministrator, sibling, "admins"),
  ]);
  return { otherTenantAdministrator, siblingAdministrator };
}

/** Every site kind the site's administrators hold under its defaults. */
const siteAdministratorKinds: readonly SiteAccessKind[] = [
  "AdministerSite",
  "CreateAccount",
  "CreateTenant",
  "ManageSiteAuthorities",
];

test("the defaults give each role exactly the authority they say, and nobody else any", async () => {
  const partition = ketoHarnessPartition("authority-defaults");
  await defaulted(partition);
  const tenantAdministrator = ketoHarnessSomeone("tenant-admin");
  const projectAdministrator = ketoHarnessSomeone("project-admin");
  const member = ketoHarnessSomeone("member");
  const developer = ketoHarnessSomeone("developer");
  const stranger = ketoHarnessSomeone("stranger");
  const memberGranter = ketoHarnessSomeone("member-granter");
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

  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    assert.deepEqual(
      await ketoHarnessAuthorityHeld(siteAdministrator, partition),
      {
        site: siteAdministratorKinds,
        tenant: [
          "GrantHostedExecution",
          "ManageTenantAuthorities",
          "ManageSiteHeldAuthorities",
        ],
        project: ["ManageProjectAuthorities"],
      },
    );
  });
  assert.deepEqual(
    await ketoHarnessAuthorityHeld(tenantAdministrator, partition),
    {
      site: [],
      tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
      project: ketoHarnessProjectAuthorities,
    },
  );
  assert.deepEqual(
    await ketoHarnessAuthorityHeld(projectAdministrator, partition),
    {
      ...ketoHarnessHeldNothing,
      project: ketoHarnessProjectAuthorities,
    },
  );
  assert.deepEqual(await ketoHarnessAuthorityHeld(memberGranter, partition), {
    ...ketoHarnessHeldNothing,
    tenant: ["GrantMember"],
  });
  for (const [who, principal] of Object.entries({
    member,
    developer,
    stranger,
    ...(await neighbours(partition)),
  }))
    assert.deepEqual(
      await ketoHarnessAuthorityHeld(principal, partition),
      ketoHarnessHeldNothing,
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
  const tenantAdministrator = ketoHarnessSomeone("unsited-admin");
  await grants.write(
    tenantAdministratorGrant(tenantAdministrator, partition.tenant),
  );
  assert.deepEqual(
    await ketoHarnessAuthorityHeld(tenantAdministrator, partition),
    {
      site: [],
      tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
      project: ketoHarnessProjectAuthorities,
    },
  );
  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    const held = await ketoHarnessAuthorityHeld(siteAdministrator, partition);
    assert.deepEqual(held.tenant, ["GrantHostedExecution"]);
    assert.deepEqual(held.project, []);
  });
});

test("with no tuple of the new relations nobody holds any authority, a person holding every role included", async () => {
  const partition = ketoHarnessPartition("authority-none");
  await grants.write(projectTenantGrant(partition));
  const everything = ketoHarnessSomeone("every-role");
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
  assert.deepEqual(
    await ketoHarnessAuthorityHeld(everything, partition),
    ketoHarnessHeldNothing,
  );
  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    const held = await ketoHarnessAuthorityHeld(siteAdministrator, partition);
    assert.deepEqual(held.tenant, []);
    assert.deepEqual(held.project, []);
  });
});

test("one role's holders are added and removed alone, leaving a person and another role's holders", async () => {
  const partition = ketoHarnessPartition("authority-holders");
  const administrator = ketoHarnessSomeone("holders-admin");
  const member = ketoHarnessSomeone("holders-member");
  const direct = ketoHarnessSomeone("holders-direct");
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

test("on a project given its defaults a developer and a viewer may not grant `Viewer`, and a developer may while the project's developers hold `viewer_granters`", async () => {
  const partition = ketoHarnessPartition("authority-viewers");
  await defaulted(partition);
  const developer = ketoHarnessSomeone("viewers-developer");
  const viewer = ketoHarnessSomeone("viewers-viewer");
  await written([
    projectRelationGrant(developer, partition, "developers"),
    projectRelationGrant(viewer, partition, "viewers"),
  ]);
  const grantsViewer = async (principal: Principal): Promise<boolean> =>
    (await access.authorize(principal, partition, "GrantViewer")) !== undefined;
  const developers: ProjectGrant = {
    namespace: projectAccessNamespace,
    object: projectAccessObject(partition),
    relation: "viewer_granters",
    holder: {
      subject: "Holders",
      namespace: projectAccessNamespace,
      object: projectAccessObject(partition),
      relation: "developers",
    },
  };
  assert.deepEqual(
    [await grantsViewer(developer), await grantsViewer(viewer)],
    [false, false],
  );
  await grants.write(developers);
  assert.deepEqual(
    [await grantsViewer(developer), await grantsViewer(viewer)],
    [true, false],
  );
  await grants.remove(developers);
  assert.equal(await grantsViewer(developer), false);
});
