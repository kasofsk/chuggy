import assert from "node:assert/strict";
import { test } from "node:test";

import { currentRuntimeSchemaContract } from "../../src/adapters/postgres/runtimeSchema.ts";
import { selectorReviewRole } from "../../src/adapters/postgres/schema.ts";
import { selectorReviewDatabaseReady } from "../../src/roots/nativeHttp.ts";

function reviewPool(
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

test("selector review readiness verifies role, privilege and schema", async () => {
  assert.equal(
    await selectorReviewDatabaseReady(
      reviewPool({
        current_role: selectorReviewRole,
        review_feedback_readable: true,
      }) as never,
    ),
    true,
  );
  assert.equal(
    await selectorReviewDatabaseReady(
      reviewPool({
        current_role: selectorReviewRole,
        review_feedback_readable: false,
      }) as never,
    ),
    false,
  );
  assert.equal(
    await selectorReviewDatabaseReady(
      reviewPool(
        {
          current_role: selectorReviewRole,
          review_feedback_readable: true,
        },
        [],
      ) as never,
    ),
    false,
  );
});

test("selector review readiness becomes false when its pool is lost", async () => {
  assert.equal(
    await selectorReviewDatabaseReady({
      query: () => Promise.reject(new Error("connection lost")),
    } as never),
    false,
  );
});
