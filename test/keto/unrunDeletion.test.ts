/**
 * What deleting erases, asked of a real authority: every tuple on a project's
 * object, and for a tenant every tuple on its object, on each project still
 * naming it and held on the site by its administrators, so its name is no
 * longer claimed — and nothing of any other tenant or project.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { ketoAccessErasure } from "../../src/adapters/keto/accessErasure.ts";
import { accessOwnerInvitationGrants } from "../../src/interpreter/accessOwnerInvitation.ts";
import {
  checkedProjectAccessSettings,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import { projectCreationGrants } from "../../src/interpreter/projectCreation.ts";
import { checkedProjectGrantSettings } from "../../src/interpreter/projectGrant.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { AccessTupleQuery } from "../../src/interpreter/accessPlane.ts";
import {
  ketoHarnessClaims,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessReadUrl,
  ketoHarnessSomeone,
  ketoHarnessTuples,
  ketoHarnessWriteUrl,
} from "./harness.ts";

const erasure = ketoAccessErasure(
  checkedProjectAccessSettings({
    readUrl: ketoHarnessReadUrl(),
    requestTimeoutMs: 2_000,
  }),
  checkedProjectGrantSettings({ writeUrl: ketoHarnessWriteUrl() }),
);
const grants = ketoHarnessGrants();
const tuples = ketoHarnessTuples();

async function listed(query: AccessTupleQuery): Promise<number> {
  return (await tuples.page(query, undefined)).tuples.length;
}

function projectTuples(partition: Partition): AccessTupleQuery {
  return {
    query: "Object",
    namespace: projectAccessNamespace,
    object: projectAccessObject(partition),
  };
}

/** A workspace made as the site's invitation makes one, account creation and all, with a project created in it. */
async function workspaceWithProject(label: string): Promise<Partition> {
  const partition = ketoHarnessPartition(label);
  const subject = `owner-${randomUUID()}`;
  await grants.writeAll([
    ...accessOwnerInvitationGrants(
      ketoHarnessIssuer,
      partition.tenant,
      subject,
      true,
    ),
    ...projectCreationGrants(ketoHarnessSomeone("creator"), partition, false),
  ]);
  return partition;
}

test("a project's erasure removes every tuple on it and nothing of its tenant or of another project", async () => {
  const partition = await workspaceWithProject("project-erased");
  const sibling = { ...partition, project: asProjectId("sibling") };
  await grants.writeAll(
    projectCreationGrants(ketoHarnessSomeone("creator"), sibling, false),
  );
  assert.ok((await listed(projectTuples(partition))) > 0);
  await erasure.projectErased(partition);
  assert.equal(await listed(projectTuples(partition)), 0);
  assert.ok((await listed(projectTuples(sibling))) > 0);
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), true);
});

/** The tuples the site holds for a tenant's administrators, asked of the read API by their subject set. */
async function siteHeldBy(tenant: string): Promise<number> {
  const url = new URL("relation-tuples", ketoHarnessReadUrl());
  for (const [name, value] of Object.entries({
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    "subject_set.namespace": projectAccessTenantNamespace,
    "subject_set.object": projectAccessTenantObject(tenant),
    "subject_set.relation": "admins",
  }))
    url.searchParams.set(name, value);
  const answered = (await (await fetch(url)).json()) as {
    relation_tuples: unknown[];
  };
  return answered.relation_tuples.length;
}

test("a tenant's erasure removes its tuples, its projects' and its administrators' on the site, so its name is unclaimed, and leaves another tenant's", async () => {
  const partition = await workspaceWithProject("tenant-erased");
  const other = await workspaceWithProject("tenant-kept");
  assert.equal(await siteHeldBy(partition.tenant), 1);
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), true);

  await erasure.tenantErased(partition.tenant);

  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), false);
  assert.equal(
    await listed({
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(partition.tenant),
    }),
    0,
  );
  assert.equal(await listed(projectTuples(partition)), 0);
  assert.equal(await siteHeldBy(partition.tenant), 0);
  assert.equal(await siteHeldBy(other.tenant), 1);
  assert.equal(await ketoHarnessClaims().claimed(other.tenant), true);
  assert.ok((await listed(projectTuples(other))) > 0);
  await erasure.tenantErased(partition.tenant);
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), false);
});
