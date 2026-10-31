/**
 * What frames do to the latest execution a ticket's row carries: an
 * `Execution` frame moves it where it is the latest, in the order
 * `latest=true` answers, and a `Ticket` frame, which carries none, keeps it.
 */

import { expect, test } from "vitest";

import { ticketLatestExecutionSchema } from "../../../src/contract/responses.ts";
import type { ExecutionSummary } from "../../../src/contract/responses.ts";
import {
  projectListAlongside,
  projectQueryScope,
} from "../app/core/projectQueryKeys.ts";
import {
  projectTicketRowsEmpty,
  projectTicketRowsExecutionFold,
  projectTicketRowsFold,
} from "../app/core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import {
  ticketFilterList,
  ticketListAskDefault,
} from "../app/core/projectTableFilters.ts";
import { ticketInstants } from "./ticketInstants.ts";

const running: ExecutionSummary = {
  execution: "execution-a-2",
  ticket: 7,
  task: 2,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 7, cycle: 1 } },
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

const ticket = { ticket: 7, phase: "Work" as const, sequence: 5 };

const rows: ProjectTicketRows = {
  ...projectTicketRowsEmpty,
  tickets: [
    {
      ...ticket,
      ...ticketInstants,
      latestExecution: ticketLatestExecutionSchema.parse(running),
    },
    { ticket: 8, phase: "Pending", sequence: 4, ...ticketInstants },
  ],
};

function latestOf(held: ProjectTicketRows | undefined, at: number) {
  return held?.tickets.find((row) => row.ticket === at)?.latestExecution;
}

test("an execution's frame moves its ticket's cell, the same execution's included", () => {
  const ended = {
    ...running,
    status: "Terminal",
    outcome: "Passed",
    terminalAt: "2026-08-26T11:00:00.000Z",
  };
  expect(latestOf(projectTicketRowsExecutionFold(rows, ended), 7)).toEqual(
    ticketLatestExecutionSchema.parse(ended),
  );
  const later = { ...running, execution: "execution-b-3", task: 3 };
  expect(
    latestOf(projectTicketRowsExecutionFold(rows, later), 7)?.execution,
  ).toBe("execution-b-3");
  const first = {
    ...running,
    execution: "execution-c-1",
    ticket: 8,
    task: 1,
    identity: { type: "WorkTask", value: { ticket: 8, cycle: 1 } },
  };
  expect(latestOf(projectTicketRowsExecutionFold(rows, first), 8)?.task).toBe(
    1,
  );
});

/** An earlier task registered at a later instant is still not the latest, as
 * `latest=true` answers the highest task whatever the instants say. */
test("an older execution's frame leaves the cell where it is", () => {
  const older = {
    ...running,
    execution: "execution-z-1",
    task: 1,
    registeredAt: "2026-08-27T00:00:00.000Z",
    status: "Terminal",
    outcome: "Failed",
  };
  expect(projectTicketRowsExecutionFold(rows, older)).toBe(rows);
});

test("a tombstone, an unreadable frame or a ticket the rows lack leaves them", () => {
  expect(projectTicketRowsExecutionFold(rows, null)).toBe(rows);
  expect(projectTicketRowsExecutionFold(rows, { execution: "x" })).toBe(rows);
  expect(projectTicketRowsExecutionFold(rows, { ...running, ticket: 99 })).toBe(
    rows,
  );
  expect(projectTicketRowsExecutionFold(undefined, running)).toBeUndefined();
});

test("a ticket's frame keeps the cell its row holds, and a row arriving holds none", () => {
  const moved = projectTicketRowsFold(
    rows,
    "7",
    { ...ticket, ...ticketInstants, sequence: 9, phase: "Escalated" },
    undefined,
  );
  expect(moved?.tickets[0]?.sequence).toBe(9);
  expect(latestOf(moved, 7)).toEqual(rows.tickets[0]?.latestExecution);
  const arriving = projectTicketRowsFold(
    rows,
    "9",
    { ticket: 9, phase: "Pending", sequence: 10, ...ticketInstants },
    undefined,
  );
  expect(latestOf(arriving, 9)).toBeUndefined();
});

test("every ticket list folds execution frames, and a list's own kind cannot be alongside it", () => {
  const list = ticketFilterList(
    { tenant: "acme", project: "atlas" },
    ticketListAskDefault,
  );
  expect(list.key[0]).toBe(projectQueryScope);
  expect(Object.keys(list.alongside)).toStrictEqual(["Execution"]);
  expect(
    Object.keys(
      ticketFilterList(
        { tenant: "acme", project: "atlas" },
        { ...ticketListAskDefault, search: "importer" },
      ).alongside,
    ),
  ).toStrictEqual(["Execution"]);
  expect(() =>
    projectListAlongside(list, "Ticket", (previous) => previous),
  ).toThrow(RangeError);
});
