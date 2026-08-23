import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
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
  const partition = await postgresHarnessProject(
    harness.store,
    "project-access",
  );
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
    harness.store,
    "project-access-absent",
  );
  assert.equal(
    await harness.access.authorize(asPrincipal("absent"), partition, "Read"),
    undefined,
  );
});
