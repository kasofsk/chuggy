import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSelectorInteractionContext } from "../../src/adapters/postgres/selector.ts";

const legacyOperationalContext = {
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
};

test("pre-version selector context remains readable as exact legacy evidence", () => {
  assert.deepEqual(
    parseSelectorInteractionContext({
      workingMemory: { note: "retained" },
      operationalContext: legacyOperationalContext,
    }),
    {
      handoffNote: { note: "retained" },
      operationalContext: { ...legacyOperationalContext, version: 1 },
    },
  );
});

test("a row written under either spelling of the note reads back as the note", () => {
  const operationalContext = { ...legacyOperationalContext, version: 1 };
  assert.deepEqual(
    parseSelectorInteractionContext({
      operationalContext: legacyOperationalContext,
      workingMemory: { note: "written before the rename" },
    }),
    { operationalContext, handoffNote: { note: "written before the rename" } },
  );
  assert.deepEqual(
    parseSelectorInteractionContext({
      operationalContext: legacyOperationalContext,
      handoffNote: { note: "written after it" },
    }),
    { operationalContext, handoffNote: { note: "written after it" } },
  );
});

test("a row carrying neither spelling, or both, is a row that is not intact", () => {
  assert.throws(() =>
    parseSelectorInteractionContext({
      operationalContext: legacyOperationalContext,
    }),
  );
  assert.throws(() =>
    parseSelectorInteractionContext({
      operationalContext: legacyOperationalContext,
      handoffNote: { note: "one" },
      workingMemory: { note: "the other" },
    }),
  );
});
