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
    identity: { type: "WorkTask", value: { ticket: 1, cycle: 1 } },
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
  readonly cursor: string | undefined;
}

/** A wire answering `pagesOf(selection)` pages of `perPage` executions each,
 * each page's tickets after the last, refusing the `failAt`th ask. */
function walking(
  pagesOf: (selection: ProjectExecutionSelection) => number,
  failAt?: number,
  perPage = 1,
): {
  readonly readPage: (
    selection: ProjectExecutionSelection,
    cursor: string | undefined,
  ) => Promise<ApiResult<ExecutionsResponse>>;
  readonly asked: WalkAsked[];
} {
  const asked: WalkAsked[] = [];
  return {
    asked,
    readPage: (selection, cursor) => {
      asked.push({ selection, cursor });
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
          executions: Array.from({ length: perPage }, (_unused, slot) =>
            execution({
              execution: `${identity}-${String(slot)}`,
              ticket: (at - 1) * perPage + slot + 1,
            }),
          ),
          ...(last ? {} : { nextCursor: identity }),
        },
      });
    },
  };
}

test("a walk reads each ticket's latest, and the wire ending it ends the read", async () => {
  const held = walking(() => 2);
  const answered = await projectExecutionIndexRead(held.readPage);
  expect(held.asked.map((one) => one.selection)).toStrictEqual([
    "Latest",
    "Latest",
  ]);
  expect(held.asked[1]?.cursor).toBe("Latest-1");
  expect(
    answered.outcome === "Ok" && projectExecutionIndexAt(answered.value, 1),
  ).toBeDefined();
  expect(
    answered.outcome === "Ok" && projectExecutionIndexAt(answered.value, 2),
  ).toBeDefined();
});

/** The read grows with tickets, so a project whose history is many times its
 * ticket count is joined whole as long as its tickets fit the budget. */
test("a project whose tickets fit the budget is joined for every ticket", async () => {
  const perPage = 100;
  const held = walking(() => projectExecutionPagesMax, undefined, perPage);
  const answered = await projectExecutionIndexRead(held.readPage);
  const tickets = projectExecutionPagesMax * perPage;
  const joined =
    answered.outcome === "Ok" ? Object.keys(answered.value.latest).length : 0;
  expect(joined).toBe(tickets);
  expect(held.asked.some((one) => one.selection === "NonTerminal")).toBe(false);
});

test("a walk stopped by its budget asks again for what is running", async () => {
  const held = walking((selection) =>
    selection === "Latest" ? projectExecutionPagesMax + 5 : 1,
  );
  await projectExecutionIndexRead(held.readPage);
  expect(held.asked.filter((one) => one.selection === "Latest").length).toBe(
    projectExecutionPagesMax,
  );
  expect(
    held.asked.filter((one) => one.selection === "NonTerminal").length,
  ).toBe(1);
});

/** A ticket older than the budget is past the latest walk, and the running walk
 * is what joins it. */
test("a walk stopped by its budget still leaves a running row exact", async () => {
  const old = 4000;
  const answering = (selection: ProjectExecutionSelection) =>
    Promise.resolve<ApiResult<ExecutionsResponse>>({
      outcome: "Ok",
      value:
        selection === "Latest"
          ? {
              executions: [execution({ execution: "new", ticket: 5000 })],
              nextCursor: "more",
            }
          : {
              executions: [
                execution({ execution: "old", ticket: old, status: "Running" }),
              ],
            },
    });
  const answered = await projectExecutionIndexRead(answering);
  const kept =
    answered.outcome === "Ok"
      ? projectExecutionIndexAt(answered.value, old)
      : undefined;
  expect(kept?.execution).toBe("old");
  expect(kept?.status).toBe("Running");
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

test("a walk refused partway keeps what it had and asks what is running", async () => {
  const held = walking((selection) => (selection === "Latest" ? 5 : 1), 3);
  const answered = await projectExecutionIndexRead(held.readPage);
  const kept =
    answered.outcome === "Ok"
      ? projectExecutionIndexAt(answered.value, 2)
      : undefined;
  expect(kept?.execution).toBe("Latest-2-0");
  expect(held.asked.at(-1)?.selection).toBe("NonTerminal");
});

/**
 * The merge's other direction: a ticket whose latest is a newer terminal
 * execution while the running walk carries an older one still queued. Taking
 * the arriving entry would draw a failed ticket as running.
 */
test("the running walk does not replace a newer entry with an older one", () => {
  const answering = (selection: ProjectExecutionSelection) =>
    Promise.resolve<ApiResult<ExecutionsResponse>>({
      outcome: "Ok",
      value: {
        executions: [
          selection === "Latest"
            ? execution({
                execution: "e-later",
                ticket: 1,
                registeredAt: "2026-08-26T12:00:00.000Z",
                status: "Terminal",
                outcome: "Failed",
              })
            : execution({
                execution: "e-earlier",
                ticket: 1,
                registeredAt: "2026-08-26T09:00:00.000Z",
                status: "Queued",
              }),
        ],
        ...(selection === "Latest" ? { nextCursor: "e-later" } : {}),
      },
    });
  return projectExecutionIndexRead(answering).then((answered) => {
    const kept =
      answered.outcome === "Ok"
        ? projectExecutionIndexAt(answered.value, 1)
        : undefined;
    expect(kept?.execution).toBe("e-later");
  });
});
