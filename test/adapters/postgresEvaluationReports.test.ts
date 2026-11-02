import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import {
  postgresFailedLanding,
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import { asExecutionId } from "../../src/interpreter/executionScheduler.ts";
import {
  priorEvaluationReportsMax,
  priorWorkReportsMax,
} from "../../src/interpreter/taskBriefing.ts";
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

test("a list past its bound is answered as read, for composition to refuse rather than a throw", async () => {
  for (const [port, bound] of [
    [postgresPriorWorkReports, priorWorkReportsMax],
    [postgresPriorEvaluationReports, priorEvaluationReportsMax],
  ] as const) {
    const rows = Array.from({ length: bound + 1 }, (_unused, at) => ({
      report: `report ${String(at)}`,
    }));
    const pool = {
      query: () => Promise.resolve({ rows }),
    } as unknown as pg.Pool;
    const read = await port(pool).reports(partition, asExecutionId("task"));
    assert.equal(read.read, "Reports");
    assert.equal(
      read.read === "Reports" ? read.reports.reports.length : 0,
      bound + 1,
    );
  }
});

test("a failed landing read the database refuses is unavailable rather than a throw", async () => {
  const refused = Object.assign(
    new Error("permission denied for table execution_result_source"),
    { code: "42501" },
  );
  const pool = {
    query: () => Promise.reject(refused),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresFailedLanding(pool).landing(
      partition,
      asExecutionId("rework"),
    ),
    { read: "Unavailable" },
  );
});

test("a failed landing's row is its commits, the change's absent where no source was recorded", async () => {
  const rows = [
    {
      target_commit: "1".repeat(40),
      change_commit: null,
      conflicted: false,
      failure_kind: null,
      proposal_base_ref: null,
      proposal_base_commit: null,
      queue_group_commit: null,
    },
  ];
  const pool = {
    query: () => Promise.resolve({ rows }),
  } as unknown as pg.Pool;
  assert.deepEqual(
    await postgresFailedLanding(pool).landing(
      partition,
      asExecutionId("rework"),
    ),
    {
      read: "Landing",
      landing: { targetCommit: "1".repeat(40), conflicted: false },
    },
  );
});

/** A pool answering one failed-landing row whose attempt recorded the failure columns named. */
function failedLandingPool(
  why: Readonly<Record<string, string | null>>,
): pg.Pool {
  const rows = [
    {
      target_commit: "1".repeat(40),
      change_commit: "2".repeat(40),
      conflicted: false,
      failure_kind: null,
      proposal_base_ref: null,
      proposal_base_commit: null,
      queue_group_commit: null,
      ...why,
    },
  ];
  return { query: () => Promise.resolve({ rows }) } as unknown as pg.Pool;
}

test("a failed landing's row says why its attempt failed, and against which base", async () => {
  assert.deepEqual(
    await postgresFailedLanding(
      failedLandingPool({
        failure_kind: "QueueChecksFailed",
        proposal_base_ref: "refs/heads/trunk",
        proposal_base_commit: "3".repeat(40),
        queue_group_commit: "4".repeat(40),
      }),
    ).landing(partition, asExecutionId("rework")),
    {
      read: "Landing",
      landing: {
        targetCommit: "1".repeat(40),
        changeCommit: "2".repeat(40),
        conflicted: false,
        failure: "QueueChecksFailed",
        proposalBase: { ref: "refs/heads/trunk", commit: "3".repeat(40) },
        groupCommit: "4".repeat(40),
      },
    },
  );
});

test("a failed landing's row naming a kind this code never wrote is unavailable rather than a throw", async () => {
  assert.deepEqual(
    await postgresFailedLanding(
      failedLandingPool({ failure_kind: "SomethingNew" }),
    ).landing(partition, asExecutionId("rework")),
    { read: "Unavailable" },
  );
});
