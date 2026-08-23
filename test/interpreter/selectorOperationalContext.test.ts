import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { selectorOperationalContextRead } from "../../src/interpreter/selectorOperationalContext.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

test("selector context preserves both scheduler backlog authorities", async () => {
  const source = selectorOperationalContextRead(
    {
      context: () =>
        Promise.resolve({
          activeWork: {
            partition,
            queued: 1,
            admitted: 2,
            launching: 3,
            running: 4,
          },
          account: "account",
          capacity: {
            accountMaximum: 8,
            accountActive: 5,
            accountReservationDeficit: 1,
            clusterSlotsMax: 20,
            clusterActive: 9,
          },
          backlog: { project: 6, installation: 12 },
        }),
    },
    { reviewFeedback: () => Promise.resolve([]) },
    {
      now: () => ({
        instant: "2026-08-23T12:00:00.000Z",
        epochMilliseconds: 1_777_000_000_000,
      }),
    },
    {
      reviewFeedbackMax: 10,
      projectBacklogMax: 100,
      installationBacklogMax: 1_000,
    },
  );
  assert.deepEqual(await source.context(partition), {
    version: 2,
    observedAt: "2026-08-23T12:00:00.000Z",
    observedAtEpochMs: 1_777_000_000_000,
    reviewFeedback: [],
    activeWork: { queued: 1, admitted: 2, launching: 3, running: 4 },
    capacity: {
      account: "account",
      accountMaximum: 8,
      accountActive: 5,
      accountReservationDeficit: 1,
      clusterSlotsMax: 20,
      clusterActive: 9,
    },
    backlog: {
      project: { queued: 6, ceiling: 100 },
      installation: { queued: 12, ceiling: 1_000 },
    },
  });
});
