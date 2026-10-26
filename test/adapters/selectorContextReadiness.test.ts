import assert from "node:assert/strict";
import { test } from "node:test";

import { currentRuntimeSchemaContract } from "../../src/adapters/postgres/runtimeSchema.ts";
import { selectorReviewRole } from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorContextReady } from "../../src/adapters/postgres/selectorContextReadiness.ts";

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
    await postgresSelectorContextReady(
      reviewPool({
        current_role: selectorReviewRole,
        review_feedback_readable: true,
      }) as never,
    ),
    true,
  );
  assert.equal(
    await postgresSelectorContextReady(
      reviewPool({
        current_role: selectorReviewRole,
        review_feedback_readable: false,
      }) as never,
    ),
    false,
  );
  assert.equal(
    await postgresSelectorContextReady(
      reviewPool({
        current_role: "chuggy_api",
        review_feedback_readable: true,
      }) as never,
    ),
    false,
  );
  assert.equal(
    await postgresSelectorContextReady(
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

test("selector review readiness raises its pool's own failure rather than answering no", async () => {
  await assert.rejects(
    postgresSelectorContextReady({
      query: () =>
        Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1")),
    } as never),
    /^Error: connect ECONNREFUSED 127\.0\.0\.1:1$/u,
  );
});
