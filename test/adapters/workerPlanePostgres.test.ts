import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import {
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import { postgresWorkerReportStore } from "../../src/adapters/postgres/workerPlane.ts";
import { postgresSessionPlane } from "../../src/adapters/postgres/sessionPlane.ts";
import {
  asSessionBearerSecret,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { migration028 } from "../../src/adapters/postgres/schema/migrations/028-worker-plane-authority.ts";
import { migration037 } from "../../src/adapters/postgres/schema/migrations/037-evaluation-work-reports.ts";
import { migration049 } from "../../src/adapters/postgres/schema/migrations/049-run-evidence.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const attempt = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  execution: asExecutionId("execution"),
  attempt: asAttemptId("attempt"),
  generation: 4,
};

function transactionalPool(
  query: (statement: unknown) => Promise<{ readonly rows: readonly unknown[] }>,
): pg.Pool {
  return {
    connect: () =>
      Promise.resolve({
        query: (statement: unknown) =>
          typeof statement === "string"
            ? Promise.resolve({ rows: [] })
            : query(statement),
        on: () => undefined,
        removeListener: () => undefined,
        release: () => undefined,
      }),
  } as unknown as pg.Pool;
}

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

test("the report summary boundary grants no table authority to the worker role", () => {
  const grants = migration037.statements.filter(
    (statement) =>
      statement.startsWith("GRANT") &&
      statement.includes(`TO ${workerPlaneRole}`),
  );
  assert.equal(grants.length, 1);
  assert.match(grants[0] ?? "", /^GRANT EXECUTE ON FUNCTION/u);
  assert.doesNotMatch(grants[0] ?? "", /execution_result_report\s+TO/u);
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
  const pool = transactionalPool(() =>
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
  );
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
  const pool = transactionalPool((statement: unknown) => {
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
  });
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

test("a current worker result persists its report in the completion transaction", async () => {
  const statements: unknown[] = [];
  const pool = transactionalPool((statement) => {
    statements.push(statement);
    return Promise.resolve({
      rows:
        statements.length === 1
          ? [
              {
                terminalized: "Terminalized",
                outcome: "Passed",
                operation: "operation-one",
                incident: null,
              },
            ]
          : [{ stored: true }],
    });
  });
  const store = postgresWorkerReportStore(
    pool,
    asAttemptCapabilitySecret("held"),
  );
  await store.terminalize({
    ...attempt,
    manifest: {
      manifest: "manifest",
      schemaVersion: 3,
      digest: "d".repeat(64),
      verdict: "Pass",
      report: "Changed the parser and ran its focused test.",
      handoffs: [],
      diagnostics: [],
    },
  } as never);
  const stored = statements[1] as {
    readonly template: readonly string[];
    readonly rawValues: readonly unknown[];
  };
  assert.match(stored.template.join(""), /store_worker_result_report/u);
  assert.equal(
    stored.rawValues[2],
    "Changed the parser and ran its focused test.",
  );
});

test("run evidence grants the worker role four functions and no table", () => {
  const grants = migration049.statements.filter(
    (statement) =>
      statement.startsWith("GRANT") &&
      statement.includes(`TO ${workerPlaneRole}`),
  );
  assert.equal(grants.length, 4);
  for (const grant of grants)
    assert.match(grant, /^GRANT EXECUTE ON FUNCTION record_worker_run_/u);
  assert.deepEqual(
    migration049.statements.filter(
      (statement) =>
        statement.includes(workerPlaneRole) &&
        !statement.startsWith("GRANT EXECUTE ON FUNCTION"),
    ),
    [],
  );
});

/**
 * The five measured parameters, in the order the contract declares them.
 *
 * `cost_micros` and `duration_ms` are both `bigint` and both counts, so a swap
 * between them is type-clean: SafeQL under `check-queries` validates argument
 * types and cannot see it, and the durable suites would write and read the
 * swapped pair back unchanged. What refuses it is the position each value is
 * bound at, which is what this reads — off the parameter array the driver would
 * send, not off the source text.
 */
const measured = {
  model: "claude-haiku-4-5",
  tokens: 48_182,
  costMicros: 38_160,
  durationMs: 5_195,
  tools: ["Bash", "Read"],
};

/** One statement as the driver would receive it: the text, and the values by position. */
interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

function recordingPool(recorded: RecordedQuery[]): pg.Pool {
  return {
    query: (statement: RecordedQuery) => {
      recorded.push({ text: statement.text, values: statement.values });
      return Promise.resolve({ rows: [{ answered: "Answered" }] });
    },
  } as unknown as pg.Pool;
}

/** The one statement a recorded answer asked, refusing a run that asked any other number. */
function only(recorded: readonly RecordedQuery[]): RecordedQuery {
  const [statement, ...rest] = recorded;
  assert.equal(
    rest.length,
    0,
    "answering a turn asked more than one statement",
  );
  if (statement === undefined)
    throw new Error("answering a turn asked nothing");
  return statement;
}

/** One answer over a pool that records rather than connects, its measurement optional. */
function recordedAnswer(
  recorded: RecordedQuery[],
  measurement?: typeof measured,
): Promise<unknown> {
  return postgresSessionPlane(recordingPool(recorded)).answer({
    secret: asSessionBearerSecret(`chgs_${"a".repeat(32)}`),
    generation: 3,
    turn: asSessionTurnId("turn-7"),
    result: "done",
    batchFirst: 12,
    batchLast: 14,
    ...(measurement === undefined ? {} : { measured: measurement }),
  });
}

test("a measured turn binds the five to the positions the contract declares", async () => {
  const recorded: RecordedQuery[] = [];

  assert.equal(await recordedAnswer(recorded, measured), "Answered");
  const statement = only(recorded);
  assert.match(statement.text, /answer_session_turn\(/u);
  assert.deepEqual(statement.values.slice(4), [
    12,
    14,
    measured.model,
    measured.tokens,
    measured.costMicros,
    measured.durationMs,
    measured.tools,
  ]);
});

test("a turn with nothing measured binds the five as absent together", async () => {
  const recorded: RecordedQuery[] = [];

  await recordedAnswer(recorded);

  assert.deepEqual(only(recorded).values.slice(4), [
    12,
    14,
    null,
    null,
    null,
    null,
    null,
  ]);
});
