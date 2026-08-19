import assert from "node:assert/strict";
import { test } from "node:test";

import { phaseTags, type Core } from "../../src/domain/generated/modelTypes.ts";
import {
  decodeCore,
  decodeDecisionEvent,
  encodeCore,
} from "../../src/generated/model-api.ts";

const core: Core = {
  tickets: new Map([
    [
      7,
      {
        phase: "Pending",
        deps: new Set([3]),
        finalizer: "NoFinalizer",
        artifact: "NoArtifact",
        workFanout: 1,
        reworkPolicy: { type: "BudgetedRework", value: 1 },
        finalizationPricing: "DeadlineOnly",
        resumePricing: "RetryCharged",
        program: [{ fanout: 1, combinator: "UnanimousPass" }],
        tasks: new Set(),
        record: [],
        spawned: 0,
        reworkLeft: 1,
        finalizationLeft: 0,
        gasLeft: 2,
        resumeAt: "NoResume",
        reason: "NoReason",
        completions: 0,
      },
    ],
  ]),
};

test("generated JSON codec round-trips nested lists, sets, maps and records", () => {
  const wire = encodeCore(core);
  assert.deepEqual(wire, {
    tickets: [
      [
        7,
        {
          phase: "Pending",
          deps: [3],
          finalizer: "NoFinalizer",
          artifact: "NoArtifact",
          workFanout: 1,
          reworkPolicy: { type: "BudgetedRework", value: 1 },
          finalizationPricing: "DeadlineOnly",
          resumePricing: "RetryCharged",
          program: [{ fanout: 1, combinator: "UnanimousPass" }],
          tasks: [],
          record: [],
          spawned: 0,
          reworkLeft: 1,
          finalizationLeft: 0,
          gasLeft: 2,
          resumeAt: "NoResume",
          reason: "NoReason",
          completions: 0,
        },
      ],
    ],
  });
  assert.deepEqual(decodeCore(wire), core);
});

test("generated codecs reject an integer outside the JavaScript-safe mapping", () => {
  assert.throws(() =>
    decodeCore({ tickets: [[Number.MAX_SAFE_INTEGER + 1, {}]] }),
  );
});

test("generated codecs refuse duplicates that JSON could otherwise collapse", () => {
  assert.throws(() =>
    decodeCore({
      tickets: [
        [7, {}],
        [7, {}],
      ],
    }),
  );
  assert.throws(() =>
    decodeDecisionEvent({
      type: "ReleaseTicket",
      value: {
        ticket: 7,
        deps: [3, 3],
        prog: [{ fanout: 1, combinator: "UnanimousPass" }],
        workFanout: 1,
        reworkPolicy: { type: "BudgetedRework", value: 1 },
        finalizationPricing: "DeadlineOnly",
        resumePricing: "RetryCharged",
        finalizer: "NoFinalizer",
      },
    }),
  );
});

test("generated constructor roster is the exhaustive model phase vocabulary", () => {
  assert.deepEqual(phaseTags, [
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ]);
});
