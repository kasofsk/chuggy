import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";

import { postgresExecutionSourceHistory } from "../../src/adapters/postgres/executionSourceHistory.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

test("evaluation manifests come from the same latest work request as its source", async () => {
  let statement = "";
  const pool = {
    query: (query: { readonly text: string }) => {
      statement = query.text;
      return Promise.resolve({
        rows: [
          {
            repository: "repository",
            target_commit: "a".repeat(40),
            manifests: ["manifest-latest"],
          },
        ],
      });
    },
  } as unknown as pg.Pool;
  const source = await postgresExecutionSourceHistory(pool).workSource(
    { tenant: asTenantId("tenant"), project: asProjectId("project") },
    1,
  );
  assert.equal(source?.manifests[0], "manifest-latest");
  assert.match(statement, /SELECT request,input_bundle/u);
  assert.match(statement, /e\.source_request=work\.request/u);
});
