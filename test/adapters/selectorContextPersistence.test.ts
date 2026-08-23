import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSelectorInteractionContext } from "../../src/adapters/postgres/selector.ts";

test("pre-version selector context remains readable as exact legacy evidence", () => {
  const legacy = {
    workingMemory: {},
    operationalContext: {
      observedAt: "2026-08-20T12:00:00.000Z",
      observedAtEpochMs: 1_777_000_000_000,
      reviewFeedback: [],
      activeWork: [
        { ticket: 1, queuedTasks: 2, admittedTasks: 3, runningAttempts: 4 },
      ],
      projectCapacity: {
        account: "account",
        allocated: 2,
        limit: 4,
        available: 2,
      },
      clusterCapacity: {
        visibility: "AuthorizedAggregate",
        allocated: 3,
        limit: 8,
        available: 5,
        pressure: "Constrained",
      },
      executionBacklog: {
        queued: 6,
        ceiling: 10,
        dispatchAllowed: true,
      },
    },
  };
  assert.deepEqual(parseSelectorInteractionContext(legacy), {
    ...legacy,
    operationalContext: { ...legacy.operationalContext, version: 1 },
  });
});
