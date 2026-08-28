/**
 * The statements a worker makes its attempt's database with, run against a real
 * PostgreSQL.
 *
 * WHY THIS SUITE EXISTS. `images/worker/postgres.test.mjs` drives the module
 * against a recorded `executeFile` and asserts the text it emits, which is a
 * claim about what the module says and never about what a server answers. It
 * was green over a sequence the server refused: `CREATE DATABASE ... OWNER`
 * needs the creator to be able to `SET ROLE` to that owner, and the membership
 * a CREATEROLE role receives in a role it creates carries ADMIN without SET.
 * That reached a deployed image, and nothing in this tree could have caught it.
 *
 * IT RUNS THE SHIPPED STATEMENTS, not a copy of them: the module exports the
 * sequence, this asks a server to execute it, so the two cannot drift apart.
 *
 * THE ROLE THAT RUNS THEM IS NOT THE ONE A DEPLOYMENT USES. The gate connects
 * as the server's owner, which may create roles and databases for reasons of
 * its own; what a site's `chuggy_worker` may do is
 * `deploy/rig/postgres/worker-database-roles.sql`'s claim, and this suite
 * cannot make it. What it does establish is that the sequence is one PostgreSQL
 * accepts at all, which is what failed.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  scopedDatabaseOwnedQuery,
  scopedDatabaseStatements,
} from "../../images/worker/postgres.mjs";
import {
  postgresLimitsDefault,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import { postgresHarnessUrl } from "./harness.ts";

/**
 * One connection at a time is all this asks for, and the gate runs its workers
 * against one server: a pool sized for a serving process would hold seven
 * others open for the length of the file.
 */
const pool = postgresPool(postgresHarnessUrl(), {
  ...postgresLimitsDefault,
  connectionsMax: 1,
});
after(async () => {
  await pool.end();
});

/** Every database one role owns, as the names the shipped query returns. */
async function ownedDatabases(name: string): Promise<readonly string[]> {
  const owned = await pool.query<{ readonly datname: string }>(
    scopedDatabaseOwnedQuery(name),
  );
  return owned.rows.map((row) => row.datname);
}

/** A scope of this suite's own, spelled as the launch adapter spells one. */
function scope(): string {
  return `chug_test_${randomUUID().replaceAll("-", "")}`;
}

async function removeScope(name: string): Promise<void> {
  for (const database of await ownedDatabases(name))
    await pool.query(
      `DROP DATABASE IF EXISTS "${database.replaceAll('"', '""')}" WITH (FORCE)`,
    );
  await pool.query(`DROP ROLE IF EXISTS ${name}`);
}

test("the statements a worker ships are ones a server accepts", async () => {
  const name = scope();
  try {
    for (const sql of scopedDatabaseStatements(name, "attempt-secret"))
      await pool.query(sql);

    const owner = await pool.query<{ readonly owner: string }>(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
      [name],
    );
    assert.deepEqual(
      owner.rows.map((row) => row.owner),
      [name],
      "the attempt's database is owned by the attempt's role",
    );

    const connectable = await pool.query<{ readonly granted: boolean }>(
      "SELECT has_database_privilege('public', $1, 'CONNECT') AS granted",
      [name],
    );
    assert.equal(
      connectable.rows[0]?.granted,
      false,
      "PUBLIC still connects, so another attempt's role reaches this database",
    );
  } finally {
    await removeScope(name);
  }
});

test("teardown finds every database the attempt's role owns, not only the named one", async () => {
  const name = scope();
  try {
    for (const sql of scopedDatabaseStatements(name, "attempt-secret"))
      await pool.query(sql);
    await pool.query(`CREATE DATABASE ${name}_w1 OWNER ${name}`);

    assert.deepEqual(
      [...(await ownedDatabases(name))].sort(),
      [name, `${name}_w1`],
      "a database the gates clone would be left behind",
    );
  } finally {
    await removeScope(name);
  }
});
