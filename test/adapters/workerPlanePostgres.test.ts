import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import {
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import { postgresWorkerReportStore } from "../../src/adapters/postgres/workerPlane.ts";
import { migration028 } from "../../src/adapters/postgres/schema/migrations/028-worker-plane-authority.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const attempt = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  execution: asExecutionId("execution"),
  attempt: asAttemptId("attempt"),
  generation: 4,
};

test("the worker role reaches database state only through its three boundaries", () => {
  const grants = migration028.statements.filter((statement) =>
    statement.includes(`TO ${workerPlaneRole}`),
  );
  assert.equal(grants.length, 5);
  for (const grant of grants)
    assert.match(grant, /^GRANT (?:EXECUTE ON FUNCTION|USAGE ON SCHEMA)/u);
  assert.doesNotMatch(
    grants.join("\n"),
    /open|admit|fence_old|execution_attempt\s+TO/u,
  );
});

test("every worker boundary fences against the latest recovery epoch", () => {
  const boundaries = migration028.statements.filter(
    (statement) =>
      statement.startsWith("CREATE FUNCTION") &&
      /(?:read_worker_attempt|lose_worker_attempt|submit_worker_result)/u.test(
        statement,
      ),
  );
  assert.equal(boundaries.length, 3);
  for (const boundary of boundaries)
    assert.match(
      boundary,
      /SELECT epoch FROM recovery_epoch\s+ORDER BY ordinal DESC LIMIT 1/u,
    );
});

test("terminal attempts authenticate only as non-live report authority", () => {
  const boundary = migration028.statements.find((statement) =>
    statement.includes("CREATE FUNCTION read_worker_attempt"),
  );
  assert.notEqual(boundary, undefined);
  assert.match(boundary ?? "", /a\.state IN \('Placing','Running'\)/u);
  assert.match(boundary ?? "", /e\.status IN \('Launching','Running'\)/u);
  assert.match(boundary ?? "", /a\.state='Reported' AND e\.status='Terminal'/u);
});

test("result submission follows the scheduler completion lock order", () => {
  const boundary = migration028.statements.find((statement) =>
    statement.includes("CREATE FUNCTION submit_worker_result"),
  );
  assert.notEqual(boundary, undefined);
  const request = boundary?.indexOf("FROM execution_request q") ?? -1;
  const execution = boundary?.indexOf("FOR UPDATE OF e") ?? -1;
  const project = boundary?.indexOf("FROM project") ?? -1;
  const attempt = boundary?.indexOf("UPDATE execution_attempt") ?? -1;
  assert.ok(request >= 0 && request < execution);
  assert.ok(execution < project);
  assert.ok(project < attempt);
  assert.doesNotMatch(boundary ?? "", /FOR UPDATE OF q,e,a/u);
});

test("losing a report passes only the capability digest, generation and closed evidence", async () => {
  const statements: unknown[] = [];
  const pool = {
    query: (statement: unknown) => {
      statements.push(statement);
      return Promise.resolve({ rows: [{ ended: true }] });
    },
  } as unknown as pg.Pool;
  const store = postgresWorkerReportStore(
    pool,
    asAttemptCapabilitySecret("held"),
  );
  assert.equal(
    await store.attemptEnded(attempt, "Lost", "ManifestInvalid"),
    true,
  );
  const statement = statements[0] as {
    readonly template: readonly string[];
    readonly rawValues: readonly unknown[];
  };
  assert.match(statement.template.join(""), /lose_worker_attempt/u);
  assert.equal(statement.rawValues[1], 4);
  assert.equal(statement.rawValues[2], "ManifestInvalid");
  assert.notEqual(statement.rawValues[0], "held");
});

test("the result boundary's durable conflict stays distinct from fencing", async () => {
  const pool = {
    query: () =>
      Promise.resolve({
        rows: [
          {
            terminalized: "Conflicting",
            outcome: null,
            operation: null,
            incident: "incident-one",
          },
        ],
      }),
  } as unknown as pg.Pool;
  const store = postgresWorkerReportStore(
    pool,
    asAttemptCapabilitySecret("held"),
  );
  const terminalized = store.terminalize as unknown as (
    report: unknown,
  ) => Promise<unknown>;
  const result = await terminalized({
    ...attempt,
    manifest: {
      manifest: "manifest",
      schemaVersion: 1,
      digest: "d".repeat(64),
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
    },
  });
  assert.deepEqual(result, {
    terminalized: "Conflicting",
    incident: "incident-one",
  });
});

test("a source handoff crosses the worker boundary as a distinct value", async () => {
  const statements: unknown[] = [];
  const pool = {
    query: (statement: unknown) => {
      statements.push(statement);
      return Promise.resolve({
        rows: [
          {
            terminalized: "Terminalized",
            outcome: "Passed",
            operation: "operation-one",
            incident: null,
          },
        ],
      });
    },
  } as unknown as pg.Pool;
  const store = postgresWorkerReportStore(
    pool,
    asAttemptCapabilitySecret("held"),
  );
  await store.terminalize({
    ...attempt,
    manifest: {
      manifest: "manifest",
      schemaVersion: 2,
      digest: "d".repeat(64),
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
      source: {
        repository: "repository-one",
        ref: "refs/heads/chuggy/tickets/ticket-one/attempts/attempt-one",
        commit: "a".repeat(40),
        base: "b".repeat(40),
      },
    },
  } as never);
  const statement = statements[0] as {
    readonly template: readonly string[];
    readonly rawValues: readonly unknown[];
  };
  assert.match(statement.template.join(""), /::jsonb,\s*::jsonb/u);
  assert.equal(
    statement.rawValues[7],
    JSON.stringify({
      repository: "repository-one",
      ref: "refs/heads/chuggy/tickets/ticket-one/attempts/attempt-one",
      commit: "a".repeat(40),
      base: "b".repeat(40),
    }),
  );
});
