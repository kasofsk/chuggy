/**
 * The console's DTO parsers, and its copies of the server's closed sets.
 *
 * Each roster is held against the server's own — against a runtime list where
 * one exists, and otherwise against an exhaustive record the compiler rejects
 * when the union gains or loses a member.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { phaseTags } from "../../src/domain/generated/modelTypes.ts";
import {
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
} from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionTaskKind } from "../../src/interpreter/executionScheduler.ts";
import type { OutputRenderer } from "../../src/interpreter/operationsView.ts";
import type { ProjectOperationalStatus } from "../../src/interpreter/operationsView.ts";
import type { OperationRefusalCode } from "../../src/interpreter/nativeWeb.ts";
import type { OperationState } from "../../src/interpreter/operationInbox.ts";
import { allArtifactRoles } from "../../src/interpreter/resultManifest.ts";
import type { ExecutionResultResource } from "../../src/interpreter/operationsView.ts";
import type { DispatchViewPage } from "../../src/interpreter/dispatchView.ts";
import type { NotificationBatch } from "../../src/interpreter/notifications.ts";
import type { NotificationKind } from "../../src/interpreter/notifications.ts";
import {
  artifactRoles,
  attemptStates,
  dispatchViewResults,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  notificationKinds,
  notificationResults,
  operationRefusalCodes,
  operationStates,
  outputRenderers,
  parseArtifactContent,
  parseDispatchView,
  parseExecution,
  parseExecutionsPage,
  parseNotifications,
  parseOperation,
  parseOperationalStatus,
  parseProject,
  parseProjectsPage,
  phaseRoster,
  resultVerdicts,
  schedulerFreshnessRoster,
} from "../../ui/app/resources.js";

function keysOf(record: Readonly<Record<string, true>>): readonly string[] {
  return Object.keys(record).sort();
}

const sorted = (values: readonly string[]) => [...values].sort();

test("the phase and scheduler rosters are the model's", () => {
  assert.deepEqual(phaseRoster, [...phaseTags]);
  assert.deepEqual(executionStatuses, [...allExecutionStatuses]);
  assert.deepEqual(executionOutcomes, [...allExecutionOutcomes]);
  assert.deepEqual(attemptStates, [...allAttemptStates]);
  assert.deepEqual(artifactRoles, [...allArtifactRoles]);
});

test("the rosters with no runtime list are exhaustive over their unions", () => {
  const kinds: Record<ExecutionTaskKind, true> = {
    Work: true,
    Evaluation: true,
  };
  const renderers: Record<OutputRenderer, true> = {
    UnifiedDiff: true,
    Markdown: true,
    Json: true,
    Text: true,
  };
  const states: Record<OperationState, true> = {
    Pending: true,
    Succeeded: true,
    Refused: true,
    Answered: true,
    Cancelled: true,
  };
  const refusals: Record<OperationRefusalCode, true> = {
    NotEnabled: true,
    AuthoringChanged: true,
    ConfigurationInvalid: true,
    TicketChanged: true,
    SelectionChanged: true,
    CommandUnreadable: true,
  };
  const notifications: Record<NotificationKind, true> = {
    Operation: true,
    Ticket: true,
    Draft: true,
    Configuration: true,
    Project: true,
  };
  const freshness: Record<
    ProjectOperationalStatus["schedulerFreshness"],
    true
  > = {
    Unknown: true,
  };
  const verdicts: Record<ExecutionResultResource["verdict"], true> = {
    Pass: true,
    Fail: true,
  };
  const dispatchResults: Record<DispatchViewPage["result"], true> = {
    Page: true,
    Reset: true,
  };
  const notificationBatches: Record<NotificationBatch["result"], true> = {
    Events: true,
    Reset: true,
  };
  assert.deepEqual(sorted(executionTaskKinds), keysOf(kinds));
  assert.deepEqual(sorted(outputRenderers), keysOf(renderers));
  assert.deepEqual(sorted(operationStates), keysOf(states));
  assert.deepEqual(sorted(operationRefusalCodes), keysOf(refusals));
  assert.deepEqual(sorted(notificationKinds), keysOf(notifications));
  assert.deepEqual(sorted(schedulerFreshnessRoster), keysOf(freshness));
  assert.deepEqual(sorted(resultVerdicts), keysOf(verdicts));
  assert.deepEqual(sorted(dispatchViewResults), keysOf(dispatchResults));
  assert.deepEqual(sorted(notificationResults), keysOf(notificationBatches));
});

test("a projects page carries its cursor even when the page is short", () => {
  const page = parseProjectsPage({
    projects: [{ tenant: "acme", project: "atlas" }],
    nextCursor: "abc",
  });
  assert.equal(page.projects.length, 1);
  assert.equal(page.nextCursor, "abc");
});

test("a project read carries the sequence its tickets were observed at", () => {
  const project = parseProject({
    partition: { tenant: "acme", project: "atlas" },
    sequence: 9,
    tickets: [{ ticket: 3, phase: "Working", sequence: 9 }],
  });
  assert.equal(project.sequence, 9);
  assert.deepEqual(project.tickets[0], {
    ticket: 3,
    phase: "Working",
    sequence: 9,
  });
  assert.equal(project.nextAfter, undefined);
});

test("a missing count is a parse failure, not a zero", () => {
  assert.throws(
    () =>
      parseOperationalStatus({
        observedAt: "2026-08-22T00:00:00Z",
        schedulerFreshness: "Unknown",
        queued: 1,
        admitted: 0,
        launching: 0,
        running: 0,
        clusterSlotsMax: 64,
        clusterActive: 0,
        accountMaximum: 8,
        accountActive: 0,
      }),
    TypeError,
  );
});

test("a phase the model does not have is a parse failure", () => {
  assert.throws(
    () =>
      parseProject({
        partition: { tenant: "acme", project: "atlas" },
        sequence: 1,
        tickets: [{ ticket: 1, phase: "Sleeping", sequence: 1 }],
      }),
    TypeError,
  );
});

test("the scheduler's freshness claim is carried through unchanged", () => {
  const status = parseOperationalStatus({
    observedAt: "2026-08-22T00:00:00Z",
    schedulerFreshness: "Unknown",
    queued: 2,
    admitted: 1,
    launching: 0,
    running: 3,
    clusterSlotsMax: 64,
    clusterActive: 4,
    accountMaximum: 8,
    accountActive: 4,
    accountReservationDeficit: 1,
  });
  assert.equal(status.schedulerFreshness, "Unknown");
  assert.equal(status.observedAt, "2026-08-22T00:00:00Z");
  assert.equal(status.accountReservationDeficit, 1);
});

test("a dispatch page carries the version a manual dispatch must echo", () => {
  const page = parseDispatchView({
    result: "Page",
    token: {
      tenant: "acme",
      project: "atlas",
      recoveryEpoch: "e1",
      schemaVersion: 1,
      watermark: 12,
      digest: "d",
    },
    candidates: [
      {
        ticket: 4,
        ticketVersion: 7,
        workFanout: 2,
        configurationRevision: "r1",
      },
    ],
    notificationCursor: 5,
  });
  assert.equal(page.result, "Page");
  assert.equal(
    page.result === "Page" ? page.candidates[0]?.ticketVersion : undefined,
    7,
  );
});

test("a reset dispatch view carries no candidates to act on", () => {
  assert.deepEqual(parseDispatchView({ result: "Reset" }), { result: "Reset" });
});

test("notifications name the resource kind that moved", () => {
  const batch = parseNotifications({
    result: "Events",
    cursor: 4,
    events: [{ ordinal: 4, kind: "Ticket", resource: "3" }],
  });
  assert.equal(batch.cursor, 4);
  assert.equal(
    batch.result === "Events" ? batch.events[0]?.kind : undefined,
    "Ticket",
  );
  assert.deepEqual(parseNotifications({ result: "Reset", cursor: 0 }), {
    result: "Reset",
    cursor: 0,
    events: [],
  });
});

test("a refusal is parsed with its code and nothing else is", () => {
  assert.deepEqual(
    parseOperation({
      operation: "o1",
      state: "Refused",
      code: "TicketChanged",
    }),
    { operation: "o1", state: "Refused", refusalCode: "TicketChanged" },
  );
  assert.equal(
    parseOperation({ operation: "o1", state: "Pending" }).refusalCode,
    undefined,
  );
});

test("an execution carries the scheduler's status and the retries it spent", () => {
  const page = parseExecutionsPage({
    executions: [
      {
        execution: "x1",
        ticket: 3,
        task: 1,
        taskKind: "Work",
        cluster: "c1",
        configurationRevision: "r1",
        status: "Running",
        retriesSpent: 2,
        registeredAt: "2026-08-22T00:00:00Z",
      },
    ],
    nextAfter: "x1",
  });
  assert.equal(page.executions[0]?.status, "Running");
  assert.equal(page.executions[0]?.retriesSpent, 2);
  assert.equal(page.nextAfter, "x1");
});

test("an execution detail carries attempts, and a result when one exists", () => {
  const detail = parseExecution({
    execution: "x1",
    ticket: 3,
    task: 1,
    taskKind: "Evaluation",
    stage: 0,
    cluster: "c1",
    configurationRevision: "r1",
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 0,
    registeredAt: "2026-08-22T00:00:00Z",
    terminalAt: "2026-08-22T00:01:00Z",
    attempts: [
      {
        attempt: "a1",
        number: 1,
        generation: 1,
        state: "Reported",
        openedAt: "2026-08-22T00:00:10Z",
      },
    ],
    result: {
      manifest: "m1",
      attempt: "a1",
      schemaVersion: 1,
      digest: "d",
      verdict: "Pass",
      recordedAt: "2026-08-22T00:01:00Z",
      artifacts: [
        {
          ordinal: 0,
          role: "Handoff",
          path: "summary.md",
          digest: "d",
          bytes: 12,
          output: {
            name: "summary",
            path: "summary.md",
            mediaType: "text/markdown",
            renderer: "Markdown",
          },
        },
      ],
    },
  });
  assert.equal(detail.attempts[0]?.state, "Reported");
  assert.equal(detail.result?.artifacts[0]?.renderer, "Markdown");
  assert.equal(detail.outcome, "Passed");
});

test("an artifact with no declared output offers no preview", () => {
  const detail = parseExecution({
    execution: "x1",
    ticket: 3,
    task: 1,
    taskKind: "Work",
    cluster: "c1",
    configurationRevision: "r1",
    status: "Terminal",
    retriesSpent: 0,
    registeredAt: "2026-08-22T00:00:00Z",
    attempts: [],
    result: {
      manifest: "m1",
      attempt: "a1",
      schemaVersion: 1,
      digest: "d",
      verdict: "Fail",
      recordedAt: "2026-08-22T00:01:00Z",
      artifacts: [
        { ordinal: 1, role: "Diagnostic", path: "core", digest: "d", bytes: 4 },
      ],
    },
  });
  assert.equal(detail.result?.artifacts[0]?.renderer, undefined);
});

test("an artifact with no content field is a parse failure, not an empty preview", () => {
  assert.throws(
    () =>
      parseArtifactContent({
        read: "Content",
        mediaType: "text/plain",
        renderer: "Text",
      }),
    TypeError,
  );
  assert.equal(
    parseArtifactContent({
      read: "Content",
      mediaType: "text/plain",
      renderer: "Text",
      content: "",
    }).content,
    "",
  );
});

test("artifact content arrives as text with the renderer the server chose", () => {
  assert.deepEqual(
    parseArtifactContent({
      read: "Content",
      mediaType: "text/x-diff",
      renderer: "UnifiedDiff",
      content: "--- a\n+++ b\n",
    }),
    {
      mediaType: "text/x-diff",
      renderer: "UnifiedDiff",
      content: "--- a\n+++ b\n",
    },
  );
});
