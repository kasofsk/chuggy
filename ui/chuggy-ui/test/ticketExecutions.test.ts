/**
 * What a live `Execution` frame does to the page of executions a ticket screen
 * is holding.
 *
 * The two quiet failures are here: a frame appended rather than replaced, which
 * shows one execution twice, and a frame written into a page it does not belong
 * to, which shows another ticket's work under this one. The stage breakdown is
 * a grouping of the same page, so it is held here beside the fold that keeps
 * that page live.
 */

import { expect, test } from "vitest";

import type {
  ExecutionResponse,
  ExecutionsResponse,
} from "../../../src/contract/responses.ts";
import { runStageLabel } from "../app/core/runTotals.ts";
import {
  ticketExecutionStages,
  ticketExecutionsFolded,
} from "../app/core/ticketExecutions.ts";

const digest = "a".repeat(64);

function execution(
  execution: string,
  task: number,
  over: Partial<ExecutionResponse> = {},
): ExecutionResponse {
  return {
    execution,
    ticket: 7,
    task,
    taskKind: "Work",
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: "req-1",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: digest,
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Running",
    retriesSpent: 0,
    registeredAt: "2026-08-26T00:00:00Z",
    attempts: [],
    ...over,
  };
}

function page(
  executions: ExecutionResponse[],
  nextCursor?: string,
): ExecutionsResponse {
  return { executions, ...(nextCursor === undefined ? {} : { nextCursor }) };
}

test("a frame for a listed execution replaces it where it stands", () => {
  const held = page([
    execution("e1", 1),
    execution("e2", 2),
    execution("e3", 3),
  ]);
  const arrived = execution("e2", 2, { status: "Terminal", outcome: "Passed" });
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e2",
    representation: arrived,
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual([
    "e1",
    "e2",
    "e3",
  ]);
  expect(folded?.executions[1]?.status).toBe("Terminal");
});

/** The identities sort against the tasks here, so a fold in either order is
 * distinguishable from a fold in the other. */
test("a frame for an execution nobody listed lands in task order", () => {
  const held = page([execution("e1", 1), execution("e10", 10)]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e2",
    representation: execution("e2", 2),
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual([
    "e1",
    "e2",
    "e10",
  ]);
});

test("a frame past the end of a truncated page is left for that page", () => {
  const held = page([execution("e1", 1), execution("e9", 9)], "opaque-cursor");
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e10",
      representation: execution("e10", 10),
    }),
  ).toBe(held);
});

test("a frame past the end of a complete page is listed", () => {
  const held = page([execution("e1", 1)]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e9",
    representation: execution("e9", 9),
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual(["e1", "e9"]);
});

test("a tombstone drops the execution rather than leaving it on the screen", () => {
  const held = page([execution("e1", 1), execution("e2", 2)]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e1",
    representation: null,
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual(["e2"]);
});

test("another ticket's execution is not folded into this ticket's page", () => {
  const held = page([execution("e1", 1)]);
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e5",
      representation: execution("e5", 5, { ticket: 8 }),
    }),
  ).toBe(held);
});

test("a page nothing has read stays unread rather than being invented", () => {
  expect(
    ticketExecutionsFolded(7, undefined, {
      resource: "e1",
      representation: execution("e1", 1),
    }),
  ).toBeUndefined();
});

/** The row names this ticket, so the schema is the only thing left that can
 * reject it. */
test("a representation this console cannot read leaves the page alone", () => {
  const held = page([execution("e1", 1)]);
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e2",
      representation: { execution: "e2", ticket: 7 },
    }),
  ).toBe(held);
});

test("a listed row this console cannot read is not written over the good one", () => {
  const held = page([execution("e1", 1, { status: "Running" })]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e1",
    representation: { execution: "e1", ticket: 7, status: "Terminal" },
  });
  expect(folded).toBe(held);
  expect(folded?.executions[0]?.status).toBe("Running");
});

/** The grouping is over the page this screen holds, so a row's figure is only
 * ever as complete as that page — which is why the ticket's own total is the
 * server's and this one is not. */
test("the page's executions group into the stages that ran them", () => {
  const totals = {
    turns: 1,
    durationMs: 1_000,
    durationApiMs: 900,
    tokensInput: 1,
    tokensOutput: 2,
    tokensCacheCreation: 3,
    tokensCacheRead: 4,
    costUsdMicros: 5_000,
    costBasis: "List" as const,
    permissionDenials: 0,
    models: [],
  };
  const stages = ticketExecutionStages(
    page([
      execution("e1", 1, { taskKind: "Work", stage: 1, runTotals: totals }),
      execution("e2", 2, {
        taskKind: "Evaluation",
        stage: 1,
        status: "Terminal",
        outcome: "Failed",
        runTotals: totals,
      }),
      execution("e3", 3, { taskKind: "Work", stage: 1, runTotals: totals }),
    ]),
  );
  expect(stages.map((row) => runStageLabel(row))).toEqual([
    "work stage 1",
    "evaluation stage 1",
  ]);
  expect(stages[0]?.executions).toBe(2);
  expect(stages[0]?.totals?.costUsdMicros).toBe(10_000);
  expect(stages[1]?.totals?.costUsdMicros).toBe(5_000);
});
