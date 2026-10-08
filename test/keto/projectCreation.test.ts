/**
 * What creating a project grants, asked of the authority the API authorizes
 * with: the creator of a new tenant reaches every kind on the project and
 * administers the tenant, a project added later is reached through the tenant
 * alone, a tenant tuples hold is nobody else's to make, and a repeat by the
 * creator writes the grants only until the door records them, so restores no
 * default removed after that.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresProjectCreation } from "../../src/adapters/postgres/projectCreation.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import {
  allProjectAccessKinds,
  allTenantAccessKinds,
  memberAuthority,
  type ProjectAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectCreation,
  projectCreationGrants,
  type TenantStanding,
} from "../../src/interpreter/projectCreation.ts";
import {
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
} from "../../src/interpreter/projectGrant.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { postgresHarnessRolePool } from "../postgres/harness.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAuthorityHeld,
  ketoHarnessClaims,
  ketoHarnessGrants,
  ketoHarnessHeldNothing,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessProjectAuthorities,
  ketoHarnessSomeone,
  ketoHarnessWithSiteAdministrator,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const apiPool = postgresHarnessRolePool(apiRole);
after(() => apiPool.end());
const store = postgresProjectCreation(apiPool);
const service = projectCreation({
  access,
  claims: ketoHarnessClaims(),
  store,
  grants,
});

/** A creation the name rule takes, which the harness's partitions are not. */
function namedCreation(label: string) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 24);
  return {
    tenant: asTenantId(`${label}-${suffix}`),
    project: asProjectId("chuggy"),
    operation: asOperationId(`operation-${randomUUID()}`),
  };
}

/** A creation the door committed and whose grants were never written, as an API that stopped between the two leaves it. */
async function committedOnly(
  creator: Principal,
  request: ReturnType<typeof namedCreation>,
  standing: TenantStanding,
): Promise<void> {
  const answer = await store.create({
    partition: request,
    standing,
    reserved: false,
    operation: request.operation,
    authority: memberAuthority(creator),
  });
  assert.equal(answer.outcome, "Created");
}

async function administers(
  principal: Principal,
  partition: Partition,
): Promise<boolean> {
  return (
    (await access.authorizeTenant(
      principal,
      partition.tenant,
      "AdministerTenant",
    )) !== undefined
  );
}

async function held(
  principal: Principal,
  partition: Partition,
): Promise<readonly ProjectAccessKind[]> {
  const found: ProjectAccessKind[] = [];
  for (const kind of allProjectAccessKinds)
    if ((await access.authorize(principal, partition, kind)) !== undefined)
      found.push(kind);
  return found;
}

async function created(
  principal: Principal,
  partition: Partition,
  tenantCreated: boolean,
  selector?: Principal,
): Promise<void> {
  await grants.writeAll(
    projectCreationGrants(principal, partition, tenantCreated, selector),
  );
}

test("a new tenant's creator holds every kind on its project and administers the tenant, and nobody else does", async () => {
  const partition = ketoHarnessPartition("created");
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const stranger = oidcPrincipal(ketoHarnessIssuer, `stranger-${randomUUID()}`);
  await created(creator, partition, true);
  assert.deepEqual(await held(creator, partition), allProjectAccessKinds);
  assert.notEqual(
    await access.authorizeTenant(creator, partition.tenant, "AdministerTenant"),
    undefined,
  );
  assert.deepEqual(await held(stranger, partition), []);
  assert.equal(
    await access.authorizeTenant(
      stranger,
      partition.tenant,
      "AdministerTenant",
    ),
    undefined,
  );
});

test("a site's selector develops each project made under it, and administers neither the project nor its tenant", async () => {
  const partition = ketoHarnessPartition("selected");
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const selector = oidcPrincipal(ketoHarnessIssuer, `selector-${randomUUID()}`);
  await created(creator, partition, true, selector);
  assert.deepEqual(await held(selector, partition), [
    "Read",
    "Mutate",
    "ProposeDispatch",
    "Execute",
  ]);
  assert.equal(await administers(selector, partition), false);
});

test("a project added to a tenant that stands is reached through the tenant's administrators", async () => {
  const first = ketoHarnessPartition("added");
  const second = { ...first, project: asProjectId(`second-${randomUUID()}`) };
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  await created(creator, first, true);
  await created(creator, second, false);
  assert.deepEqual(await held(creator, second), allProjectAccessKinds);
});

test("a replay of a creation whose grants were never written writes them", async () => {
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const request = namedCreation("unwritten");
  await committedOnly(creator, request, "Unclaimed");
  assert.equal(await administers(creator, request), false);
  assert.equal(
    (await service.create(creator, request)).result,
    "AlreadyCreated",
  );
  assert.equal(await administers(creator, request), true);
  assert.deepEqual(await held(creator, request), allProjectAccessKinds);
});

test("a replay after the grants are recorded restores no grant an operator revoked", async () => {
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const request = namedCreation("revoked");
  assert.equal((await service.create(creator, request)).result, "Created");
  await grants.remove(tenantAdministratorGrant(creator, request.tenant));
  assert.equal(await administers(creator, request), false);
  assert.equal(
    (await service.create(creator, request)).result,
    "AlreadyCreated",
  );
  assert.equal(await administers(creator, request), false);
  assert.deepEqual(await held(creator, request), []);
});

test("a tenant an operator granted before its rows exist is not a stranger's to make", async () => {
  const alice = oidcPrincipal(ketoHarnessIssuer, `alice-${randomUUID()}`);
  const mallory = oidcPrincipal(ketoHarnessIssuer, `mallory-${randomUUID()}`);
  const request = namedCreation("granted");
  await grants.write(tenantAdministratorGrant(alice, request.tenant));
  assert.equal((await service.create(mallory, request)).result, "TenantTaken");
  assert.equal(await administers(mallory, request), false);
  const real = { ...namedCreation("real"), tenant: request.tenant };
  assert.equal((await service.create(alice, real)).result, "Created");
  assert.deepEqual(await held(mallory, real), []);
  assert.deepEqual(await held(alice, real), allProjectAccessKinds);
});

test("a project a person was provisioned on holds its tenant against a stranger asking for it or any other project in it", async () => {
  for (const relation of ["developers", "admins"]) {
    const subject = `bob-${randomUUID()}`;
    const bob = oidcPrincipal(ketoHarnessIssuer, subject);
    const mallory = oidcPrincipal(ketoHarnessIssuer, `mallory-${randomUUID()}`);
    const provisioned = namedCreation(relation);
    for (const grant of [
      projectPrincipalGrant({
        issuer: ketoHarnessIssuer,
        subject,
        tenant: provisioned.tenant,
        project: provisioned.project,
        relation,
      }),
      projectTenantGrant(provisioned),
    ])
      await grants.write(grant);
    const before = await held(bob, provisioned);
    const other = {
      ...namedCreation(relation),
      tenant: provisioned.tenant,
      project: asProjectId("other"),
    };
    for (const request of [provisioned, other, provisioned])
      assert.equal(
        (await service.create(mallory, request)).result,
        "TenantTaken",
        relation,
      );
    assert.equal(await administers(mallory, provisioned), false, relation);
    assert.deepEqual(await held(mallory, provisioned), [], relation);
    assert.deepEqual(await held(bob, provisioned), before, relation);
  }
});

test("a creator whose grants never landed is answered its own tenant under a new identity, and granted it", async () => {
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const request = namedCreation("reloaded");
  await committedOnly(creator, request, "Unclaimed");
  const again = {
    ...request,
    operation: asOperationId(`operation-${randomUUID()}`),
  };
  assert.equal((await service.create(creator, again)).result, "AlreadyCreated");
  assert.equal(await administers(creator, request), true);
  assert.deepEqual(await held(creator, request), allProjectAccessKinds);
  const replayed = await store.create({
    partition: request,
    standing: "Administers",
    reserved: false,
    operation: request.operation,
    authority: memberAuthority(creator),
  });
  assert.equal(replayed.grantsWritten, true);
});

test("a creator whose project in a standing tenant never reached it is answered that project under a new identity, and granted it", async () => {
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const first = namedCreation("standing");
  assert.equal((await service.create(creator, first)).result, "Created");
  const second = {
    ...namedCreation("second"),
    tenant: first.tenant,
    project: asProjectId("second"),
  };
  await committedOnly(creator, second, "Administers");
  assert.deepEqual(await held(creator, second), []);
  const again = {
    ...second,
    operation: asOperationId(`operation-${randomUUID()}`),
  };
  assert.equal((await service.create(creator, again)).result, "AlreadyCreated");
  assert.deepEqual(await held(creator, second), allProjectAccessKinds);
});

test("anyone else asking for a creation whose grants never landed is refused it and granted nothing", async () => {
  const creator = oidcPrincipal(ketoHarnessIssuer, `creator-${randomUUID()}`);
  const mallory = oidcPrincipal(ketoHarnessIssuer, `mallory-${randomUUID()}`);
  const request = namedCreation("unlanded");
  await committedOnly(creator, request, "Unclaimed");
  const taken = {
    ...request,
    operation: asOperationId(`operation-${randomUUID()}`),
  };
  assert.equal((await service.create(mallory, taken)).result, "TenantTaken");
  assert.equal(await administers(mallory, request), false);
  assert.equal(await administers(creator, request), false);
});

/** Every tenant kind the principal holds on the partition's tenant. */
async function tenantHeld(
  principal: Principal,
  partition: Partition,
): Promise<readonly TenantAccessKind[]> {
  const found: TenantAccessKind[] = [];
  for (const kind of allTenantAccessKinds)
    if (
      (await access.authorizeTenant(principal, partition.tenant, kind)) !==
      undefined
    )
      found.push(kind);
  return found;
}

test("a created tenant and project give their creator and the site's administrators their authority, and nobody else any", async () => {
  const creator = ketoHarnessSomeone("authority-creator");
  const stranger = ketoHarnessSomeone("authority-stranger");
  const request = namedCreation("authority");
  assert.equal((await service.create(creator, request)).result, "Created");
  assert.deepEqual(await ketoHarnessAuthorityHeld(creator, request), {
    site: [],
    tenant: ["GrantTenantAdmin", "GrantMember", "ManageTenantAuthorities"],
    project: ketoHarnessProjectAuthorities,
  });
  assert.deepEqual(
    await ketoHarnessAuthorityHeld(stranger, request),
    ketoHarnessHeldNothing,
  );
  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    const held = await ketoHarnessAuthorityHeld(siteAdministrator, request);
    assert.deepEqual(held.tenant, [
      "GrantHostedExecution",
      "ManageTenantAuthorities",
      "ManageSiteHeldAuthorities",
    ]);
    assert.deepEqual(held.project, ["ManageProjectAuthorities"]);
  });
});

test("a project created in a tenant that stands gets the project's defaults, and nothing on the tenant answers differently", async () => {
  await ketoHarnessWithSiteAdministrator(async (siteAdministrator) => {
    const creator = ketoHarnessSomeone("standing-creator");
    const stranger = ketoHarnessSomeone("standing-stranger");
    const first = namedCreation("first");
    assert.equal((await service.create(creator, first)).result, "Created");
    const people = [creator, stranger, siteAdministrator];
    const before = await Promise.all(
      people.map((person) => tenantHeld(person, first)),
    );
    const second = {
      ...namedCreation("second"),
      tenant: first.tenant,
      project: asProjectId("second"),
    };
    assert.equal((await service.create(creator, second)).result, "Created");
    assert.deepEqual(
      await Promise.all(people.map((person) => tenantHeld(person, first))),
      before,
    );
    assert.deepEqual(
      (await ketoHarnessAuthorityHeld(creator, second)).project,
      ketoHarnessProjectAuthorities,
    );
    assert.deepEqual(
      (await ketoHarnessAuthorityHeld(siteAdministrator, second)).project,
      ["ManageProjectAuthorities"],
    );
  });
});

test("a repeat after the grants are recorded restores no default removed in between", async () => {
  const creator = ketoHarnessSomeone("defaults-removed");
  const request = namedCreation("unrestored");
  assert.equal((await service.create(creator, request)).result, "Created");
  for (const grant of [
    ...tenantAuthorityDefaults(request.tenant),
    ...projectAuthorityDefaults(request),
  ].filter(
    (one) =>
      one.relation === "member_granters" || one.relation === "admin_granters",
  ))
    await grants.remove(grant);
  const removed = {
    site: [],
    tenant: ["ManageTenantAuthorities"],
    project: ["GrantDeveloper", "GrantDispatcher", "ManageProjectAuthorities"],
  };
  assert.deepEqual(await ketoHarnessAuthorityHeld(creator, request), removed);
  assert.equal(
    (await service.create(creator, request)).result,
    "AlreadyCreated",
  );
  assert.deepEqual(await ketoHarnessAuthorityHeld(creator, request), removed);
});
