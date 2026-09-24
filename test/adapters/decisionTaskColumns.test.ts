/**
 * The identity as the decision writer spells it into `execution_request_task`.
 * Every fixture that drives the writer carries counters that are all one, so
 * a column swapped for its neighbour would pass the relation's CHECK and every
 * suite; this holds each counter to its own column.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decisionTaskColumns } from "../../src/adapters/postgres/decision.ts";
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";

test("an evaluation's four counters each reach their own column", () => {
  assert.deepEqual(decisionTaskColumns(evaluationTaskOf(7, 2, 3, 4, 5)), {
    kind: "Evaluation",
    cycle: 2,
    stage: 3,
    generation: 4,
    evaluator: 5,
  });
});

test("a work task names its cycle and spells the evaluation columns null", () => {
  assert.deepEqual(decisionTaskColumns(workTaskIdentity(7, 3)), {
    kind: "Work",
    cycle: 3,
    stage: null,
    generation: null,
    evaluator: null,
  });
});
