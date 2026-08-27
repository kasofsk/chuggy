import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresPriorWorkReports } from "../../src/adapters/postgres/evaluationReports.ts";
import { asExecutionId } from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

test("evaluation reports come only from result manifests pinned by the execution bundle", async () => {
  let statement: unknown;
  const pool = {
    query: (queried: unknown) => {
      statement = queried;
      return Promise.resolve({
        rows: [{ report: "work one" }, { report: "work two" }],
      });
    },
  } as unknown as pg.Pool;
  const reports = await postgresPriorWorkReports(pool).reports(
    { tenant: asTenantId("tenant"), project: asProjectId("project") },
    asExecutionId("evaluation"),
  );
  assert.deepEqual(reports, { reports: ["work one", "work two"] });
  const query = statement as { readonly template: readonly string[] };
  assert.match(query.template.join(""), /read_scheduler_work_reports/u);
});
