/**
 * Which commands the scheduler's authoritative backlog guard is consulted for,
 * and what an observed guard reports of its verdict.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resumeTicketCommand,
  revokeTicketCommand,
} from "../../src/actor/command.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asOperationTicketCommand } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  allBacklogScopes,
  dispatchNeedsExecutionHeadroom,
  observedExecutionBacklogGuard,
  openExecutionBacklogGuard,
  type BacklogVerdict,
  type ExecutionBacklogGuard,
} from "../../src/interpreter/schedulerContext.ts";
import { schedulerTelemetry } from "../../src/interpreter/executionScheduler.ts";
import { recordingMetrics, throwingMetrics } from "./schedulerSinks.ts";
import type { ProjectCommand } from "../../src/interpreter/projectCommand.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("mine"),
};

/** One command of each shape the guard classifies. */
const resume: ProjectCommand = {
  version: 1,
  command: "ResolveNativeAction",
  action: "action-one",
  authorizingSeq: 1,
  resolution: "Resume",
};

const release: ProjectCommand = {
  version: 1,
  command: "ReleaseDraft",
  ticket: asTicketId(1),
  authoringVersion: 1,
  configurationRevision: "revision",
};

const manualDispatch: ProjectCommand = {
  version: 1,
  command: "ManualDispatch",
  ticket: asTicketId(1),
  expectedTicketVersion: 1,
};

const proposeDispatch: ProjectCommand = {
  version: 1,
  command: "ProposeDispatch",
  ticket: asTicketId(1),
  expectedTicketVersion: 1,
  observedViewToken: {
    tenant: "tenant",
    project: "project",
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 1,
    digest: "0".repeat(64),
  },
  selectorDecisionReference: "selection-one",
};

test("manual dispatch and an agentic proposal need the same headroom", () => {
  assert.equal(dispatchNeedsExecutionHeadroom(manualDispatch), true);
  assert.equal(dispatchNeedsExecutionHeadroom(proposeDispatch), true);
});

test("no decision is gated, dispatch not being one a decision can carry", () => {
  assert.equal(
    dispatchNeedsExecutionHeadroom({
      version: 1,
      command: "Decide",
      ticketCommand: asOperationTicketCommand(
        revokeTicketCommand(asTicketId(1)),
      ),
    }),
    false,
  );
  assert.equal(
    dispatchNeedsExecutionHeadroom({
      version: 1,
      command: "Decide",
      ticketCommand: asOperationTicketCommand(
        resumeTicketCommand(asTicketId(1)),
      ),
    }),
    false,
  );
});

test("release and native-action resolution stay admissible while dispatch is paused", () => {
  assert.equal(dispatchNeedsExecutionHeadroom(release), false);
  assert.equal(dispatchNeedsExecutionHeadroom(resume), false);
  assert.equal(
    dispatchNeedsExecutionHeadroom({ ...resume, resolution: "Revoke" }),
    false,
  );
});

test("a deployment with no scheduler admits every dispatch", async () => {
  assert.deepEqual(await openExecutionBacklogGuard.admitsDispatch(partition), {
    admits: "Admits",
  });
});

/** A guard that answers the one verdict a case is about. */
function guardAnswering(verdict: BacklogVerdict): ExecutionBacklogGuard {
  return { admitsDispatch: () => Promise.resolve(verdict) };
}

test("an observed guard names the ceiling that stopped a dispatch", async () => {
  for (const scope of allBacklogScopes) {
    const seen: string[] = [];
    const guard = observedExecutionBacklogGuard(
      guardAnswering({ admits: "Backlogged", scope, retryAfterSeconds: 5 }),
      schedulerTelemetry(recordingMetrics(seen)),
    );
    await guard.admitsDispatch(partition);
    assert.deepEqual(seen, [`backlog:Backlogged:${scope}`]);
  }
});

test("an admitted dispatch is observed without a ceiling to name", async () => {
  const seen: string[] = [];
  const guard = observedExecutionBacklogGuard(
    openExecutionBacklogGuard,
    schedulerTelemetry(recordingMetrics(seen)),
  );
  assert.deepEqual(await guard.admitsDispatch(partition), { admits: "Admits" });
  assert.deepEqual(seen, ["backlog:Admits"]);
});

test("a sink that fails at every observation leaves the verdict exactly as it was", async () => {
  const thrown: string[] = [];
  const refused: BacklogVerdict = {
    admits: "Backlogged",
    scope: "Installation",
    retryAfterSeconds: 11,
  };
  const guard = observedExecutionBacklogGuard(
    guardAnswering(refused),
    schedulerTelemetry(throwingMetrics(thrown)),
  );
  assert.deepEqual(await guard.admitsDispatch(partition), refused);
  assert.deepEqual(thrown, ["backlog"]);
});
