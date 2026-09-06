import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import {
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import { asExecutionId } from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

test("the rows a bundle's pinned manifests answer are the reports in their order", async () => {
  const pool = {
    query: () =>
      Promise.resolve({
        rows: [{ report: "work one" }, { report: "work two" }],
      }),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresPriorWorkReports(pool).reports(
      partition,
      asExecutionId("evaluation"),
    ),
    { read: "Reports", reports: { reports: ["work one", "work two"] } },
  );
});

test("a read the database refuses is unavailable rather than a throw", async () => {
  const refused = Object.assign(
    new Error("permission denied for table input_bundle_reference"),
    { code: "42501" },
  );
  const pool = {
    query: () => Promise.reject(refused),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresPriorWorkReports(pool).reports(
      partition,
      asExecutionId("evaluation"),
    ),
    { read: "Unavailable" },
  );
});

test("the failed rows of the evaluation a rework follows are its reports in their order", async () => {
  const pool = {
    query: () =>
      Promise.resolve({
        rows: [{ report: "ci.sh exited 1" }, { report: "CHANGES at a.ts:1" }],
      }),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresPriorEvaluationReports(pool).reports(
      partition,
      asExecutionId("rework"),
    ),
    {
      read: "Reports",
      reports: { reports: ["ci.sh exited 1", "CHANGES at a.ts:1"] },
    },
  );
});

test("an evaluation read the database refuses is unavailable rather than a throw", async () => {
  const refused = Object.assign(
    new Error("permission denied for table execution_result_report"),
    { code: "42501" },
  );
  const pool = {
    query: () => Promise.reject(refused),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresPriorEvaluationReports(pool).reports(
      partition,
      asExecutionId("rework"),
    ),
    { read: "Unavailable" },
  );
});
