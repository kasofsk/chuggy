import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

test("one membership resolves capabilities to one audited authority", async () => {
  const partition = await postgresHarnessProject(harness, "project-access");
  const principal = asPrincipal("issuer-subject");
  await harness.query(
    `INSERT INTO project_membership
       (principal,tenant,project,authority_kind,authority_subject,
        may_read,may_mutate,may_dispatch,may_propose)
     VALUES ($1,$2,$3,'OidcUser','internal-user',true,false,true,false)`,
    [principal, partition.tenant, partition.project],
  );
  const authority = {
    kind: "OidcUser",
    subject: "internal-user",
  };
  assert.deepEqual(
    await harness.access.authorize(principal, partition, "Read"),
    authority,
  );
  assert.deepEqual(
    await harness.access.authorize(principal, partition, "DispatchTicket"),
    authority,
  );
  assert.equal(
    await harness.access.authorize(principal, partition, "Mutate"),
    undefined,
  );
  assert.equal(
    await harness.access.authorize(principal, partition, "ProposeDispatch"),
    undefined,
  );
});

test("an absent principal and an absent project grant are indistinguishable", async () => {
  const partition = await postgresHarnessProject(
    harness,
    "project-access-absent",
  );
  assert.equal(
    await harness.access.authorize(asPrincipal("absent"), partition, "Read"),
    undefined,
  );
});

/** A tenant with one member at `role`, and a project inside it. */
async function tenantMemberProject(
  label: string,
  role: string,
): Promise<{ partition: Partition; principal: Principal }> {
  const partition = await postgresHarnessProject(harness, label);
  const principal = asPrincipal(`issuer-${label}-${randomUUID()}`);
  await harness.query(
    `INSERT INTO tenant_membership
       (principal,tenant,role,authority_kind,authority_subject)
     VALUES ($1,$2,$3,'OidcUser','tenant-member')`,
    [principal, partition.tenant, role],
  );
  return { partition, principal };
}

test("a tenant role resolves project access when no project row says otherwise", async () => {
  const { partition, principal } = await tenantMemberProject(
    "tenant-admin",
    "Admin",
  );
  for (const access of [
    "Read",
    "Mutate",
    "DispatchTicket",
    "ProposeDispatch",
  ] as const) {
    assert.deepEqual(
      await harness.access.authorize(principal, partition, access),
      { kind: "OidcUser", subject: "tenant-member" },
      `an admin holds ${access}`,
    );
  }
});

test("a member's tenant role reaches the read and stops there", async () => {
  const { partition, principal } = await tenantMemberProject(
    "tenant-member",
    "Member",
  );
  assert.notEqual(
    await harness.access.authorize(principal, partition, "Read"),
    undefined,
  );
  assert.equal(
    await harness.access.authorize(principal, partition, "Mutate"),
    undefined,
  );
});

test("an explicit project row wins, granting past the role and denying beneath it", async () => {
  const granted = await tenantMemberProject("override-grant", "Member");
  await harness.query(
    `INSERT INTO project_membership
       (principal,tenant,project,authority_kind,authority_subject,
        may_read,may_mutate,may_dispatch,may_propose)
     VALUES ($1,$2,$3,'OidcUser','project-row',true,true,false,false)`,
    [granted.principal, granted.partition.tenant, granted.partition.project],
  );
  assert.deepEqual(
    await harness.access.authorize(
      granted.principal,
      granted.partition,
      "Mutate",
    ),
    { kind: "OidcUser", subject: "project-row" },
  );

  const denied = await tenantMemberProject("override-deny", "Admin");
  await harness.query(
    `INSERT INTO project_membership
       (principal,tenant,project,authority_kind,authority_subject,
        may_read,may_mutate,may_dispatch,may_propose)
     VALUES ($1,$2,$3,'OidcUser','project-row',true,false,false,false)`,
    [denied.principal, denied.partition.tenant, denied.partition.project],
  );
  assert.equal(
    await harness.access.authorize(
      denied.principal,
      denied.partition,
      "Mutate",
    ),
    undefined,
    "the project row denies what the tenant role would have allowed",
  );
});

test("a suspended tenant resolves no access at all", async () => {
  const { partition, principal } = await tenantMemberProject(
    "suspended",
    "Owner",
  );
  await harness.query(
    `UPDATE tenant SET lifecycle='Suspended' WHERE tenant=$1`,
    [partition.tenant],
  );
  assert.equal(
    await harness.access.authorize(principal, partition, "Read"),
    undefined,
  );
});
