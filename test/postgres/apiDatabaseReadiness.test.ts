/**
 * The two checks the API asks of its pools before it starts, against a real
 * server. A database that answered is answered yes or no, including one that
 * was never migrated; a raise is left for a database that could not be reached
 * or queried, which is the split the start-up refusal reports.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresApiReady } from "../../src/adapters/postgres/apiReadiness.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  selectorReviewRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorContextReady } from "../../src/adapters/postgres/selectorContextReadiness.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import { migrationDatabase } from "./migrationHarness.ts";

/** A pool holding one deployment role over the database `url` names. */
function rolePoolAt(url: string, role: string) {
  const at = new URL(url);
  at.searchParams.set("options", `-c role=${role}`);
  return postgresPool(at.toString());
}

test("each check answers yes over the migrated schema as its own role, and no as the other's", async () => {
  const api = postgresHarnessRolePool(apiRole);
  const review = postgresHarnessRolePool(selectorReviewRole);
  try {
    assert.equal(await postgresApiReady(api), true);
    assert.equal(await postgresSelectorContextReady(review), true);
    assert.equal(await postgresApiReady(review), false);
    assert.equal(await postgresSelectorContextReady(api), false);
  } finally {
    await Promise.all([api.end(), review.end()]);
  }
});

test("a database that answered but was never migrated is answered no rather than raised, as either check's own role", async () => {
  await migrationDatabase("unmigrated_ready", async (_subject, url) => {
    const api = rolePoolAt(url, apiRole);
    const review = rolePoolAt(url, selectorReviewRole);
    try {
      assert.equal(await postgresApiReady(api), false);
      assert.equal(await postgresSelectorContextReady(review), false);
    } finally {
      await Promise.all([api.end(), review.end()]);
    }
  });
});
