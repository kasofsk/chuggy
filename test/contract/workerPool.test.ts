/**
 * The worker-pool wire shapes, read as a third party's implementation would
 * read them: what is admitted, what is refused, and what carries no field it
 * was not given.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentOutcomeSchema,
  workerPoolRetryAfterSecsMax,
  workerPoolAssignmentSchema,
  workerPoolCapabilitiesMax,
  workerPoolIdentityCharsMax,
  workerPoolPollQuerySchema,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolRegistrationSchema,
  workerPoolSettlementPath,
  workerPoolSettlementRoutes,
} from "../../src/contract/workerPool.ts";

const assignment = {
  assignment: "01HZ",
  capabilities: ["linux", "containers"],
  cpuMillis: 1_000,
  memoryMib: 1_024,
  deadlineSecs: 3_600,
  callbackUrl: "https://worker-plane.invalid/v1/ticket-execution/attempt/01HZ",
  bearer: "attempt-secret",
};

test("an assignment carries the placement fields and nothing beside them", () => {
  assert.deepEqual(workerPoolAssignmentSchema.parse(assignment), assignment);
  for (const extra of ["taskKey", "ticket", "repository", "obligation"])
    assert.equal(
      workerPoolAssignmentSchema.safeParse({ ...assignment, [extra]: "x" })
        .success,
      false,
    );
});

test("an assignment is bounded in every member a pool could grow", () => {
  for (const invalid of [
    { ...assignment, cpuMillis: 0 },
    { ...assignment, memoryMib: 1.5 },
    { ...assignment, deadlineSecs: -1 },
    { ...assignment, callbackUrl: "not-a-url" },
    { ...assignment, bearer: "" },
    { ...assignment, capabilities: ["has space"] },
    {
      ...assignment,
      capabilities: Array.from(
        { length: workerPoolCapabilitiesMax + 1 },
        (_value, index) => `c${String(index)}`,
      ),
    },
  ])
    assert.equal(workerPoolAssignmentSchema.safeParse(invalid).success, false);
});

test("an outcome tells a settled no from the pool's own backpressure", () => {
  assert.deepEqual(assignmentOutcomeSchema.parse({ outcome: "Accepted" }), {
    outcome: "Accepted",
  });
  assert.equal(
    assignmentOutcomeSchema.safeParse({ outcome: "Refused" }).success,
    false,
  );
  assert.equal(
    assignmentOutcomeSchema.safeParse({
      outcome: "Unavailable",
      retryAfterSecs: 30,
    }).success,
    true,
  );
  assert.equal(
    assignmentOutcomeSchema.safeParse({
      outcome: "Unavailable",
      evidence: "busy",
    }).success,
    false,
  );
  assert.equal(
    assignmentOutcomeSchema.safeParse({
      outcome: "Unavailable",
      retryAfterSecs: workerPoolRetryAfterSecsMax,
    }).success,
    true,
  );
  assert.equal(
    assignmentOutcomeSchema.safeParse({
      outcome: "Unavailable",
      retryAfterSecs: workerPoolRetryAfterSecsMax + 1,
    }).success,
    false,
    "a pool's word on how long to wait is bounded",
  );
});

test("a reconciliation carries what to place and what to stop, each name bounded", () => {
  const answer = { assignments: [assignment], stop: ["01HY"] };
  assert.deepEqual(workerPoolReconciliationSchema.parse(answer), answer);
  for (const invalid of [
    { ...answer, stop: ["x".repeat(workerPoolIdentityCharsMax + 1)] },
    { ...answer, stop: [""] },
    { ...answer, assignments: [{ ...assignment, deadlineSecs: 0 }] },
    { ...answer, lease: 30 },
    { assignments: [] },
  ])
    assert.equal(
      workerPoolReconciliationSchema.safeParse(invalid).success,
      false,
    );
});

test("a poll's query is the held list as a query carries one, bounded by the plane, and the room", () => {
  const query = workerPoolPollQuerySchema(2);
  assert.deepEqual(query.parse({ wanted: "0" }), { held: [], wanted: 0 });
  assert.deepEqual(query.parse({ held: "a", wanted: "3" }), {
    held: ["a"],
    wanted: 3,
  });
  assert.deepEqual(query.parse({ held: ["a", "b"], wanted: "1" }), {
    held: ["a", "b"],
    wanted: 1,
  });
  for (const invalid of [
    { held: ["a", "b", "c"], wanted: "0" },
    { held: "x".repeat(workerPoolIdentityCharsMax + 1), wanted: "0" },
    { held: "", wanted: "0" },
    { held: "a" },
    { held: "a", wanted: "-1" },
    { held: "a", wanted: "01" },
    { held: "a", wanted: "1.5" },
    { held: "a", wanted: ["1", "2"] },
    { held: "a", wanted: "0", capacity: "4" },
  ])
    assert.equal(query.safeParse(invalid).success, false);
});

test("each settlement route is the poll route, the assignment and the outcome", () => {
  for (const outcome of ["Accepted", "Refused", "Unavailable"] as const)
    assert.equal(
      workerPoolSettlementRoutes[outcome],
      `${workerPoolPollRoute}/:assignment/${outcome.toLowerCase()}`,
    );
  assert.equal(
    workerPoolSettlementPath("Refused", "a/b c"),
    `${workerPoolPollRoute}/a%2Fb%20c/refused`,
  );
});

test("a registration declares what a pool can do and no capacity", () => {
  assert.deepEqual(
    workerPoolRegistrationSchema.parse({
      pool: "gumbo",
      capabilities: ["linux"],
    }),
    { pool: "gumbo", capabilities: ["linux"] },
  );
  assert.equal(
    workerPoolRegistrationSchema.safeParse({
      pool: "gumbo",
      capabilities: ["linux"],
      concurrency: 4,
    }).success,
    false,
  );
});
