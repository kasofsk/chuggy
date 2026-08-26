/**
 * The join behind one row: the ticket's own fields, and the columns that come
 * from whatever it is running.
 */

import { expect, test } from "vitest";

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { projectExecutionIndexOf } from "../app/core/projectExecutionIndex.ts";
import {
  projectTableRow,
  projectTableRows,
  projectTableRowsIn,
  projectTableRunsOn,
} from "../app/core/projectTableRows.ts";

const container: ExecutionSummary = {
  execution: "e1",
  ticket: 1,
  task: 1,
  taskKind: "Work",
  cluster: "rig",
  configurationRevision: "repository:abc:work",
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "registry/worker:1",
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
};

const working: TicketResponse = { ticket: 1, phase: "Working", sequence: 5 };

const tickets: readonly TicketResponse[] = [
  working,
  { ticket: 2, phase: "Escalated", sequence: 4, reason: "GasExhausted" },
  { ticket: 3, phase: "Pending", sequence: 3 },
];

test("a running ticket's row carries its status, what it runs on and its revision", () => {
  const row = projectTableRow(working, container);
  expect(row.executionStatus).toBe("Running");
  expect(row.runsOn).toBe("registry/worker:1");
  expect(row.configurationRevision).toBe("repository:abc:work");
  expect(row.activityAt).toBe("2026-08-26T10:00:00.000Z");
  expect(row.section).toBe("InProgress");
});

test("a ticket running nothing states no execution rather than a blank one", () => {
  const row = projectTableRow(
    { ticket: 4, phase: "Pending", sequence: 1 },
    undefined,
  );
  expect(row.executionStatus).toBeUndefined();
  expect(row.runsOn).toBeUndefined();
  expect(row.configurationRevision).toBeUndefined();
  expect(row.activityAt).toBeUndefined();
  expect(row.sequence).toBe(1);
});

test("a terminal execution's instant is when it ended", () => {
  const row = projectTableRow(working, {
    ...container,
    status: "Terminal",
    outcome: "Failed",
    terminalAt: "2026-08-26T12:00:00.000Z",
  });
  expect(row.activityAt).toBe("2026-08-26T12:00:00.000Z");
  expect(row.executionOutcome).toBe("Failed");
});

test("what a task runs on is its image or its driver, by the mode it names", () => {
  expect(projectTableRunsOn(container.requirement)).toBe("registry/worker:1");
  expect(
    projectTableRunsOn({
      mode: "Native",
      architecture: "Arm64",
      driver: "XcodeTesting",
      xcodeVersionMin: 16,
      sdkVersionMin: 18,
    }),
  ).toBe("XcodeTesting");
});

test("the rows of one section are that section's and in the order read", () => {
  const rows = projectTableRows(tickets, projectExecutionIndexOf([container]));
  expect(
    projectTableRowsIn(rows, "InProgress").map((row) => row.ticket),
  ).toStrictEqual([1]);
  expect(
    projectTableRowsIn(rows, "NeedsYou").map((row) => row.badge),
  ).toStrictEqual(["gas spent"]);
  expect(
    projectTableRowsIn(rows, "UpNext").map((row) => row.ticket),
  ).toStrictEqual([3]);
  expect(projectTableRowsIn(rows, "Done")).toStrictEqual([]);
});
