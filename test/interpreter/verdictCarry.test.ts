/**
 * Whether an evaluation carries an earlier verdict, clause by clause, decided
 * over plain rows. Each test changes one field of a candidate that would
 * otherwise be carried, so a clause that stopped being read is the test that
 * starts carrying.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  verdictCarryReevaluation,
  verdictCarrySource,
  verdictCarryWorkloadDigest,
  type VerdictCarryCurrent,
  type VerdictCarryEarlier,
} from "../../src/interpreter/verdictCarry.ts";
import type { WorkloadTask } from "../../src/interpreter/workloadTask.ts";

const digest = "a".repeat(64);

function current(over: Partial<VerdictCarryCurrent> = {}): VerdictCarryCurrent {
  return {
    execution: asExecutionId("execution-current"),
    ticket: asTicketId(7),
    stage: 1,
    evaluator: 1,
    workCycle: 2,
    generation: 1,
    workloadDigest: digest,
    changeIdentity: "change-1",
    stack: "Unstacked",
    reevaluate: "OnChange",
    ...over,
  };
}

function earlier(over: Partial<VerdictCarryEarlier> = {}): VerdictCarryEarlier {
  return {
    execution: asExecutionId("execution-earlier"),
    ticket: asTicketId(7),
    stage: 1,
    evaluator: 1,
    workCycle: 1,
    generation: 1,
    workloadDigest: digest,
    changeIdentity: "change-1",
    stack: "Unstacked",
    outcome: "Passed",
    handoffs: 0,
    ...over,
  };
}

test("an earlier passing verdict over the same change and workload is carried", () => {
  assert.equal(verdictCarrySource(current(), [earlier()]), "execution-earlier");
});

test("an Always workload is never carried", () => {
  assert.equal(
    verdictCarrySource(current({ reevaluate: "Always" }), [earlier()]),
    undefined,
  );
});

for (const [clause, over] of [
  ["another ticket", { ticket: asTicketId(8) }],
  ["another stage", { stage: 2 }],
  ["another evaluator", { evaluator: 2 }],
  ["the same work cycle", { workCycle: 2 }],
  ["a later work cycle", { workCycle: 3 }],
  [
    "the current execution itself",
    { execution: asExecutionId("execution-current") },
  ],
  ["a failed verdict", { outcome: "Failed" }],
  ["an unsettled one", { outcome: undefined }],
  ["a verdict with handoffs", { handoffs: 1 }],
  ["a changed workload", { workloadDigest: "b".repeat(64) }],
  ["a row with no recorded workload", { workloadDigest: undefined }],
  ["a changed diff", { changeIdentity: "change-2" }],
  ["a bundle with no change identity", { changeIdentity: undefined }],
  ["a stack whose beneath did not land", { stack: "NotLanded" }],
] as const satisfies readonly (readonly [
  string,
  Partial<VerdictCarryEarlier>,
])[]) {
  test(`${clause} is not carried`, () => {
    assert.equal(verdictCarrySource(current(), [earlier(over)]), undefined);
  });
}

test("a current task with no recorded workload or change identity carries nothing", () => {
  assert.equal(
    verdictCarrySource(current({ workloadDigest: undefined }), [earlier()]),
    undefined,
  );
  assert.equal(
    verdictCarrySource(current({ changeIdentity: undefined }), [earlier()]),
    undefined,
  );
});

test("a stack whose beneath all landed is carried", () => {
  assert.equal(
    verdictCarrySource(current(), [earlier({ stack: "Landed" })]),
    "execution-earlier",
  );
});

test("an unstacked candidate is carried whether or not the current cycle is stacked", () => {
  for (const stack of ["Unstacked", "Landed", "NotLanded"] as const)
    assert.equal(
      verdictCarrySource(current({ stack }), [earlier()]),
      "execution-earlier",
    );
});

test("the latest candidate is carried, by work cycle and then generation", () => {
  const first = earlier({ execution: asExecutionId("first"), workCycle: 1 });
  const second = earlier({
    execution: asExecutionId("second"),
    workCycle: 2,
    generation: 1,
  });
  const regenerated = earlier({
    execution: asExecutionId("regenerated"),
    workCycle: 2,
    generation: 2,
  });
  const failed = earlier({
    execution: asExecutionId("failed"),
    workCycle: 2,
    generation: 3,
    outcome: "Failed",
  });
  assert.equal(
    verdictCarrySource(current({ workCycle: 3 }), [
      regenerated,
      first,
      failed,
      second,
    ]),
    "regenerated",
  );
});

test("a task whose keys are not keys is refused", () => {
  assert.throws(
    () => verdictCarrySource(current({ stage: 0 }), []),
    RangeError,
  );
  assert.throws(
    () => verdictCarrySource(current(), [earlier({ handoffs: -1 })]),
    RangeError,
  );
});

const commands = (over: object = {}): WorkloadTask => ({
  workload: { runner: "Commands", commands: ["npm test"], ...over },
  ticketChecks: false,
});

test("only a placed workload that says OnChange may be carried", () => {
  assert.equal(verdictCarryReevaluation(undefined), "Always");
  assert.equal(verdictCarryReevaluation(commands()), "Always");
  assert.equal(
    verdictCarryReevaluation(commands({ reevaluate: "Always" })),
    "Always",
  );
  assert.equal(
    verdictCarryReevaluation(commands({ reevaluate: "OnChange" })),
    "OnChange",
  );
  assert.equal(
    verdictCarryReevaluation({
      workload: { runner: "Approval", reevaluate: "OnChange" },
      ticketChecks: false,
    } as unknown as WorkloadTask),
    "Always",
  );
});

test("a workload's digest leaves out whether it may be carried, and nothing else", () => {
  const plain = verdictCarryWorkloadDigest(commands());
  assert.match(plain ?? "", /^[0-9a-f]{64}$/);
  assert.equal(
    verdictCarryWorkloadDigest(commands({ reevaluate: "OnChange" })),
    plain,
  );
  assert.notEqual(
    verdictCarryWorkloadDigest(commands({ commands: ["npm run lint"] })),
    plain,
  );
  assert.notEqual(
    verdictCarryWorkloadDigest({ ...commands(), ticketChecks: true }),
    plain,
  );
  assert.equal(verdictCarryWorkloadDigest(undefined), undefined);
});
