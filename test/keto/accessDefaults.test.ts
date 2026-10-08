/**
 * The command giving what exists its defaults, run as a process against a real
 * authority over a tenant written as the tree wrote one before creations wrote
 * defaults: what a run without the variable leaves, what a run with it makes
 * each person able to do, and what a second run and a removed holder come to.
 *
 * Every case names a tenant, because the gate's authority is shared and keeps
 * its tuples; what a run with none named considers is the in-memory suite's.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allTenantAuthorityRelations,
  projectRelationGrant,
  projectTenantGrant,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  tenantSiteRelation,
} from "../../src/interpreter/projectGrant.ts";
import {
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  ketoHarnessAuthorityHeld,
  ketoHarnessClaims,
  ketoHarnessCommand,
  ketoHarnessGrants,
  ketoHarnessHeldNothing,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessProjectAuthorities,
  ketoHarnessReadUrl,
  ketoHarnessSomeone,
  ketoHarnessWithSiteAdministrator,
  type KetoHarnessAuthority,
} from "./harness.ts";

const grants = ketoHarnessGrants();

/** The command for one tenant, applying where `apply` says to. */
const provisioned = (partition: Partition, apply: boolean) =>
  ketoHarnessCommand("src/roots/provisionAccessDefaults.ts", {
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_APPLY: apply ? "1" : "",
  });

/** A tenant as the tree wrote one before: an administrator, a member, and two linked projects with a role each. */
interface Existing {
  readonly web: Partition;
  readonly api: Partition;
  readonly people: Readonly<Record<string, Principal>>;
}

async function existing(label: string): Promise<Existing> {
  const web = ketoHarnessPartition(label);
  const api = { ...web, project: asProjectId(`api-${randomUUID()}`) };
  const memberSubject = `existing-member-${randomUUID()}`;
  const people = {
    administrator: ketoHarnessSomeone("existing-admin"),
    member: oidcPrincipal(ketoHarnessIssuer, memberSubject),
    developer: ketoHarnessSomeone("existing-developer"),
    projectAdministrator: ketoHarnessSomeone("existing-project-admin"),
  };
  await grants.writeAll([
    tenantAdministratorGrant(people.administrator, web.tenant),
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: memberSubject,
      tenant: web.tenant,
      relation: "members",
    }),
    projectTenantGrant(web),
    projectRelationGrant(people.developer, web, "developers"),
    projectTenantGrant(api),
    projectRelationGrant(people.projectAdministrator, api, "admins"),
  ]);
  return { web, api, people };
}

/** What each person holds of the authority kinds on each project, the site's kinds aside. */
async function heldBy(
  tenant: Existing,
): Promise<Readonly<Record<string, readonly KetoHarnessAuthority[]>>> {
  const held: Record<string, KetoHarnessAuthority[]> = {};
  for (const [who, principal] of Object.entries(tenant.people)) {
    held[who] = [];
    for (const partition of [tenant.web, tenant.api]) {
      const one = await ketoHarnessAuthorityHeld(principal, partition);
      held[who].push({ ...one, site: [] });
    }
  }
  return held;
}

const tenantAdministration: KetoHarnessAuthority = {
  site: [],
  tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
  project: ketoHarnessProjectAuthorities,
};

const projectAdministration: KetoHarnessAuthority = {
  ...ketoHarnessHeldNothing,
  project: ketoHarnessProjectAuthorities,
};

/** The lines a run reports for the tenant and its projects, the site's aside. */
function linesOf(output: string, tenant: Existing): readonly string[] {
  const named = [
    `Tenant:${projectAccessTenantObject(tenant.web.tenant)}`,
    `Project:${projectAccessObject(tenant.web)}`,
    `Project:${projectAccessObject(tenant.api)}`,
  ];
  return output
    .split("\n")
    .filter((line) => named.some((name) => line.includes(` ${name}`)))
    .map((line) => line.split(" ")[0] ?? "");
}

test("a run without the variable reports what it would give and gives nothing", async () => {
  const tenant = await existing("defaults-dry");
  const ran = await provisioned(tenant.web, false);
  assert.equal(ran.code, 0, ran.output);
  assert.deepEqual(linesOf(ran.output, tenant), [
    "defaults",
    "defaults",
    "defaults",
  ]);
  assert.match(ran.output, /wrote nothing; CHUG_PROVISION_APPLY=1 writes/u);
  for (const [who, held] of Object.entries(await heldBy(tenant)))
    assert.deepEqual(
      held,
      [ketoHarnessHeldNothing, ketoHarnessHeldNothing],
      who,
    );
  for (const principal of Object.values(tenant.people))
    assert.ok(!ran.output.includes(principal), principal);
});

test("a run with it gives every person the authority the defaults say, and a second run leaves it all", async () => {
  const tenant = await existing("defaults-applied");
  const first = await provisioned(tenant.web, true);
  assert.equal(first.code, 0, first.output);
  const expected = {
    administrator: [tenantAdministration, tenantAdministration],
    member: [ketoHarnessHeldNothing, ketoHarnessHeldNothing],
    developer: [ketoHarnessHeldNothing, ketoHarnessHeldNothing],
    projectAdministrator: [ketoHarnessHeldNothing, projectAdministration],
  };
  assert.deepEqual(await heldBy(tenant), expected);
  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    for (const partition of [tenant.web, tenant.api]) {
      const held = await ketoHarnessAuthorityHeld(siteAdministrator, partition);
      assert.deepEqual(held.tenant, [
        "GrantHostedExecution",
        "ManageTenantAuthorities",
        "ManageSiteHeldAuthorities",
      ]);
      assert.deepEqual(held.project, ["ManageProjectAuthorities"]);
    }
  });
  const second = await provisioned(tenant.web, true);
  assert.equal(second.code, 0, second.output);
  assert.deepEqual(linesOf(second.output, tenant), ["left", "left", "left"]);
  assert.deepEqual(await heldBy(tenant), expected);
});

test("a default holder removed after a run is left removed by the next", async () => {
  const tenant = await existing("defaults-removed");
  assert.equal((await provisioned(tenant.web, true)).code, 0);
  const [granters] = tenantAuthorityDefaults(tenant.web.tenant).filter(
    (grant) => grant.relation === "member_granters",
  );
  assert.ok(granters !== undefined);
  await grants.remove(granters);
  const again = await provisioned(tenant.web, true);
  assert.equal(again.code, 0, again.output);
  assert.deepEqual(
    (await heldBy(tenant))["administrator"]?.map((held) => held.tenant),
    [
      ["GrantTenantAdmin", "ManageTenantAuthorities"],
      ["GrantTenantAdmin", "ManageTenantAuthorities"],
    ],
  );
});

/** Whether the tenant holds a tuple of any relation a run would write to it. */
async function tenantWritten(partition: Partition): Promise<boolean> {
  for (const relation of [tenantSiteRelation, ...allTenantAuthorityRelations]) {
    const url = new URL("relation-tuples", ketoHarnessReadUrl());
    url.searchParams.set("namespace", projectAccessTenantNamespace);
    url.searchParams.set("object", projectAccessTenantObject(partition.tenant));
    url.searchParams.set("relation", relation);
    const listed = (await (await fetch(url)).json()) as {
      relation_tuples: unknown[];
    };
    if (listed.relation_tuples.length > 0) return true;
  }
  return false;
}

test("a tenant with no administrator is reported, written nothing, and held exactly as before", async () => {
  const claims = ketoHarnessClaims();
  const membered = ketoHarnessPartition("defaults-unadministered");
  await grants.write(
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: `member-${randomUUID()}`,
      tenant: membered.tenant,
      relation: "members",
    }),
  );
  const untouched = ketoHarnessPartition("defaults-untouched");
  for (const [partition, claimed] of [
    [membered, true],
    [untouched, false],
  ] as const) {
    assert.equal(await claims.claimed(partition.tenant), claimed);
    const ran = await provisioned(partition, true);
    assert.equal(ran.code, 0, ran.output);
    assert.ok(
      ran.output.includes(
        `skipped Tenant:${projectAccessTenantObject(partition.tenant)}: no administrator`,
      ),
      ran.output,
    );
    assert.equal(await tenantWritten(partition), false);
    assert.equal(await claims.claimed(partition.tenant), claimed);
  }
});
