/**
 * What a real server does with tenant administration.
 *
 * Every case here is a claim about the checked functions rather than about the
 * adapter, because the functions are where the capability is resolved: the API
 * role holds neither DML nor SELECT on the tables underneath, so a case that
 * asserted the adapter's intentions would be asserting nothing that protects
 * anything.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  allTenantCapabilities,
  type TenantRole,
} from "../../src/interpreter/tenantAdmin.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

function principalNamed(label: string): Principal {
  return asPrincipal(`issuer-${label}-${randomUUID()}`);
}

/** A tenant nobody else is using, owned by the principal this answers with. */
async function tenantOwnedBy(
  label: string,
): Promise<{ tenant: TenantId; owner: Principal }> {
  const tenant = asTenantId(`tenant-${label}-${randomUUID()}`);
  const owner = principalNamed(label);
  await harness.tenants.createTenant(owner, tenant, label, {
    kind: asAuthorityKind("OidcUser"),
    subject: asAuthoritySubject(`${label}-owner`),
  });
  return { tenant, owner };
}

/** The one thing a granted membership is for, asked the short way. */
async function roleOf(
  tenant: TenantId,
  principal: Principal,
): Promise<string | undefined> {
  const rows = await harness.query(
    `SELECT role FROM tenant_membership WHERE tenant=$1 AND principal=$2`,
    [tenant, principal],
  );
  return rows[0]?.["role"] as string | undefined;
}

test("creating a tenant makes its creator the owner and records the change", async () => {
  const { tenant, owner } = await tenantOwnedBy("create");
  assert.equal(await roleOf(tenant, owner), "Owner");
  const changes = await harness.query(
    `SELECT role_before,role_after FROM tenant_membership_change
      WHERE tenant=$1 AND principal=$2`,
    [tenant, owner],
  );
  assert.deepEqual(changes, [{ role_before: null, role_after: "Owner" }]);
});

test("an owner holds every capability and a member holds only the read", async () => {
  const { tenant, owner } = await tenantOwnedBy("capabilities");
  const member = principalNamed("member");
  assert.equal(
    (await harness.tenants.grantMembership(owner, tenant, member, "Member"))
      .result,
    "Authorized",
  );
  for (const capability of allTenantCapabilities) {
    assert.notEqual(
      await harness.tenantAccess.authorize(owner, tenant, capability),
      undefined,
      `owner holds ${capability}`,
    );
    assert.equal(
      (await harness.tenantAccess.authorize(member, tenant, capability)) ===
        undefined,
      capability !== "ReadTenant",
      `member and ${capability}`,
    );
  }
});

test("an admin manages members and projects but not the tenant itself", async () => {
  const { tenant, owner } = await tenantOwnedBy("admin");
  const admin = principalNamed("admin");
  await harness.tenants.grantMembership(owner, tenant, admin, "Admin");
  assert.notEqual(
    await harness.tenantAccess.authorize(admin, tenant, "ManageMembers"),
    undefined,
  );
  assert.notEqual(
    await harness.tenantAccess.authorize(admin, tenant, "ManageProjects"),
    undefined,
  );
  assert.equal(
    await harness.tenantAccess.authorize(admin, tenant, "ManageTenant"),
    undefined,
  );
});

test("a member cannot grant membership, and is refused rather than faulted", async () => {
  const { tenant, owner } = await tenantOwnedBy("refusal");
  const member = principalNamed("member");
  const outsider = principalNamed("outsider");
  await harness.tenants.grantMembership(owner, tenant, member, "Member");
  assert.deepEqual(
    await harness.tenants.grantMembership(member, tenant, outsider, "Member"),
    { result: "NotFound" },
  );
  assert.equal(await roleOf(tenant, outsider), undefined);
});

test("a stranger to the tenant is refused every administrative change", async () => {
  const { tenant, owner } = await tenantOwnedBy("stranger");
  const stranger = principalNamed("stranger");
  const partition: Partition = {
    tenant,
    project: asProjectId(`project-stranger-${randomUUID()}`),
  };
  assert.deepEqual(
    await harness.tenants.grantMembership(stranger, tenant, owner, "Member"),
    { result: "NotFound" },
  );
  assert.deepEqual(await harness.tenants.createProject(stranger, partition), {
    result: "NotFound",
  });
  assert.deepEqual(await harness.tenants.members(stranger, tenant), {
    result: "NotFound",
  });
  assert.deepEqual(await harness.tenants.invitations(stranger, tenant), {
    result: "NotFound",
  });
});

test("a tenant keeps at least one owner, on demotion and on revocation alike", async () => {
  const { tenant, owner } = await tenantOwnedBy("last-owner");
  await assert.rejects(
    () => harness.tenants.grantMembership(owner, tenant, owner, "Admin"),
    /a tenant keeps at least one owner/u,
  );
  await assert.rejects(
    () => harness.tenants.revokeMembership(owner, tenant, owner),
    /a tenant keeps at least one owner/u,
  );
  const second = principalNamed("second-owner");
  await harness.tenants.grantMembership(owner, tenant, second, "Owner");
  assert.equal(
    (await harness.tenants.revokeMembership(owner, tenant, owner)).result,
    "Authorized",
  );
  assert.equal(await roleOf(tenant, owner), undefined);
});

test("creating a project in a tenant provisions its capacity account", async () => {
  const { tenant, owner } = await tenantOwnedBy("provision");
  const partition: Partition = {
    tenant,
    project: asProjectId(`project-provision-${randomUUID()}`),
  };
  assert.equal(
    (await harness.tenants.createProject(owner, partition)).result,
    "Authorized",
  );
  const accounts = await harness.query(
    `SELECT count(*)::int AS held FROM capacity_account
      WHERE account = project_capacity_account($1,$2)`,
    [partition.tenant, partition.project],
  );
  assert.equal(accounts[0]?.["held"], 1);
});

test("an invitation is redeemed once, by the address it names", async () => {
  const { tenant, owner } = await tenantOwnedBy("invite");
  const invited = principalNamed("invited");
  const expires = new Date(Date.now() + 3_600_000);
  assert.equal(
    (
      await harness.tenants.invite(
        owner,
        tenant,
        "Person@Example.COM",
        "Member",
        expires,
      )
    ).result,
    "Authorized",
  );
  const redeemed = await harness.tenants.redeemInvitations(
    invited,
    "person@example.com",
  );
  assert.deepEqual(
    redeemed.map((one) => one.role),
    ["Member"],
  );
  assert.equal(await roleOf(tenant, invited), "Member");
  /**
   * Redemption is safe on every authenticated request, so a second call is not
   * a second membership and not a fault.
   */
  assert.deepEqual(
    await harness.tenants.redeemInvitations(invited, "person@example.com"),
    [],
  );
});

test("an expired or revoked invitation redeems nothing", async () => {
  const { tenant, owner } = await tenantOwnedBy("stale");
  const late = principalNamed("late");
  await harness.tenants.invite(
    owner,
    tenant,
    "late@example.com",
    "Member",
    new Date(Date.now() - 1_000),
  );
  assert.deepEqual(
    await harness.tenants.redeemInvitations(late, "late@example.com"),
    [],
  );

  const withdrawn = principalNamed("withdrawn");
  await harness.tenants.invite(
    owner,
    tenant,
    "withdrawn@example.com",
    "Member",
    new Date(Date.now() + 3_600_000),
  );
  await harness.tenants.revokeInvitation(
    owner,
    tenant,
    "withdrawn@example.com",
  );
  assert.deepEqual(
    await harness.tenants.redeemInvitations(withdrawn, "withdrawn@example.com"),
    [],
  );
  assert.equal(await roleOf(tenant, withdrawn), undefined);
});

test("re-inviting an address leaves one live invitation", async () => {
  const { tenant, owner } = await tenantOwnedBy("reinvite");
  const expires = new Date(Date.now() + 3_600_000);
  await harness.tenants.invite(
    owner,
    tenant,
    "twice@example.com",
    "Member",
    expires,
  );
  await harness.tenants.invite(
    owner,
    tenant,
    "twice@example.com",
    "Admin",
    expires,
  );
  const listed = await harness.tenants.invitations(owner, tenant);
  assert.equal(listed.result, "Authorized");
  assert.deepEqual(
    listed.result === "Authorized"
      ? listed.value.map((one) => [one.email, one.role])
      : [],
    [["twice@example.com", "Admin"]],
  );
});

test("the API role reaches tenancy only through the checked functions", async () => {
  for (const table of [
    "tenant_membership",
    "tenant_invitation",
    "tenant_membership_change",
  ]) {
    assert.match(
      (await harness.attemptAs("chuggy_api", `SELECT * FROM ${table}`)) ?? "",
      postgresHarnessDenial(table),
      `chuggy_api may not read ${table}`,
    );
  }
  assert.match(
    (await harness.attemptAs(
      "chuggy_api",
      `INSERT INTO tenant (tenant,display_name,lifecycle) VALUES ('t','t','Active')`,
    )) ?? "",
    postgresHarnessDenial("tenant"),
  );
});

test("an unknown capability and an unknown role are refused by name", async () => {
  const { tenant, owner } = await tenantOwnedBy("vocabulary");
  await assert.rejects(
    () =>
      harness.query(
        `SELECT * FROM authorize_tenant_capability($1,$2,'Invent')`,
        [owner, tenant],
      ),
    /unknown tenant capability/u,
  );
  await assert.rejects(
    () =>
      harness.tenants.grantMembership(
        owner,
        tenant,
        principalNamed("bad-role"),
        "Sovereign" as TenantRole,
      ),
    /unknown tenant role/u,
  );
});
