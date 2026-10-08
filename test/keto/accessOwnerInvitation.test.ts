/**
 * The site's invitation of a person into a tenant of their own, against a real
 * authority: what the tuples it writes permit the person, on the new tenant,
 * on the site and nowhere else, and that the tenant is then held.
 *
 * THE SITE AND THE FIRST ACCOUNT ARE SHARED BETWEEN RUNS. The site is one object
 * on a server a run reuses, and the directory double gives every run's first
 * account the same subject, so each case asserts that subject holds no
 * `CreateAccount` before it and removes the account creators' tuple however it
 * ends.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { accessOwnerInvitations } from "../../src/interpreter/accessOwnerInvitation.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  allTenantAccessKinds,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessClaims,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessSiteDefaults,
  ketoHarnessWithSiteAdministrator,
} from "./harness.ts";
import {
  directoryMemory,
  directorySubject,
  githubMemory,
  githubUser,
} from "../interpreter/accessInvitationFixture.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const claims = ketoHarnessClaims();
const person = oidcPrincipal(ketoHarnessIssuer, directorySubject(0));

/** A tenant the name rule takes, which the harness's partitions are not. */
function namedTenant(label: string): TenantId {
  return asTenantId(
    `${label}-${randomUUID().replaceAll("-", "").slice(0, 24)}`,
  );
}

/** The site's account creators held by `tenant`'s administrators. */
function accountCreatorsOf(tenant: TenantId): ProjectGrant {
  return {
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    relation: "account_creators",
    holder: {
      subject: "Holders",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
      relation: "admins",
    },
  };
}

async function creates(): Promise<boolean> {
  return (await access.authorizeSite(person, "CreateAccount")) !== undefined;
}

async function heldOn(tenant: TenantId): Promise<readonly TenantAccessKind[]> {
  const found: TenantAccessKind[] = [];
  for (const kind of allTenantAccessKinds)
    if ((await access.authorizeTenant(person, tenant, kind)) !== undefined)
      found.push(kind);
  return found;
}

/** Invites the person into `tenant` as a fresh site administrator, removing the account creators' tuple however it ends. */
async function invitedInto(
  tenant: TenantId,
  createAccounts: boolean,
  run: (inviter: TenantId) => Promise<void>,
): Promise<void> {
  await ketoHarnessSiteDefaults();
  await ketoHarnessWithSiteAdministrator(async (administrator) => {
    const inviter = namedTenant("inviter");
    for (const grant of [
      tenantAdministratorGrant(administrator, inviter),
      ...tenantAuthorityDefaults(inviter),
    ])
      await grants.write(grant);
    const invitations = accessOwnerInvitations(
      {
        access,
        claims,
        grants,
        directory: directoryMemory().directory,
        github: githubMemory({
          "octo-cat": githubUser("990000001", "Octo-Cat"),
        }),
      },
      { issuer: ketoHarnessIssuer },
    );
    try {
      assert.equal(await creates(), false);
      assert.equal(await claims.claimed(tenant), false);
      assert.deepEqual(
        await invitations.invite(administrator, {
          tenant,
          github: "octo-cat",
          email: "octo@example.com",
          createAccounts,
        }),
        { invited: "Invited", subject: directorySubject(0), created: true },
      );
      await run(inviter);
    } finally {
      await grants.remove(accountCreatorsOf(tenant));
    }
  });
}

test("a site's invitation makes the person the new tenant's administrator and one of the site's account creators, and nothing on the inviter's tenant", async () => {
  const tenant = namedTenant("owned");
  await invitedInto(tenant, true, async (inviter) => {
    const held = await heldOn(tenant);
    for (const kind of [
      "AdministerTenant",
      "GrantTenantAdmin",
      "GrantMember",
      "ManageTenantAuthorities",
    ] as const)
      assert.ok(held.includes(kind), kind);
    assert.equal(await creates(), true);
    assert.deepEqual(await heldOn(inviter), []);
    assert.equal(await claims.claimed(tenant), true);
  });
});

test("a site's invitation not asking for account creation gives the person no `CreateAccount`", async () => {
  const tenant = namedTenant("owned-plain");
  await invitedInto(tenant, false, async () => {
    assert.ok((await heldOn(tenant)).includes("AdministerTenant"));
    assert.equal(await creates(), false);
  });
});
