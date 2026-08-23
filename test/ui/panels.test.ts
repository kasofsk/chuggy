/**
 * Panel state and freshness: the half of issue #194 a reviewer checks first.
 *
 * The claim under test is that no arrangement of reads produces a panel a
 * renderer could draw as empty or healthy without saying so.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  elapsedCaption,
  freshness,
  freshnessAgingMsAfter,
  freshnessCaption,
  freshnessFraction,
  freshnessStaleMsAfter,
  panelDeferred,
  panelHeld,
  panelLoading,
  panelReady,
  panelUnavailable,
  panelUnknown,
} from "../../ui/app/panels.js";
import { board, executionRows, scheduler } from "../../ui/app/views.js";
import { phaseRoster } from "../../ui/app/resources.js";

test("a panel that has never read holds nothing and says so", () => {
  assert.equal(panelHeld(panelUnknown), undefined);
  assert.deepEqual(freshness(panelUnknown, 1_000), { verdict: "NoEvidence" });
  assert.equal(freshnessCaption(panelUnknown, 1_000, "Read"), "Not read yet");
  assert.equal(
    freshnessCaption(panelLoading(panelUnknown), 1_000, "Read"),
    "Reading…",
  );
});

test("a failed read keeps the last value and names why it is not newer", () => {
  const ready = panelReady({ count: 1 }, 1_000);
  const failed = panelUnavailable(ready, "The read failed: Unreachable.");
  assert.deepEqual(panelHeld(failed), {
    value: { count: 1 },
    observedAtMs: 1_000,
  });
  assert.equal(failed.reason, "The read failed: Unreachable.");
  assert.equal(
    freshness(failed, 1_000 + freshnessStaleMsAfter).verdict,
    "Stale",
  );
});

test("a deferred read is its own state, carrying the code and the delay", () => {
  const deferred = panelDeferred(panelUnknown, "DispatchBacklog", 12);
  assert.equal(deferred.state, "Deferred");
  assert.equal(deferred.code, "DispatchBacklog");
  assert.equal(deferred.retryAfterSeconds, 12);
  assert.equal(panelHeld(deferred), undefined);
});

test("freshness moves from fresh through aging to stale as evidence ages", () => {
  const ready = panelReady("value", 0);
  assert.equal(freshness(ready, 0).verdict, "Fresh");
  assert.equal(freshness(ready, freshnessAgingMsAfter).verdict, "Aging");
  assert.equal(freshness(ready, freshnessStaleMsAfter).verdict, "Stale");
  assert.equal(freshness(ready, -1_000).verdict, "Fresh");
});

test("the age bar fills toward the next read and never past it", () => {
  assert.equal(freshnessFraction(0, 1_000), 0);
  assert.equal(freshnessFraction(500, 1_000), 0.5);
  assert.equal(freshnessFraction(9_000, 1_000), 1);
  assert.equal(freshnessFraction(1, 0), 1);
});

test("an elapsed caption reads in the largest unit that stays a number", () => {
  assert.equal(elapsedCaption(4_000), "4s");
  assert.equal(elapsedCaption(90_000), "1m");
  assert.equal(elapsedCaption(7_200_000), "2h");
});

test("the board keeps every phase visible, empty or not", () => {
  const view = board([
    { ticket: 1, phase: "Working", sequence: 4 },
    { ticket: 2, phase: "Done", sequence: 4 },
  ]);
  assert.deepEqual(
    view.columns.map((column) => column.phase),
    phaseRoster,
  );
  assert.equal(view.ticketsCount, 2);
  assert.deepEqual(
    view.columns.find((column) => column.phase === "Pending")?.tickets,
    [],
  );
  assert.equal(
    view.columns.find((column) => column.phase === "Done")?.settled,
    true,
  );
});

test("headroom is derived, and an exhausted limit says it is exhausted", () => {
  const view = scheduler({
    observedAt: "2026-08-22T00:00:00Z",
    schedulerFreshness: "Unknown",
    queued: 5,
    admitted: 1,
    launching: 2,
    running: 3,
    clusterSlotsMax: 64,
    clusterActive: 6,
    accountMaximum: 6,
    accountActive: 6,
    accountReservationDeficit: 2,
  });
  assert.equal(view.inFlight, 6);
  assert.deepEqual(view.cluster, {
    used: 6,
    limit: 64,
    free: 58,
    exhausted: false,
  });
  assert.deepEqual(view.account, {
    used: 6,
    limit: 6,
    free: 0,
    exhausted: true,
  });
  assert.equal(view.reservationDeficit, 2);
  assert.equal(view.schedulerFreshness, "Unknown");
});

test("a zero limit is exhausted rather than infinite headroom", () => {
  const view = scheduler({
    observedAt: "2026-08-22T00:00:00Z",
    schedulerFreshness: "Unknown",
    queued: 0,
    admitted: 0,
    launching: 0,
    running: 0,
    clusterSlotsMax: 0,
    clusterActive: 0,
    accountMaximum: 0,
    accountActive: 0,
    accountReservationDeficit: 0,
  });
  assert.equal(view.cluster.exhausted, true);
  assert.equal(view.account.exhausted, true);
});

test("an execution row says whether the scheduler still holds it in flight", () => {
  const rows = executionRows({
    executions: [
      {
        execution: "x1",
        ticket: 1,
        task: 1,
        taskKind: "Work",
        stage: undefined,
        cluster: "c1",
        configurationRevision: "r1",
        status: "Running",
        outcome: undefined,
        retriesSpent: 0,
        registeredAt: "2026-08-22T00:00:00Z",
        terminalAt: undefined,
      },
      {
        execution: "x2",
        ticket: 2,
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        cluster: "c1",
        configurationRevision: "r1",
        status: "Terminal",
        outcome: "Failed",
        retriesSpent: 1,
        registeredAt: "2026-08-22T00:00:00Z",
        terminalAt: "2026-08-22T00:02:00Z",
      },
    ],
    nextAfter: undefined,
  });
  assert.equal(rows[0]?.active, true);
  assert.equal(rows[1]?.active, false);
  assert.equal(rows[1]?.outcome, "Failed");
});
