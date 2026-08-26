/**
 * What a live `Execution` frame does to the page of executions a ticket screen
 * is holding.
 *
 * The two quiet failures are here: a frame appended rather than replaced, which
 * shows one execution twice, and a frame written into a page it does not belong
 * to, which shows another ticket's work under this one.
 */

import { expect, test } from "vitest";

import type {
  ExecutionResponse,
  ExecutionsResponse,
} from "../../../src/contract/responses.ts";
import { ticketExecutionsFolded } from "../app/core/ticketExecutions.ts";

const digest = "a".repeat(64);

function execution(
  execution: string,
  over: Partial<ExecutionResponse> = {},
): ExecutionResponse {
  return {
    execution,
    ticket: 7,
    task: 1,
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
  nextAfter?: string,
): ExecutionsResponse {
  return { executions, ...(nextAfter === undefined ? {} : { nextAfter }) };
}

test("a frame for a listed execution replaces it where it stands", () => {
  const held = page([execution("e1"), execution("e2"), execution("e3")]);
  const arrived = execution("e2", { status: "Terminal", outcome: "Passed" });
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

test("a frame for an execution nobody listed lands in identity order", () => {
  const held = page([execution("e1"), execution("e3")]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e2",
    representation: execution("e2"),
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual([
    "e1",
    "e2",
    "e3",
  ]);
});

test("a frame past the end of a truncated page is left for that page", () => {
  const held = page([execution("e1"), execution("e2")], "e2");
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e9",
      representation: execution("e9"),
    }),
  ).toBe(held);
});

test("a frame past the end of a complete page is listed", () => {
  const held = page([execution("e1")]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e9",
    representation: execution("e9"),
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual(["e1", "e9"]);
});

test("a tombstone drops the execution rather than leaving it on the screen", () => {
  const held = page([execution("e1"), execution("e2")]);
  const folded = ticketExecutionsFolded(7, held, {
    resource: "e1",
    representation: null,
  });
  expect(folded?.executions.map((row) => row.execution)).toEqual(["e2"]);
});

test("another ticket's execution is not folded into this ticket's page", () => {
  const held = page([execution("e1")]);
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e5",
      representation: execution("e5", { ticket: 8 }),
    }),
  ).toBe(held);
});

test("a page nothing has read stays unread rather than being invented", () => {
  expect(
    ticketExecutionsFolded(7, undefined, {
      resource: "e1",
      representation: execution("e1"),
    }),
  ).toBeUndefined();
});

test("a representation this console cannot read leaves the page alone", () => {
  const held = page([execution("e1")]);
  expect(
    ticketExecutionsFolded(7, held, {
      resource: "e1",
      representation: { execution: "e1" },
    }),
  ).toBe(held);
});
