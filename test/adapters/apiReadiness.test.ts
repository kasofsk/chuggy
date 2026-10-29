import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresApiReady } from "../../src/adapters/postgres/apiReadiness.ts";
import { currentRuntimeSchemaContract } from "../../src/adapters/postgres/runtimeSchema.ts";
import {
  apiRole,
  selectorReviewRole,
} from "../../src/adapters/postgres/schema.ts";

function apiPool(
  first: unknown,
  schema: unknown = currentRuntimeSchemaContract.required,
) {
  let queries = 0;
  return {
    query: () => {
      queries += 1;
      return Promise.resolve({ rows: queries === 1 ? [first] : schema });
    },
  };
}

test("API readiness verifies role, grant and schema", async () => {
  assert.equal(
    await postgresApiReady(
      apiPool({ current_role: apiRole, authorized: true }) as never,
    ),
    true,
  );
  assert.equal(
    await postgresApiReady(
      apiPool({ current_role: apiRole, authorized: false }) as never,
    ),
    false,
  );
  assert.equal(
    await postgresApiReady(
      apiPool({
        current_role: selectorReviewRole,
        authorized: true,
      }) as never,
    ),
    false,
  );
  assert.equal(
    await postgresApiReady(
      apiPool({ current_role: apiRole, authorized: true }, []) as never,
    ),
    false,
  );
});

test("API readiness raises its pool's own failure rather than answering no", async () => {
  await assert.rejects(
    postgresApiReady({
      query: () =>
        Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1")),
    } as never),
    /^Error: connect ECONNREFUSED 127\.0\.0\.1:1$/u,
  );
});

test("API readiness raises a failure of its schema read after its role was answered, rather than answering no", async () => {
  let queries = 0;
  await assert.rejects(
    postgresApiReady({
      query: () => {
        queries += 1;
        return queries === 1
          ? Promise.resolve({
              rows: [{ current_role: apiRole, authorized: true }],
            })
          : Promise.reject(new Error("Connection terminated unexpectedly"));
      },
    } as never),
    /^Error: Connection terminated unexpectedly$/u,
  );
  assert.equal(queries, 2, "the schema read was the one that failed");
});
