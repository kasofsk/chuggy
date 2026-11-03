/**
 * The migrate entry points: a fresh installation applies the declared chain
 * once and then nothing, concurrent callers install it once, a ledger the chain
 * does not extend is refused untouched by both runners, and a failed or
 * incompatible run leaves the database as it found it.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  migrations,
  migrationLedger,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresMigrate,
  postgresMigrateCompatible,
} from "../../src/adapters/postgres/pool.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import { schemaCompatibilityPrecondition } from "../../src/interpreter/serviceRuntime.ts";
import { migrationDatabase } from "./migrationHarness.ts";

async function migrationCommandRun(
  url: string,
): Promise<{ readonly code: number; readonly report: string }> {
  const run = promisify(execFile)(
    process.execPath,
    ["--experimental-strip-types", "src/roots/migrate.ts"],
    {
      cwd: process.cwd(),
      env: {
        CHUG_MIGRATE_DATABASE_URL: url,
      },
    },
  );
  const settled = await run.catch((failure: unknown) => failure);
  const { stdout, stderr, code } = settled as {
    stdout: string;
    stderr: string;
    code?: number;
  };
  return { code: code ?? 0, report: `${stdout}${stderr}`.trim() };
}

test("the command applies the declared schema and the run after it applies nothing", async () => {
  await migrationDatabase("command", async (subject, url) => {
    assert.deepEqual(await migrationCommandRun(url), {
      code: 0,
      report: `migrate: applied ${migrations.map(({ version }) => version).join(",")}`,
    });
    assert.deepEqual(await migrationCommandRun(url), {
      code: 0,
      report: "migrate: the schema was already current",
    });
    assert.equal(
      (
        await schemaCompatibilityPrecondition(
          postgresRuntimeSchema(subject),
          currentRuntimeSchemaContract,
        ).check(new AbortController().signal)
      ).met,
      "Met",
    );
  });
});

test("fresh journals receive different durable installation authorities", async () => {
  const identities: string[] = [];
  for (const label of ["authority_a", "authority_b"]) {
    await migrationDatabase(label, async (subject) => {
      await postgresMigrate(subject);
      const first = await subject.query<{ installation_id: string }>(
        "SELECT installation_id FROM installation_authority",
      );
      await postgresMigrate(subject);
      const restarted = await subject.query<{ installation_id: string }>(
        "SELECT installation_id FROM installation_authority",
      );
      assert.deepEqual(restarted.rows, first.rows);
      identities.push(first.rows[0]?.installation_id ?? "");
    });
  }
  assert.equal(identities.length, 2);
  assert.notEqual(identities[0], identities[1]);
});

test("concurrent migration callers install the baseline once", async () => {
  await migrationDatabase("concurrent", async (subject) => {
    const results = await Promise.all([
      postgresMigrate(subject),
      postgresMigrate(subject),
    ]);
    assert.deepEqual(
      results.flat(),
      migrations.map(({ version }) => version),
    );
    assert.ok(results.some((versions) => versions.length === 0));
    assert.deepEqual(
      await postgresRuntimeSchema(subject).applied(
        new AbortController().signal,
      ),
      currentRuntimeSchemaContract.required,
    );
  });
});

test("historical, divergent and future ledgers are refused untouched by both runners", async () => {
  for (const applied of [
    [
      { version: 1, name: "the project foundation" },
      { version: 94, name: "a binding is retired" },
    ],
    [{ version: 1, name: "another baseline" }],
    [
      ...currentRuntimeSchemaContract.required,
      { version: 999, name: "future" },
    ],
  ]) {
    await migrationDatabase("foreign", async (subject, url) => {
      await subject.query(migrationLedger);
      for (const row of applied)
        await subject.query(
          "INSERT INTO schema_migration(version,name) VALUES($1,$2)",
          [row.version, row.name],
        );
      const run = await migrationCommandRun(url);
      assert.equal(run.code, 2);
      await assert.rejects(postgresMigrate(subject), /incompatible/u);
      assert.deepEqual(
        await postgresRuntimeSchema(subject).applied(
          new AbortController().signal,
        ),
        applied,
      );
      assert.equal(
        (
          await subject.query<{ relation: string | null }>(
            "SELECT to_regclass('installation_authority') AS relation",
          )
        ).rows[0]?.relation,
        null,
      );
    });
  }
});

test("an incompatible rollout leaves an empty database untouched", async () => {
  await migrationDatabase("rollout", async (subject) => {
    const incompatible = {
      required: [{ version: 1, name: "the project foundation" }],
      compatible: [{ version: 1, name: "the project foundation" }],
    };
    assert.deepEqual(
      await postgresMigrateCompatible(subject, {
        current: currentRuntimeSchemaContract,
        retainedPrevious: incompatible,
      }),
      { migrated: "CouldNotRun" },
    );
    assert.deepEqual(
      (await subject.query("SELECT to_regclass('schema_migration') AS ledger"))
        .rows,
      [{ ledger: null }],
    );
  });
});

test("a failed baseline rolls back its objects and ledger and can be retried", async () => {
  await migrationDatabase("rollback", async (subject, url) => {
    await subject.query("CREATE TABLE installation_authority (sentinel text)");
    await subject.query(
      "INSERT INTO installation_authority VALUES ('untouched')",
    );
    const run = await migrationCommandRun(url);
    assert.equal(run.code, 1);
    assert.match(run.report, /installation_authority/u);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT to_regclass('schema_migration') AS ledger, to_regclass('agent_session') AS relation, to_regprocedure('command_integer(jsonb)') AS function",
        )
      ).rows,
      [{ ledger: null, relation: null, function: null }],
    );
    assert.deepEqual(
      (await subject.query("SELECT * FROM installation_authority")).rows,
      [{ sentinel: "untouched" }],
    );
    await subject.query("DROP TABLE installation_authority");
    assert.equal((await migrationCommandRun(url)).code, 0);
  });
});
