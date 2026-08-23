import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
  runtimeSchemaContract,
} from "../../src/adapters/postgres/runtimeSchema.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";

test("runtime readiness reads the ordered ledger and never migrates", async () => {
  const statements: unknown[] = [];
  const pool = {
    query: (statement: unknown) => {
      statements.push(statement);
      return Promise.resolve({
        rows: [
          { version: 1, name: "foundation" },
          { version: 2, name: "expand" },
        ],
      });
    },
  } as unknown as pg.Pool;

  assert.deepEqual(
    await postgresRuntimeSchema(pool).applied(new AbortController().signal),
    [
      { version: 1, name: "foundation" },
      { version: 2, name: "expand" },
    ],
  );
  assert.equal(statements.length, 1);
  const statement = statements[0] as {
    readonly template: readonly string[];
    readonly rawValues: readonly unknown[];
  };
  assert.deepEqual(statement.template, [
    "SELECT version,name FROM schema_migration ORDER BY version",
  ]);
  assert.deepEqual(statement.rawValues, []);
});

test("a release contract distinguishes required migrations from staged compatibility", () => {
  const foundation = { version: 1, name: "foundation" };
  const expand = { version: 2, name: "expand" };
  assert.deepEqual(runtimeSchemaContract([foundation], [foundation, expand]), {
    required: [foundation],
    compatible: [foundation, expand],
  });
});

test("the current runtime contract is the declared migration history", () => {
  const declared = migrations.map(({ version, name }) => ({ version, name }));
  assert.deepEqual(currentRuntimeSchemaContract, {
    required: declared,
    compatible: declared,
  });
});
