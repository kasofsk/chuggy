/**
 * The join behind one row: the ticket's own fields, and the columns that come
 * from whatever it is running.
 */

import { expect, test } from "vitest";

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  projectTableRow,
  projectTableRows,
  projectTableRunsOn,
} from "../app/core/projectTableRows.ts";
import { ticketInstants } from "./ticketInstants.ts";

const container: ExecutionSummary = {
  execution: "e1",
  ticket: 1,
  task: 1,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
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
  phase: "Work",
  sequence: 5,
  ...ticketInstants,
};

const tickets: readonly TicketResponse[] = [
  working,
  {
    ticket: 2,
    phase: "Escalated",
    sequence: 4,
    escalation: {
      kind: "EvaluationFailureEscalated",
      resumeAt: "ResumeRework",
    },
    ...ticketInstants,
  },
  { ticket: 3, phase: "Pending", sequence: 3, ...ticketInstants },
];

test("a running ticket's row carries its verdict and what it runs on", () => {
  const row = projectTableRow(working, container);
  expect(row.executionVerdict).toBe("Running");
  expect(row.runsOn).toEqual({
    text: "worker:1",
    title: "registry/worker:1",
  });
  expect(row.activityAt).toBe(ticketInstants.changedAt);
});

test("a row names the worker the wire named", () => {
  const row = projectTableRow(working, {
    ...container,
    configurationVersion: { name: "work", number: 12 },
    worker: { name: "chuggy-worker", version: "3" },
  });
  expect(row.runsOn).toEqual({
    text: "chuggy-worker 3",
    title: "registry/worker:1",
  });
});

test("a row's title is the ticket's own, and absent where the wire names none", () => {
  expect(
    projectTableRow({ ...working, title: "Fix the importer" }, undefined).title,
  ).toBe("Fix the importer");
  expect(projectTableRow(working, undefined).title).toBeUndefined();
});

test("a row names the repository the ticket works in, and none where the wire names none", () => {
  const repository = "https://github.com/acme/widgets.git";
  expect(
    projectTableRow({ ...working, repository }, undefined).repository,
  ).toBe(repository);
  expect(projectTableRow(working, undefined).repository).toBeUndefined();
});

test("a row names the member who filed the ticket, and nobody where the wire names none", () => {
  const creator = "23:https://issuer.example/user-0123456789abcdef0123";
  expect(projectTableRow({ ...working, creator }, undefined).creator).toBe(
    creator,
  );
  expect(projectTableRow(working, undefined).creator).toBeUndefined();
});

test("a ticket running nothing states no execution rather than a blank one", () => {
  const row = projectTableRow(
    { ticket: 4, phase: "Pending", sequence: 1, ...ticketInstants },
    undefined,
  );
  expect(row.executionVerdict).toBeUndefined();
  expect(row.runsOn).toBeUndefined();
  expect(row.activityAt).toBe(ticketInstants.changedAt);
});

const failedOlder: ExecutionSummary = {
  ...container,
  status: "Terminal",
  outcome: "Failed",
  terminalAt: "2026-08-26T12:00:00.000Z",
};

test("a terminal execution older than the ticket's own last move reads as the ticket's", () => {
  const row = projectTableRow(working, failedOlder);
  expect(row.activityAt).toBe(ticketInstants.changedAt);
  expect(row.executionVerdict).toBe("Failed");
});

const failedNewer: ExecutionSummary = {
  ...container,
  status: "Terminal",
  outcome: "Failed",
  terminalAt: "2026-08-28T00:00:00.000Z",
};

test("a row takes the later of the ticket's own last move and its execution's", () => {
  const row = projectTableRow(working, failedNewer);
  expect(row.activityAt).toBe("2026-08-28T00:00:00.000Z");
});

/**
 * `2026-08-27T01:00:00+02:00` is `2026-08-26T23:00:00Z`, earlier than the
 * ticket's own `2026-08-27T00:30:00Z` — but it sorts later as a bare string, so
 * a lexical compare would pick the execution where the chronological one must
 * pick the ticket.
 */
test("the later instant is read chronologically, not lexically", () => {
  const row = projectTableRow(
    { ...working, changedAt: "2026-08-27T00:30:00Z" },
    {
      ...container,
      status: "Terminal",
      outcome: "Failed",
      terminalAt: "2026-08-27T01:00:00+02:00",
    },
  );
  expect(row.activityAt).toBe("2026-08-27T00:30:00Z");
});

test("a row joined to its ticket's latest draws it, and one with nothing joined draws none", () => {
  const rows = projectTableRows(tickets, {
    latest: { "2": { ...failedOlder, ticket: 2 } },
  });
  expect(rows.map((row) => row.executionVerdict)).toStrictEqual([
    undefined,
    "Failed",
    undefined,
  ]);
  expect(rows.map((row) => row.runsOn === undefined)).toStrictEqual([
    true,
    false,
    true,
  ]);
});

test("what a task runs on is its worker, capability or driver, by the mode it names", () => {
  expect(projectTableRunsOn(container)).toEqual({
    text: "worker:1",
    title: "registry/worker:1",
  });
  expect(
    projectTableRunsOn({
      ...container,
      requirement: {
        mode: "Capability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      },
    }),
  ).toEqual({ text: "Claude", title: "Agent:Claude" });
  expect(
    projectTableRunsOn({
      ...container,
      requirement: {
        mode: "Capability",
        operatingSystem: "MacOS",
        architecture: "Arm64",
        capabilities: ["Tool:Xcode"],
      },
    }),
  ).toEqual({ text: "Xcode", title: "Tool:Xcode" });
});
