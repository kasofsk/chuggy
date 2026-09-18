/**
 * The worker-pool wire shapes, read as a third party's implementation would
 * read them: what is admitted, what is refused, and what carries no field it
 * was not given.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentOutcomeSchema,
  workerPoolAssignmentSchema,
  workerPoolCapabilitiesMax,
  workerPoolRegistrationSchema,
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
