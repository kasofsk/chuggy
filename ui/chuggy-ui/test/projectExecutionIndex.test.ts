/**
 * What a ticket is running, and what one `Execution` frame is allowed to change
 * about the other rows: nothing.
 */

import { expect, test } from "vitest";

import type { ExecutionSummary } from "../../../src/contract/responses.ts";
import {
  projectExecutionIndexAt,
  projectExecutionIndexFold,
  projectExecutionIndexOf,
} from "../app/core/projectExecutionIndex.ts";

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
  expect(projectExecutionIndexAt(folded ?? {}, 1)?.status).toBe("Terminal");
  expect(projectExecutionIndexAt(folded ?? {}, 2)?.status).toBe("Queued");
});

test("an execution for a ticket the index has not got joins it", () => {
  const folded = projectExecutionIndexFold(
    running,
    execution({ execution: "e9", ticket: 9, status: "Admitted" }),
  );
  expect(projectExecutionIndexAt(folded ?? {}, 9)?.status).toBe("Admitted");
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
  expect(projectExecutionIndexAt(folded ?? {}, 1)?.execution).toBe("e1");
});

test("a frame that will not read changes nothing, and no read invents an index", () => {
  expect(projectExecutionIndexFold(running, { execution: "e1" })).toBe(running);
  expect(projectExecutionIndexFold(undefined, null)).toBeUndefined();
});
