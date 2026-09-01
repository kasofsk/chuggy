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
import type { ProjectExecutionKnown } from "../app/core/projectExecutionIndex.ts";
import {
  projectTableExecutionPhrase,
  projectTableRow,
  projectTableRows,
  projectTableRowsIn,
  projectTableRunsOn,
} from "../app/core/projectTableRows.ts";
import { ticketInstants } from "./ticketInstants.ts";

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

const working: TicketResponse = {
  ticket: 1,
  phase: "Working",
  sequence: 5,
  ...ticketInstants,
};

function known(
  execution: ExecutionSummary,
  complete = true,
): ProjectExecutionKnown {
  return { execution, complete };
}

const tickets: readonly TicketResponse[] = [
  working,
  {
    ticket: 2,
    phase: "Escalated",
    sequence: 4,
    reason: "GasExhausted",
    ...ticketInstants,
  },
  { ticket: 3, phase: "Pending", sequence: 3, ...ticketInstants },
];

test("a running ticket's row carries its status, what it runs on and its configuration", () => {
  const row = projectTableRow(working, known(container), false);
  expect(row.executionStatus).toBe("Running");
  expect(row.runsOn).toEqual({
    text: "worker:1",
    title: "registry/worker:1",
  });
  expect(row.configuration).toEqual({
    text: "repository:abc:work",
    title: "repository:abc:work",
  });
  expect(row.activityAt).toBe("2026-08-26T10:00:00.000Z");
  expect(row.section).toBe("InProgress");
});

test("a row names the configuration and the worker the wire named", () => {
  const row = projectTableRow(
    working,
    known({
      ...container,
      configurationVersion: { name: "work", number: 12 },
      worker: { name: "chuggy-worker", version: "3" },
    }),
    false,
  );
  expect(row.configuration).toEqual({
    text: "work #12",
    title: "repository:abc:work",
  });
  expect(row.runsOn).toEqual({
    text: "chuggy-worker 3",
    title: "registry/worker:1",
  });
});

test("a ticket running nothing states no execution rather than a blank one", () => {
  const row = projectTableRow(
    { ticket: 4, phase: "Pending", sequence: 1, ...ticketInstants },
    undefined,
    false,
  );
  expect(row.executionStatus).toBeUndefined();
  expect(row.runsOn).toBeUndefined();
  expect(row.configuration).toBeUndefined();
  expect(row.activityAt).toBeUndefined();
  expect(row.sequence).toBe(1);
});

const failedOlder: ExecutionSummary = {
  ...container,
  status: "Terminal",
  outcome: "Failed",
  terminalAt: "2026-08-26T12:00:00.000Z",
};

test("a terminal execution's instant is when it ended", () => {
  const row = projectTableRow(working, known(failedOlder), false);
  expect(row.activityAt).toBe("2026-08-26T12:00:00.000Z");
  expect(row.executionOutcome).toBe("Failed");
});

test("a row the index reached says so, and one it never ran says that", () => {
  expect(projectTableRow(working, known(container), false).executionRead).toBe(
    "Joined",
  );
  expect(projectTableRow(working, undefined, false).executionRead).toBe(
    "NoneRegistered",
  );
});

test("a row a truncated index did not reach is not a row that never ran", () => {
  expect(projectTableRow(working, undefined, true).executionRead).toBe(
    "IndexTruncated",
  );
  expect(projectTableRow(working, known(container), true).executionRead).toBe(
    "Joined",
  );
});

test("an execution a truncated walk left may be superseded, so the row is not joined", () => {
  const row = projectTableRow(working, known(failedOlder, false), true);
  expect(row.executionRead).toBe("IndexTruncated");
});

test("a ticket's own title is its row's title, apart from any execution", () => {
  const titled: TicketResponse = { ...working, title: "Fix the retry backoff" };
  expect(projectTableRow(titled, known(container), false).title).toEqual({
    text: "Fix the retry backoff",
    title: "Fix the retry backoff",
  });
  expect(projectTableRow(titled, undefined, false).title).toEqual({
    text: "Fix the retry backoff",
    title: "Fix the retry backoff",
  });
});

test("a ticket's title survives a truncated execution index, unlike its configuration", () => {
  const titled: TicketResponse = { ...working, title: "Fix the retry backoff" };
  const row = projectTableRow(titled, undefined, true);
  expect(row.executionRead).toBe("IndexTruncated");
  expect(row.title).toEqual({
    text: "Fix the retry backoff",
    title: "Fix the retry backoff",
  });
});

test("a ticket authored before a brief was required carries no title", () => {
  expect(
    projectTableRow(working, known(container), false).title,
  ).toBeUndefined();
});

test("a row that is not joined draws none of the execution it holds", () => {
  const row = projectTableRow(working, known(failedOlder, false), true);
  expect(row.executionOutcome).toBeUndefined();
  expect(row.executionStatus).toBeUndefined();
  expect(row.configuration).toBeUndefined();
  expect(row.runsOn).toBeUndefined();
  expect(row.activityAt).toBeUndefined();
});

test("a row whose entry a walk finished is joined even where others were not", () => {
  const rows = projectTableRows(tickets, {
    latest: {
      "1": known(container, false),
      "2": known({ ...container, ticket: 2 }, true),
    },
    truncated: true,
  });
  expect(rows.map((row) => row.executionRead)).toStrictEqual([
    "IndexTruncated",
    "Joined",
    "IndexTruncated",
  ]);
});

test("a truncated index marks every row it did not reach", () => {
  const rows = projectTableRows(tickets, {
    latest: {},
    truncated: true,
  });
  expect(rows.map((row) => row.executionRead)).toStrictEqual([
    "IndexTruncated",
    "IndexTruncated",
    "IndexTruncated",
  ]);
});

test("what a task runs on is its worker or its driver, by the mode it names", () => {
  expect(projectTableRunsOn(container)).toEqual({
    text: "worker:1",
    title: "registry/worker:1",
  });
  expect(
    projectTableRunsOn({
      ...container,
      requirement: {
        mode: "Native",
        architecture: "Arm64",
        driver: "XcodeTesting",
        xcodeVersionMin: 16,
        sdkVersionMin: 18,
      },
    }),
  ).toEqual({ text: "XcodeTesting", title: "XcodeTesting" });
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

test("the execution cell is the status, refined only where an outcome exists", () => {
  const running = projectTableRow(working, known(container), false);
  expect(projectTableExecutionPhrase(running)).toBe("Running");
  expect(
    projectTableExecutionPhrase({ ...running, executionOutcome: "Failed" }),
  ).toBe("Running \u00b7 Failed");
  expect(
    projectTableExecutionPhrase({ ...running, executionStatus: undefined }),
  ).toBeUndefined();
});
