/**
 * Who holds each authority, against a real authority: the defaults read back
 * as groups, a holder written by hand named or counted, and who is answered
 * each level's list as the model decides who manages it.
 *
 * THE SITE IS SHARED, so its list is asserted for what a case put there and
 * never for what is absent, and what a case writes on it is removed however
 * the case ends.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { accessAuthorities } from "../../src/interpreter/accessAuthorities.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
} from "../../src/interpreter/accessPlane.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import type { TenantId } from "../../src/interpreter/projectStore.ts";
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
const authorities = accessAuthorities(
  { access, tuples },
  { issuer: ketoHarnessIssuer, bounds: accessPlaneBoundsDefault },
);
const plane = accessPlane(
  { access, tuples, grants },
  { issuer: ketoHarnessIssuer, bounds: accessPlaneBoundsDefault },
);
const alice = oidcPrincipal(ketoHarnessIssuer, "alice");
const priya = oidcPrincipal(ketoHarnessIssuer, "priya");

/** One person's relation on `tenant`, which may be a relation saying who may grant. */
function personOn(
  tenant: TenantId,
  subject: string,
  relation: string,
): ProjectGrant {
  return {
    ...tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant,
      relation: "admins",
    }),
    relation,
  };
}

/** The holders of `holders` on `tenant`, written into `relation` of `object` in `namespace`. */
function tenantHolders(
  namespace: string,
  object: string,
  relation: string,
  tenant: TenantId,
  holders: "admins" | "members",
): ProjectGrant {
  return {
    namespace,
    object,
    relation,
    holder: {
      subject: "Holders",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      relation: holders,
    },
  };
}

/**
 * A fresh tenant alice administers with one linked project priya administers,
 * the site, the tenant and the project carrying their defaults.
 */
async function tenantOf(label: string) {
  const web = ketoHarnessPartition(label);
  await ketoHarnessSiteDefaults();
  for (const grant of [
    projectTenantGrant(web),
    ...tenantAuthorityDefaults(web.tenant),
    ...projectAuthorityDefaults(web),
    personOn(web.tenant, "alice", "admins"),
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "priya",
      ...web,
      relation: "admins",
    }),
  ])
    await grants.write(grant);
  return { web, tenant: web.tenant };
}

/** Each authority's groups and people's subjects, by authority. */
function heldOf(
  answered:
    | {
        readonly authorities: readonly {
          readonly authority: string;
          readonly groups: readonly string[];
          readonly people: readonly { readonly subject: string }[];
          readonly unnamed: number;
        }[];
      }
    | undefined,
) {
  return Object.fromEntries(
    (answered?.authorities ?? []).map((held) => [
      held.authority,
      {
        groups: held.groups,
        people: held.people.map((person) => person.subject),
        unnamed: held.unnamed,
      },
    ]),
  );
}

test("the defaults read back as groups: the tenant's own administrators and the site's, and the project's and its tenant's", async () => {
  const { web, tenant } = await tenantOf("authorities-defaults");
  const only = (groups: readonly string[]) => ({
    groups,
    people: [],
    unnamed: 0,
  });
  assert.deepEqual(heldOf(await authorities.tenantAuthorities(alice, tenant)), {
    AdminGranters: only(["TenantAdmins"]),
    MemberGranters: only(["TenantAdmins"]),
    HostedRunsGranters: only(["SiteAdmins"]),
    AuthorityManagers: only(["TenantAdmins"]),
  });
  const both = only(["TenantAdmins", "ProjectAdmins"]);
  assert.deepEqual(heldOf(await authorities.projectAuthorities(priya, web)), {
    AdminGranters: both,
    DeveloperGranters: both,
    DispatcherGranters: both,
    ViewerGranters: both,
    AuthorityManagers: both,
  });
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    const site = await authorities.siteAuthorities(administrator);
    assert.ok(
      site?.authorities
        .find((held) => held.authority === "AccountCreators")
        ?.groups.includes("SiteAdmins"),
    );
  });
});

test("a person written twice is listed once, a tenant's administrators on the site are named by the tenant, and what no roster names is counted", async () => {
  const { tenant } = await tenantOf("authorities-named");
  const { tenant: other } = ketoHarnessPartition("authorities-other");
  const tenantObject = projectAccessTenantObject(tenant);
  for (const grant of [
    personOn(tenant, "gil", "member_granters"),
    personOn(tenant, "gil", "member_granters"),
    tenantHolders(
      projectAccessTenantNamespace,
      tenantObject,
      "admin_granters",
      other,
      "admins",
    ),
    tenantHolders(
      projectAccessTenantNamespace,
      tenantObject,
      "admin_granters",
      tenant,
      "members",
    ),
  ])
    await grants.write(grant);
  const held = heldOf(await authorities.tenantAuthorities(alice, tenant));
  assert.deepEqual(held["MemberGranters"], {
    groups: ["TenantAdmins"],
    people: ["gil"],
    unnamed: 0,
  });
  assert.deepEqual(held["AdminGranters"], {
    groups: ["TenantAdmins", "TenantMembers"],
    people: [],
    unnamed: 1,
  });
  const creators = tenantHolders(
    projectAccessSiteNamespace,
    projectAccessSiteObject,
    "account_creators",
    tenant,
    "admins",
  );
  await grants.write(creators);
  try {
    await ketoHarnessWithSiteAdministrator(async (administrator) => {
      const site = await authorities.siteAuthorities(administrator);
      assert.ok(
        site?.authorities
          .find((one) => one.authority === "AccountCreators")
          ?.tenants.includes(tenant),
      );
    });
  } finally {
    await grants.remove(creators);
  }
});

/** Whether `caller` is answered the site's, the tenant's and the project's list. */
async function answeredTo(
  caller: Principal,
  web: ReturnType<typeof ketoHarnessPartition>,
): Promise<readonly boolean[]> {
  return [
    (await authorities.siteAuthorities(caller)) !== undefined,
    (await authorities.tenantAuthorities(caller, web.tenant)) !== undefined,
    (await authorities.projectAuthorities(caller, web)) !== undefined,
  ];
}

test("the site's administrator is answered every list, a project's administrator the project's alone, and whoever manages nothing none", async () => {
  const { web, tenant } = await tenantOf("authorities-answered");
  for (const grant of [
    personOn(tenant, "gil", "member_granters"),
    personOn(tenant, "mo", "members"),
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "dev",
      ...web,
      relation: "developers",
    }),
  ])
    await grants.write(grant);
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    assert.deepEqual(await answeredTo(administrator, web), [true, true, true]);
  });
  assert.deepEqual(await answeredTo(alice, web), [false, true, true]);
  assert.deepEqual(await answeredTo(priya, web), [false, false, true]);
  for (const subject of ["gil", "mo", "dev", "stranger"])
    assert.deepEqual(
      await answeredTo(oidcPrincipal(ketoHarnessIssuer, subject), web),
      [false, false, false],
      subject,
    );
});

test("a project whose `tenant` relation holds its tenant's administrators and no link is not the tenant's", async () => {
  const { web, tenant } = await tenantOf("authorities-link");
  const held = ketoHarnessPartition("authorities-held");
  await grants.write({
    ...projectTenantGrant({ tenant, project: held.project }),
    holder: {
      subject: "Holders",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      relation: "admins",
    },
  });
  assert.deepEqual((await plane.tenantPeople(alice, tenant))?.projects, [
    web.project,
  ]);
});
