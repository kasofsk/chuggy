/**
 * What creating a project grants, asked of the authority the API authorizes
 * with: the creator of a new tenant reaches every kind on the project and
 * administers the tenant, a project added later is reached through the tenant
 * alone, and a replay writes the grants only until the door records them.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresProjectCreation } from "../../src/adapters/postgres/projectCreation.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import {
  allProjectAccessKinds,
  memberAuthority,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectCreation,
  projectCreationGrants,
} from "../../src/interpreter/projectCreation.ts";
import { tenantAdministratorGrant } from "../../src/interpreter/projectGrant.ts";
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
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const apiPool = postgresHarnessRolePool(apiRole);
after(() => apiPool.end());
const store = postgresProjectCreation(apiPool);
const service = projectCreation({ access, store, grants });

/** A creation the name rule takes, which the harness's partitions are not. */
function namedCreation(label: string) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 24);
  return {
    tenant: asTenantId(`${label}-${suffix}`),
    project: asProjectId("chuggy"),
    operation: asOperationId(`operation-${randomUUID()}`),
  };
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
): Promise<void> {
  for (const grant of projectCreationGrants(
    principal,
    partition,
    tenantCreated,
  ))
    await grants.write(grant);
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
  await store.create({
    partition: request,
    tenantNew: true,
    operation: request.operation,
    authority: memberAuthority(creator),
  });
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
