import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type pg from "pg";

import { postgresWorkerPoolRegistrationTokens } from "../../src/adapters/postgres/workerPool.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let api: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  api = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await api.end();
  await harness.close();
});

/** A digest is 64 hex characters or the row refuses it, so each case draws one. */
function digestOf(label: string): string {
  return label.padEnd(64, "0");
}

async function project(name: string): Promise<Partition> {
  return postgresHarnessProject(harness.store, name);
}

test("a token stands for the partition it was minted against", async () => {
  const partition = await project("token-mint");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  const digest = digestOf("abc");
  assert.equal(
    await tokens.mint(partition, digest, ["linux"], Date.now() + 60_000),
    true,
  );
  assert.deepEqual(await tokens.permitted(digest), {
    partition,
    capabilities: ["linux"],
  });
});

test("a token is spent by the statement that reads it, and once", async () => {
  const partition = await project("token-spend");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  const digest = digestOf("bcd");
  assert.equal(
    await tokens.mint(partition, digest, ["linux"], Date.now() + 60_000),
    true,
  );
  assert.deepEqual(await tokens.consume(digest), {
    partition,
    capabilities: ["linux"],
  });
  assert.equal(await tokens.consume(digest), undefined);
  assert.equal(
    await tokens.permitted(digest),
    undefined,
    "a spent token reads as no token at all",
  );
});

test("a token past its expiry is neither readable nor spendable", async () => {
  const partition = await project("token-expired");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  const digest = digestOf("cde");
  assert.equal(
    await tokens.mint(partition, digest, ["linux"], Date.now() - 1_000),
    true,
  );
  assert.equal(await tokens.permitted(digest), undefined);
  assert.equal(await tokens.consume(digest), undefined);
});

test("a token names no project the installation does not run tickets for", async () => {
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  assert.equal(
    await tokens.mint(
      { tenant: "absent", project: "absent" } as Partition,
      digestOf("def"),
      [],
      Date.now() + 60_000,
    ),
    false,
  );
});
