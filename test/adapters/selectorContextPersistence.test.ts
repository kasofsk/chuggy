import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSelectorInteractionContext } from "../../src/adapters/postgres/selector.ts";

test("pre-version selector context remains readable as exact legacy evidence", () => {
  const legacy = {
    workingMemory: { note: "retained" },
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
    handoffNote: { note: "retained" },
    operationalContext: { ...legacy.operationalContext, version: 1 },
  });
});

test("a row written under either spelling of the note reads back as the note", () => {
  const operationalContext = {
    version: 2,
    observedAt: "2026-09-02T12:00:00.000Z",
    observedAtEpochMs: 1_788_000_000_000,
    reviewFeedback: [],
    activeWork: { queued: 0, admitted: 0, launching: 0, running: 0 },
    capacity: {
      account: "account",
      accountMaximum: 8,
      accountActive: 1,
      accountReservationDeficit: 0,
      clusterSlotsMax: 8,
      clusterActive: 1,
    },
    backlog: {
      project: { queued: 0, ceiling: 100 },
      installation: { queued: 0, ceiling: 1_000 },
    },
  };
  assert.deepEqual(
    parseSelectorInteractionContext({
      operationalContext,
      workingMemory: { note: "written before the rename" },
    }),
    { operationalContext, handoffNote: { note: "written before the rename" } },
  );
  assert.deepEqual(
    parseSelectorInteractionContext({
      operationalContext,
      handoffNote: { note: "written after it" },
    }),
    { operationalContext, handoffNote: { note: "written after it" } },
  );
});
