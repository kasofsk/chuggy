import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { selectorInteractionRecord } from "../../src/adapters/postgres/selector.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const partition = { tenant: asTenantId("tenant"), project: asProjectId("p") };

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

/** One resource as the writer stores it: its manifest and its one chunk. */
function storedResource(kind: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return {
    manifest: JSON.stringify({
      kind,
      digest: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      chunks: 1,
    }),
    chunks: [bytes.toString("base64")],
  };
}

/** A stored context as the record a reader builds from its row answers it. */
function storedContextRead(context: unknown) {
  const observedView = storedResource("ObservedView", []);
  const stored = storedResource("Context", context);
  const toolActivity = storedResource("ToolActivity", []);
  return selectorInteractionRecord(
    partition,
    {
      selector_decision: "decision",
      ordinal: "1",
      instructions_version: "1",
      instructions: "instructions",
      observed_view: observedView.manifest,
      observed_token: null,
      context: stored.manifest,
      tool_activity: toolActivity.manifest,
      result: "{}",
      implementation_revision: "build",
      model_revision: "model",
      policy_revision: "policy",
      accounting: "{}",
      started_at: new Date(0),
      completed_at: new Date(0),
      dispatches: null,
    },
    {
      observedView: observedView.chunks,
      context: stored.chunks,
      toolActivity: toolActivity.chunks,
    },
  ).context;
}

test("a context written before versioning reads as version 1, its note beside it", () => {
  assert.deepEqual(
    storedContextRead({
      operationalContext: legacyOperationalContext,
      handoffNote: { note: "retained" },
    }),
    {
      operationalContext: { ...legacyOperationalContext, version: 1 },
      handoffNote: { note: "retained" },
    },
  );
});

test("a context carrying no note, or a member it does not name, is not intact", () => {
  assert.throws(() =>
    storedContextRead({ operationalContext: legacyOperationalContext }),
  );
  assert.throws(() =>
    storedContextRead({
      operationalContext: legacyOperationalContext,
      handoffNote: { note: "one" },
      unnamed: { note: "the other" },
    }),
  );
});
