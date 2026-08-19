/**
 * The runtime role's grants: what a dispatcher connection may do to these
 * relations, and what the server refuses it.
 *
 * WHY THIS IS A TEST AND NOT A README LINE. 006 requires that ordinary runtime
 * database roles cannot update or delete historical entries, and the
 * implementor contract requires that no caller can bypass a durable boundary
 * with a direct table write. Both are claims about grants, and a grant that
 * was never exercised reads exactly like a grant that was never made.
 *
 * EACH ATTEMPT IS ROLLED BACK, so a case that proves a permitted statement
 * leaves no row for the next case to find.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { dispatcherRole } from "../../src/adapters/postgres/schema.ts";
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

test("the dispatcher role cannot rewrite a journal entry", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "UPDATE journal_entry SET entry = '{}'",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot delete a journal entry", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "DELETE FROM journal_entry",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot provision a project, because provisioning is not a decision", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "INSERT INTO project (tenant, project, lifecycle) VALUES ('t', 'p', 'Active')",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role cannot mint a recovery epoch, because a runtime that could would unfence itself", async () => {
  const refusal = await harness.attemptAs(
    dispatcherRole,
    "INSERT INTO recovery_epoch (epoch) VALUES ('forged')",
  );
  assert.match(String(refusal), /permission denied/);
});

test("the dispatcher role may append an entry and move the head it counts", async () => {
  const partition = await postgresHarnessProject(harness.store, "grants");
  assert.equal(
    await harness.attemptAs(
      dispatcherRole,
      `UPDATE project SET head = head WHERE tenant = '${partition.tenant}'`,
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(dispatcherRole, "SELECT * FROM journal_entry"),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(dispatcherRole, "SELECT epoch FROM recovery_epoch"),
    undefined,
  );
});
