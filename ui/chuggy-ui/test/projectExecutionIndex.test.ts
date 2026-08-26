/**
 * What a ticket is running, and what one `Execution` frame is allowed to change
 * about the other rows: nothing.
 */

import { expect, test } from "vitest";

import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectExecutionIndexAt,
  projectExecutionIndexEmpty,
  projectExecutionIndexFold,
  projectExecutionIndexOf,
  projectExecutionIndexRead,
  projectExecutionPagesMax,
} from "../app/core/projectExecutionIndex.ts";
import type { ProjectExecutionSelection } from "../app/core/projectExecutionIndex.ts";

function execution(
  fields: Partial<ExecutionSummary> & {
    readonly execution: string;
    readonly ticket: number;
  },
): ExecutionSummary {
  return {
    task: 1,
    taskKind: "Work",
    cluster: "rig",
    configurationRevision: "revision-a",
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
    ...fields,
  };
}

const running = projectExecutionIndexOf([
  execution({ execution: "e1", ticket: 1 }),
  execution({ execution: "e2", ticket: 2, status: "Queued" }),
]);

test("a ticket's column is the execution registered latest", () => {
  const index = projectExecutionIndexOf([
    execution({
      execution: "e1",
      ticket: 1,
      registeredAt: "2026-08-26T10:00:00.000Z",
    }),
    execution({
      execution: "e2",
      ticket: 1,
      registeredAt: "2026-08-26T11:00:00.000Z",
      status: "Launching",
    }),
  ]);
  expect(projectExecutionIndexAt(index, 1)?.execution).toBe("e2");
});

test("an execution frame updates one row's status and leaves the others", () => {
  const folded = projectExecutionIndexFold(
    running,
    execution({ execution: "e1", ticket: 1, status: "Terminal" }),
  );
  expect(
    projectExecutionIndexAt(folded ?? projectExecutionIndexEmpty, 1)?.status,
  ).toBe("Terminal");
  expect(
    projectExecutionIndexAt(folded ?? projectExecutionIndexEmpty, 2)?.status,
  ).toBe("Queued");
});

test("an execution for a ticket the index has not got joins it", () => {
  const folded = projectExecutionIndexFold(
    running,
    execution({ execution: "e9", ticket: 9, status: "Admitted" }),
  );
  expect(
    projectExecutionIndexAt(folded ?? projectExecutionIndexEmpty, 9)?.status,
  ).toBe("Admitted");
});

test("a frame older than the execution held leaves the row alone", () => {
  const folded = projectExecutionIndexFold(
    running,
    execution({
      execution: "e0",
      ticket: 1,
      registeredAt: "2026-08-26T09:00:00.000Z",
      status: "Cancelled",
    }),
  );
  expect(
    projectExecutionIndexAt(folded ?? projectExecutionIndexEmpty, 1)?.execution,
  ).toBe("e1");
});

test("a frame that will not read changes nothing, and no read invents an index", () => {
  expect(projectExecutionIndexFold(running, { execution: "e1" })).toBe(running);
  expect(projectExecutionIndexFold(undefined, null)).toBeUndefined();
});

interface WalkAsked {
  readonly selection: ProjectExecutionSelection;
  readonly after: string | undefined;
}

function walking(
  pagesOf: (selection: ProjectExecutionSelection) => number,
  failAt?: number,
): {
  readonly readPage: (
    selection: ProjectExecutionSelection,
    after: string | undefined,
  ) => Promise<ApiResult<ExecutionsResponse>>;
  readonly asked: WalkAsked[];
} {
  const asked: WalkAsked[] = [];
  return {
    asked,
    readPage: (selection, after) => {
      asked.push({ selection, after });
      if (asked.length === failAt)
        return Promise.resolve({
          outcome: "Unreachable",
          reason: "the network went away",
        });
      const at = asked.filter((one) => one.selection === selection).length;
      const last = at >= pagesOf(selection);
      const identity = `${selection}-${String(at)}`;
      return Promise.resolve({
        outcome: "Ok",
        value: {
          executions: [execution({ execution: identity, ticket: at })],
          ...(last ? {} : { nextAfter: identity }),
        },
      });
    },
  };
}

test("a walk that the wire ends is complete and says so", async () => {
  const held = walking(() => 2);
  const answered = await projectExecutionIndexRead(held.readPage);
  expect(held.asked.map((one) => one.selection)).toStrictEqual(["All", "All"]);
  expect(held.asked[1]?.after).toBe("All-1");
  expect(answered.outcome === "Ok" && answered.value.truncated).toBe(false);
  expect(
    answered.outcome === "Ok" && projectExecutionIndexAt(answered.value, 2),
  ).toBeDefined();
});

test("a walk stopped by its budget is truncated and asks again for what is running", async () => {
  const held = walking((selection) =>
    selection === "All" ? projectExecutionPagesMax + 5 : 1,
  );
  const answered = await projectExecutionIndexRead(held.readPage);
  expect(held.asked.filter((one) => one.selection === "All").length).toBe(
    projectExecutionPagesMax,
  );
  expect(
    held.asked.filter((one) => one.selection === "NonTerminal").length,
  ).toBe(1);
  expect(answered.outcome === "Ok" && answered.value.truncated).toBe(true);
});

test("a complete walk never asks the running read at all", async () => {
  const held = walking(() => 1);
  await projectExecutionIndexRead(held.readPage);
  expect(held.asked.some((one) => one.selection === "NonTerminal")).toBe(false);
});

test("a walk that will not read at all answers with the refusal", async () => {
  const held = walking(() => 3, 1);
  const answered = await projectExecutionIndexRead(held.readPage);
  expect(answered.outcome).toBe("Unreachable");
});

test("a walk refused partway keeps what it had and calls itself truncated", async () => {
  const held = walking(() => 3, 2);
  const answered = await projectExecutionIndexRead(held.readPage);
  expect(answered.outcome === "Ok" && answered.value.truncated).toBe(true);
  expect(
    answered.outcome === "Ok" && projectExecutionIndexAt(answered.value, 1),
  ).toBeDefined();
});
