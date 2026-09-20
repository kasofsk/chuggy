import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import type pg from "pg";

import { postgresWorkerPoolRegistrationTokens } from "../../src/adapters/postgres/workerPool.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { workerPoolTokensLiveMax } from "../../src/interpreter/workerPoolRegistrationToken.ts";
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
    "Minted",
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
    "Minted",
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
    "Minted",
  );
  assert.equal(await tokens.permitted(digest), undefined);
  assert.equal(await tokens.consume(digest), undefined);
});

test("a token given back after its spend is spendable again, unless it has expired", async () => {
  const partition = await project("token-restore");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  const digest = digestOf("dee");
  assert.equal(
    await tokens.mint(partition, digest, ["linux"], Date.now() + 60_000),
    "Minted",
  );
  assert.notEqual(await tokens.consume(digest), undefined);
  assert.equal(await tokens.restore(digest), true);
  assert.deepEqual(await tokens.permitted(digest), {
    partition,
    capabilities: ["linux"],
  });
  assert.notEqual(await tokens.consume(digest), undefined);
  assert.equal(
    await tokens.consume(digest),
    undefined,
    "a restored token is still single use",
  );
  const expired = digestOf("eef");
  assert.equal(
    await tokens.mint(partition, expired, ["linux"], Date.now() - 1_000),
    "Minted",
  );
  assert.equal(await tokens.restore(expired), false);
  assert.equal(await tokens.permitted(expired), undefined);
});

test("a token names no project this installation holds", async () => {
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  assert.equal(
    await tokens.mint(
      { tenant: "absent", project: "absent" } as Partition,
      digestOf("def"),
      [],
      Date.now() + 60_000,
    ),
    "NotFound",
  );
});

/** How many tokens of one project's are on the table, live or not. */
async function tokensOf(partition: Partition): Promise<number> {
  const counted = await harness.query(
    `SELECT count(*)::int AS held FROM worker_pool_registration_token
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  return counted[0]?.["held"] as number;
}

test("a project holds at most its bound of live tokens, and a mint sweeps what is spent or expired", async () => {
  const partition = await project("token-bound");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  const digest = (ordinal: number) =>
    digestOf(`b${ordinal.toString(16).padStart(2, "0")}`);
  for (let minted = 0; minted < workerPoolTokensLiveMax; minted += 1)
    assert.equal(
      await tokens.mint(partition, digest(minted), [], Date.now() + 60_000),
      "Minted",
      `token ${String(minted)} is within the bound`,
    );
  assert.equal(
    await tokens.mint(partition, digestOf("0e"), [], Date.now() + 60_000),
    "LimitReached",
  );
  assert.equal(await tokensOf(partition), workerPoolTokensLiveMax);
  assert.notEqual(await tokens.consume(digest(0)), undefined);
  assert.equal(
    await tokens.mint(partition, digestOf("af"), [], Date.now() + 60_000),
    "Minted",
    "a spent token no longer counts against the bound",
  );
  assert.equal(await tokensOf(partition), workerPoolTokensLiveMax);
  assert.equal(
    await tokens.permitted(digest(0)),
    undefined,
    "the spent token was swept by the mint that followed it",
  );
  const elsewhere = await project("token-bound-elsewhere");
  assert.equal(
    await tokens.mint(elsewhere, digestOf("07"), [], Date.now() + 60_000),
    "Minted",
    "the bound is one project's, not the table's",
  );
  assert.equal(await tokensOf(partition), workerPoolTokensLiveMax);
});

test("a mint sweeps the project's expired tokens with its spent ones", async () => {
  const partition = await project("token-sweep");
  const tokens = postgresWorkerPoolRegistrationTokens(api);
  assert.equal(
    await tokens.mint(partition, digestOf("5a1e"), [], Date.now() - 1_000),
    "Minted",
  );
  assert.equal(await tokensOf(partition), 1);
  assert.equal(
    await tokens.mint(partition, digestOf("f5e5"), [], Date.now() + 60_000),
    "Minted",
  );
  assert.equal(await tokensOf(partition), 1);
  assert.notEqual(await tokens.permitted(digestOf("f5e5")), undefined);
});
