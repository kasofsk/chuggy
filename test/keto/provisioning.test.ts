/**
 * The administrative command, run as a process against a real authority. It is
 * driven as a process because what it is being asked is whether the variables
 * an operator exports reach the tuple the API then reads.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allProjectAccessKinds,
  projectAccessObject,
} from "../../src/interpreter/projectAccess.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  ketoHarnessAccess,
  ketoHarnessClaims,
  ketoHarnessCommand,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessReadUrl,
  ketoHarnessRoleKinds,
} from "./harness.ts";

const access = ketoHarnessAccess();

/** The command, run with the variables a case exports and nothing else of its own. */
const provision = (environment: Readonly<Record<string, string>>) =>
  ketoHarnessCommand("src/roots/provisionProjectAccess.ts", environment);

test("a granted relation is one the API's own port then answers for", async () => {
  const partition = ketoHarnessPartition("provision");
  const granted = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  });
  assert.equal(granted.code, 0, granted.output);
  const principal = oidcPrincipal(ketoHarnessIssuer, "provisioned");
  assert.notEqual(
    await access.authorize(principal, partition, "Mutate"),
    undefined,
    granted.output,
  );
  const revoked = await provision({
    CHUG_PROVISION_ACTION: "revoke",
    CHUG_PROVISION_SUBJECT: "provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  });
  assert.equal(revoked.code, 0, revoked.output);
  assert.equal(
    await access.authorize(principal, partition, "Mutate"),
    undefined,
  );
});

test("a tenant grant and the project's tenant relation compose to project access", async () => {
  const partition = ketoHarnessPartition("provision-tenant");
  const onTenant = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "tenant-provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(onTenant.code, 0, onTenant.output);
  const inherited = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "tenant",
  });
  assert.equal(inherited.code, 0, inherited.output);
  const principal = oidcPrincipal(ketoHarnessIssuer, "tenant-provisioned");
  for (const kind of allProjectAccessKinds)
    assert.equal(
      (await access.authorize(principal, partition, kind)) !== undefined,
      ketoHarnessRoleKinds.includes(kind),
      kind,
    );
});

test("a person's project grant links the project to its tenant, which then holds the tenant, and a revocation leaves the link", async () => {
  const partition = ketoHarnessPartition("provision-link");
  const person = {
    CHUG_PROVISION_SUBJECT: "linked",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  };
  const claims = ketoHarnessClaims();
  assert.equal(await claims.claimed(partition.tenant), false);
  const granted = await provision({
    ...person,
    CHUG_PROVISION_ACTION: "grant",
  });
  assert.equal(granted.code, 0, granted.output);
  assert.equal(await claims.claimed(partition.tenant), true, granted.output);
  const onTenant = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "linked-admin",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(onTenant.code, 0, onTenant.output);
  const tenantAdmin = oidcPrincipal(ketoHarnessIssuer, "linked-admin");
  assert.notEqual(
    await access.authorize(tenantAdmin, partition, "ManageProjectSelector"),
    undefined,
  );
  const revoked = await provision({
    ...person,
    CHUG_PROVISION_ACTION: "revoke",
  });
  assert.equal(revoked.code, 0, revoked.output);
  assert.notEqual(
    await access.authorize(tenantAdmin, partition, "ManageProjectSelector"),
    undefined,
    revoked.output,
  );
});

test("a project nothing created is granted access anyway", async () => {
  const partition = ketoHarnessPartition("provision-absent");
  const granted = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "early",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(granted.code, 0, granted.output);
  assert.notEqual(
    await access.authorize(
      oidcPrincipal(ketoHarnessIssuer, "early"),
      partition,
      "ManageProjectSelector",
    ),
    undefined,
  );
});

test("a relation the model does not declare is refused before anything is written", async () => {
  const partition = ketoHarnessPartition("provision-relation");
  const refused = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "typo",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developer",
  });
  assert.equal(refused.code, 1);
  assert.match(refused.output, /is not a project relation/u);
  const listing = new URL("relation-tuples", ketoHarnessReadUrl());
  listing.searchParams.set("namespace", "Project");
  listing.searchParams.set("object", projectAccessObject(partition));
  const onProject = (await (await fetch(listing)).json()) as {
    relation_tuples: unknown[];
  };
  assert.deepEqual(onProject.relation_tuples, []);
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), false);
});

/** Whether a principal of `subject` administers the site. */
async function administersSite(subject: string): Promise<boolean> {
  return (
    (await access.authorizeSite(
      oidcPrincipal(ketoHarnessIssuer, subject),
      "AdministerSite",
    )) !== undefined
  );
}

test("a site grant makes a person the site's administrator, and its revocation takes that back", async () => {
  const site = {
    CHUG_PROVISION_LEVEL: "site",
    CHUG_PROVISION_SUBJECT: `site-admin-${randomUUID()}`,
    CHUG_PROVISION_RELATION: "admins",
  };
  try {
    const granted = await provision({
      ...site,
      CHUG_PROVISION_ACTION: "grant",
    });
    assert.equal(granted.code, 0, granted.output);
    assert.equal(await administersSite(site.CHUG_PROVISION_SUBJECT), true);
  } finally {
    const revoked = await provision({
      ...site,
      CHUG_PROVISION_ACTION: "revoke",
    });
    assert.equal(revoked.code, 0, revoked.output);
  }
  assert.equal(await administersSite(site.CHUG_PROVISION_SUBJECT), false);
});

test("a site grant beside another relation, a tenant or a project, or under another level, writes nothing and says why", async () => {
  const partition = ketoHarnessPartition("provision-site");
  for (const [refusal, environment] of [
    [
      /writes only CHUG_PROVISION_RELATION=admins/u,
      { CHUG_PROVISION_RELATION: "account_creators" },
    ],
    [
      /CHUG_PROVISION_TENANT must be unset/u,
      { CHUG_PROVISION_TENANT: partition.tenant },
    ],
    [
      /CHUG_PROVISION_PROJECT must be unset/u,
      { CHUG_PROVISION_PROJECT: partition.project },
    ],
    [
      /CHUG_PROVISION_LEVEL must be site or unset/u,
      { CHUG_PROVISION_LEVEL: "tenant" },
    ],
  ] as const) {
    const subject = `site-refused-${randomUUID()}`;
    const refused = await provision({
      CHUG_PROVISION_ACTION: "grant",
      CHUG_PROVISION_LEVEL: "site",
      CHUG_PROVISION_SUBJECT: subject,
      CHUG_PROVISION_RELATION: "admins",
      ...environment,
    });
    assert.equal(refused.code, 1, refused.output);
    assert.match(refused.output, refusal);
    assert.equal(await administersSite(subject), false);
  }
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), false);
});
