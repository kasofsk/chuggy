/**
 * What an administrator provisions, asked of the authority the API authorizes
 * with. A grant resolved through anything else would prove only that this
 * suite and the adapter agree on an encoding.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allProjectAccessKinds,
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessObject,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAccessAt,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessReadinessAt,
  ketoHarnessReadUrl,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();

/** Every kind the roster names that the principal holds on the partition. */
async function held(
  principal: ReturnType<typeof oidcPrincipal>,
  partition: Partition,
): Promise<readonly ProjectAccessKind[]> {
  const found: ProjectAccessKind[] = [];
  for (const kind of allProjectAccessKinds)
    if ((await access.authorize(principal, partition, kind)) !== undefined)
      found.push(kind);
  return found;
}

/** One person's relation on one project, written and then asked about. */
async function granted(
  partition: Partition,
  subject: string,
  relation: string,
): Promise<ReturnType<typeof oidcPrincipal>> {
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation,
    }),
  );
  return oidcPrincipal(ketoHarnessIssuer, subject);
}

test("each project relation carries exactly the kinds the model follows from it", async () => {
  const partition = ketoHarnessPartition("relations");
  assert.deepEqual(
    await held(await granted(partition, "reader", "agents"), partition),
    ["Read"],
  );
  assert.deepEqual(
    await held(await granted(partition, "developer", "developers"), partition),
    ["Read", "Mutate", "ProposeDispatch"],
  );
  assert.deepEqual(
    await held(
      await granted(partition, "dispatcher", "dispatchers"),
      partition,
    ),
    ["DispatchTicket"],
  );
  assert.deepEqual(
    await held(await granted(partition, "administrator", "admins"), partition),
    allProjectAccessKinds,
  );
});

test("a permitted subject answers the authority derived from the principal", async () => {
  const partition = ketoHarnessPartition("authority");
  const principal = await granted(partition, "audited", "developers");
  assert.deepEqual(
    await access.authorize(principal, partition, "Mutate"),
    memberAuthority(principal),
  );
});

test("an unheard-of principal and an unheard-of project are indistinguishable", async () => {
  const partition = ketoHarnessPartition("absent");
  assert.equal(
    await access.authorize(
      oidcPrincipal(ketoHarnessIssuer, "nobody"),
      partition,
      "Read",
    ),
    undefined,
  );
  const stranger = await granted(partition, "somebody", "developers");
  assert.equal(
    await access.authorize(stranger, ketoHarnessPartition("elsewhere"), "Read"),
    undefined,
  );
});

test("a revocation takes back the one relation it names and is idempotent", async () => {
  const partition = ketoHarnessPartition("revoke");
  const principal = await granted(partition, "leaving", "developers");
  await granted(partition, "leaving", "dispatchers");
  const grant = projectPrincipalGrant({
    issuer: ketoHarnessIssuer,
    subject: "leaving",
    tenant: partition.tenant,
    project: partition.project,
    relation: "developers",
  });
  await grants.remove(grant);
  assert.deepEqual(await held(principal, partition), ["DispatchTicket"]);
  await grants.remove(grant);
  assert.deepEqual(await held(principal, partition), ["DispatchTicket"]);
});

test("a tenant administrator reaches every project the tenant relation names", async () => {
  const partition = ketoHarnessPartition("tenant");
  const principal = oidcPrincipal(ketoHarnessIssuer, "tenant-admin");
  await grants.write(
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "tenant-admin",
      tenant: partition.tenant,
      relation: "admins",
    }),
  );
  assert.deepEqual(
    await held(principal, partition),
    [],
    "a tenant grant reached a project no tuple put under that tenant",
  );
  await grants.write(projectTenantGrant(partition));
  assert.deepEqual(await held(principal, partition), allProjectAccessKinds);
});

/**
 * The object encoding is what keeps two partitions apart, and both halves are
 * arbitrary text that may carry any separator. A joined encoding would let one
 * tenant's project answer for another's.
 */
test("two partitions whose halves join to one string are two objects", async () => {
  const grantee = "ambiguous";
  const shared = randomUUID();
  const left = {
    tenant: asTenantId(`keto/split-${shared}`),
    project: asProjectId(`/web-${shared}`),
  };
  const right = {
    tenant: asTenantId(`keto/split-${shared}/`),
    project: asProjectId(`web-${shared}`),
  };
  assert.equal(
    `${left.tenant}${left.project}`,
    `${right.tenant}${right.project}`,
    "the fixture does not produce the ambiguity it is about",
  );
  assert.notEqual(projectAccessObject(left), projectAccessObject(right));
  const principal = await granted(left, grantee, "admins");
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: grantee,
      tenant: right.tenant,
      project: right.project,
      relation: "agents",
    }),
  );
  assert.deepEqual(await held(principal, left), allProjectAccessKinds);
  assert.deepEqual(await held(principal, right), ["Read"]);
});

/**
 * A permit the model does not declare answers 400 rather than `allowed:false`,
 * which is what makes a typo in the permit table a fault every caller sees
 * instead of a project nobody can reach.
 */
test("a relation the model does not declare is a fault, never a refusal", async () => {
  const partition = ketoHarnessPartition("unknown");
  const url = new URL("relation-tuples/check/openapi", ketoHarnessReadUrl());
  url.searchParams.set("namespace", projectAccessNamespace);
  url.searchParams.set("object", projectAccessObject(partition));
  url.searchParams.set("relation", "administer_everything");
  url.searchParams.set(
    "subject_id",
    oidcPrincipal(ketoHarnessIssuer, "asking"),
  );
  assert.equal((await fetch(url)).status, 400);
});

test("an authority that is not there leaves the question undecided", async () => {
  await assert.rejects(
    () =>
      ketoHarnessAccessAt("http://127.0.0.1:1/").authorize(
        oidcPrincipal(ketoHarnessIssuer, "asking"),
        ketoHarnessPartition("outage"),
        "Read",
      ),
    ProjectAccessUnavailable,
  );
});

/**
 * The permits are asked of the server rather than read off the model file,
 * which is what makes readiness a control over a deployed model rather than a
 * restatement of what this tree already believes.
 */
test("readiness holds only against a server carrying this model", async () => {
  assert.equal(
    await ketoHarnessReadinessAt(ketoHarnessReadUrl()).ready(),
    true,
  );
  assert.equal(
    await ketoHarnessReadinessAt("http://127.0.0.1:1/").ready(),
    false,
  );
});
