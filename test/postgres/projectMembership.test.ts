/**
 * What an administrator provisions, asked of the function the API authorizes
 * with. A membership that resolved through anything else would prove only that
 * this suite and the adapter agree on an encoding.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  checkedProjectMembership,
  type ProjectMembershipRequest,
} from "../../src/interpreter/projectMembership.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

const issuer = "https://accounts.example.test";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

function membershipRequest(
  tenant: string,
  project: string,
  subject: string,
  access: readonly string[],
): ProjectMembershipRequest {
  return {
    issuer,
    subject,
    tenant,
    project,
    authorityKind: "OidcUser",
    authoritySubject: "internal-user",
    access,
  };
}

test("a provisioned principal authorizes exactly the access it was granted", async () => {
  const partition = await postgresHarnessProject(harness.store, "membership");
  const granted = checkedProjectMembership(
    membershipRequest(partition.tenant, partition.project, "subject-one", [
      "Read",
      "DispatchTicket",
    ]),
  );
  await harness.membership.grant(granted);
  assert.equal(granted.principal, oidcPrincipal(issuer, "subject-one"));
  const authority = { kind: "OidcUser", subject: "internal-user" };
  assert.deepEqual(
    await harness.access.authorize(granted.principal, partition, "Read"),
    authority,
  );
  assert.deepEqual(
    await harness.access.authorize(
      granted.principal,
      partition,
      "DispatchTicket",
    ),
    authority,
  );
  assert.equal(
    await harness.access.authorize(granted.principal, partition, "Mutate"),
    undefined,
  );
});

test("re-granting is not an error and narrowing takes access away", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "membership-re",
  );
  const request = membershipRequest(
    partition.tenant,
    partition.project,
    "subject-two",
    ["Read", "Mutate"],
  );
  const wide = checkedProjectMembership(request);
  await harness.membership.grant(wide);
  await harness.membership.grant(wide);
  assert.ok(
    (await harness.access.authorize(wide.principal, partition, "Mutate")) !==
      undefined,
  );
  await harness.membership.grant(
    checkedProjectMembership({ ...request, access: ["Read"] }),
  );
  assert.equal(
    await harness.access.authorize(wide.principal, partition, "Mutate"),
    undefined,
  );
  assert.ok(
    (await harness.access.authorize(wide.principal, partition, "Read")) !==
      undefined,
  );
});

test("a revoked principal authorizes nothing and revoking again says so", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "membership-revoked",
  );
  const granted = checkedProjectMembership(
    membershipRequest(partition.tenant, partition.project, "subject-three", [
      "Read",
    ]),
  );
  await harness.membership.grant(granted);
  assert.equal(await harness.membership.revoke(granted), true);
  assert.equal(
    await harness.access.authorize(granted.principal, partition, "Read"),
    undefined,
  );
  assert.equal(await harness.membership.revoke(granted), false);
});

test("a membership cannot be granted on a project that was never provisioned", async () => {
  const granted = checkedProjectMembership(
    membershipRequest("tenant-absent", "project-absent", "subject-four", [
      "Read",
    ]),
  );
  await assert.rejects(
    () => harness.membership.grant(granted),
    /project_membership_belongs_to_project/u,
  );
});
