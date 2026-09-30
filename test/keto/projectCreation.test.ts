/**
 * What creating a project grants, asked of the authority the API authorizes
 * with: the creator of a new tenant reaches every kind on the project and
 * administers the tenant, and a project added later is reached through the
 * tenant alone.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allProjectAccessKinds,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { projectCreationGrants } from "../../src/interpreter/projectCreation.ts";
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
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();

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
