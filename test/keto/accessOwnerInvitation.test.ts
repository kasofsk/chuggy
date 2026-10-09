/**
 * The site's invitation of a person into a tenant of their own, against a real
 * authority: what the tuples it writes permit the person, on the new tenant,
 * on the site and nowhere else, that the tenant is then held, that each
 * relation the site's tenant list reads across the tenants lists that relation
 * alone, the invited tenant and a created one among them, and that a principal
 * read across the tenants lists that principal's own tuples alone.
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

import { accessSiteHeldTenant } from "../../src/interpreter/accessAuthorities.ts";
import { accessOwnerInvitations } from "../../src/interpreter/accessOwnerInvitation.ts";
import type {
  AccessTuple,
  AccessTupleQuery,
} from "../../src/interpreter/accessPlane.ts";
import { projectCreationGrants } from "../../src/interpreter/projectCreation.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  allTenantAccessKinds,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectRelationGrant,
  tenantAdministratorGrant,
  tenantAdministratorRelation,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  tenantSiteRelation,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  asProjectId,
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessClaims,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessSiteDefaults,
  ketoHarnessSomeone,
  ketoHarnessTuples,
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

/** The most pages one listing is walked through before the case fails rather than reading it as ended. */
const walkedPagesMax = 100_000;

/** Every tuple one listing answers, walked to its end with the harness's reader. */
async function walked(
  query: AccessTupleQuery,
): Promise<readonly AccessTuple[]> {
  const reader = ketoHarnessTuples();
  const tuples: AccessTuple[] = [];
  let token: string | undefined;
  for (let pages = 0; pages < walkedPagesMax; pages += 1) {
    const page = await reader.page(query, token);
    tuples.push(...page.tuples);
    token = page.next === "" ? undefined : page.next;
    if (token === undefined) return tuples;
  }
  throw new Error("the listing did not end within the walk's bound");
}

test("each relation the site's tenant list reads across the tenants lists that relation alone, a created and an invited tenant among them", async () => {
  const created = namedTenant("listed-created");
  await grants.writeAll(
    projectCreationGrants(
      ketoHarnessSomeone("creator"),
      { tenant: created, project: asProjectId("chuggy") },
      true,
    ),
  );
  await grants.write(
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: `member-${randomUUID()}`,
      tenant: created,
      relation: "members",
    }),
  );
  const createdObject = projectAccessTenantObject(created);
  const tenant = namedTenant("listed-invited");
  await invitedInto(tenant, true, async () => {
    assert.ok(
      (
        await walked({
          query: "Object",
          namespace: projectAccessTenantNamespace,
          object: createdObject,
        })
      ).some((tuple) => tuple.relation === "members"),
    );
    for (const relation of [tenantAdministratorRelation, tenantSiteRelation]) {
      const listed = await walked({
        query: "NamespaceRelation",
        namespace: projectAccessTenantNamespace,
        relation,
      });
      assert.ok(
        listed.every((tuple) => tuple.relation === relation),
        relation,
      );
      for (const object of [createdObject, projectAccessTenantObject(tenant)])
        assert.ok(
          listed.some((tuple) => tuple.object === object),
          `${relation} ${object}`,
        );
      assert.ok(
        !listed.some(
          (tuple) =>
            tuple.object === createdObject && tuple.relation === "members",
        ),
      );
    }
    const creators = (
      await walked({
        query: "Object",
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        relation: "account_creators",
      })
    ).flatMap(({ subject }) =>
      subject.subject === "Set" ? (accessSiteHeldTenant(subject) ?? []) : [],
    );
    assert.ok(creators.includes(tenant));
    assert.ok(!creators.includes(created));
  });
});

test("a principal read across the tenants lists that principal's own tuples there in every relation, and none of another subject, a set or another namespace", async () => {
  const caller = ketoHarnessSomeone("caller");
  const held = namedTenant("caller-held");
  const membered = namedTenant("caller-membered");
  const own: readonly ProjectGrant[] = [
    tenantAdministratorGrant(caller, held),
    { ...tenantAdministratorGrant(caller, held), relation: "hosted_execution" },
    { ...tenantAdministratorGrant(caller, membered), relation: "members" },
  ];
  for (const grant of [
    ...own,
    tenantAdministratorGrant(ketoHarnessSomeone("other"), held),
    {
      ...tenantAdministratorGrant(caller, held),
      holder: {
        subject: "Holders",
        namespace: projectAccessTenantNamespace,
        object: projectAccessTenantObject(membered),
        relation: "members",
      },
    } satisfies ProjectGrant,
    projectRelationGrant(
      caller,
      { tenant: held, project: asProjectId("chuggy") },
      "admins",
    ),
  ])
    await grants.write(grant);
  const shown = (tuples: readonly AccessTuple[]) =>
    tuples.map((tuple) => JSON.stringify(tuple)).sort();
  assert.deepEqual(
    shown(
      await walked({
        query: "NamespaceSubject",
        namespace: projectAccessTenantNamespace,
        principal: caller,
      }),
    ),
    shown(
      own.map((grant) => ({
        object: grant.object,
        relation: grant.relation,
        subject: { subject: "Id", id: caller },
      })),
    ),
  );
  assert.ok(
    (
      await walked({
        query: "Object",
        namespace: projectAccessNamespace,
        object: projectAccessObject({
          tenant: held,
          project: asProjectId("chuggy"),
        }),
      })
    ).some(
      (tuple) => tuple.subject.subject === "Id" && tuple.subject.id === caller,
    ),
  );
});
