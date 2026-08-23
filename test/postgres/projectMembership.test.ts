/**
 * What an administrator provisions, asked of the function the API authorizes
 * with. A membership that resolved through anything else would prove only that
 * this suite and the adapter agree on an encoding.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  checkedProjectMembership,
  projectMembershipWriterLacks,
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

test("re-granting re-points the audited authority to the one supplied", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "membership-authority",
  );
  const request = membershipRequest(
    partition.tenant,
    partition.project,
    "subject-five",
    ["Read"],
  );
  const first = checkedProjectMembership(request);
  await harness.membership.grant(first);
  assert.deepEqual(
    await harness.access.authorize(first.principal, partition, "Read"),
    { kind: "OidcUser", subject: "internal-user" },
  );
  await harness.membership.grant(
    checkedProjectMembership({
      ...request,
      authorityKind: "OidcService",
      authoritySubject: "internal-successor",
    }),
  );
  assert.deepEqual(
    await harness.access.authorize(first.principal, partition, "Read"),
    { kind: "OidcService", subject: "internal-successor" },
  );
});

test("the writer this connects as holds every privilege both actions need", async () => {
  const writer = await harness.membership.writer();
  assert.deepEqual(projectMembershipWriterLacks("Grant", writer), []);
  assert.deepEqual(projectMembershipWriterLacks("Revoke", writer), []);
});

test("naming several privileges in one inquiry answers any of them, not all", async () => {
  const role = `membership_probe_${randomUUID().replaceAll("-", "")}`;
  const transaction = await harness.begin();
  try {
    await transaction.query(`CREATE ROLE ${role} NOLOGIN`);
    await transaction.query(`GRANT DELETE ON project_membership TO ${role}`);
    const [asked] = await transaction.query(
      `SELECT
         has_table_privilege($1,'project_membership','INSERT,UPDATE,DELETE') AS together,
         has_table_privilege($1,'project_membership','INSERT') AS insert_only,
         has_table_privilege($1,'project_membership','UPDATE') AS update_only,
         has_table_privilege($1,'project_membership','DELETE') AS delete_only`,
      [role],
    );
    assert.equal(
      asked?.["together"],
      true,
      "a comma-separated inquiry is ANY, so it must not be what a precondition asks",
    );
    assert.deepEqual(
      [asked?.["insert_only"], asked?.["update_only"], asked?.["delete_only"]],
      [false, false, true],
    );
    assert.deepEqual(
      projectMembershipWriterLacks("Grant", {
        role,
        privileges: new Set(["DELETE"]),
      }),
      ["INSERT", "UPDATE"],
    );
  } finally {
    await transaction.rollback();
  }
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
