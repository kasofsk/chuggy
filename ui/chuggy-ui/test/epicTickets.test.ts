/**
 * An epic's members as its Tickets tab groups them: the groups in the order
 * the work moves through them, each in the order the work will happen, what
 * unfinished each comes after and how many wait on it, the filter, and the
 * revisions that add a ticket and take one out.
 */

import { expect, test } from "vitest";

import type {
  EpicGraphResponse,
  EpicViewResponse,
} from "../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import {
  epicTicketsAdded,
  epicTicketsGrouped,
  epicTicketsMembersOf,
  epicTicketsRemoved,
  epicWorkOrdered,
} from "../app/core/epicTickets.ts";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";

function row(
  ticket: number,
  phase: TicketPhase,
  open: readonly { ticket: number; phase: TicketPhase }[] = [],
): ProjectTableRow {
  return {
    ticket,
    title: `Row ${String(ticket)}`,
    repository: undefined,
    creator: undefined,
    phase,
    sequence: ticket,
    badge: undefined,
    executionVerdict: undefined,
    activityAt: "2026-08-27T00:00:00Z",
    openDependencies: open,
    revokedDependencies: [],
  };
}

function rowsOf(
  rows: readonly ProjectTableRow[],
): ReadonlyMap<number, ProjectTableRow> {
  return new Map(rows.map((held) => [held.ticket, held]));
}

test("the groups run Escalated, Running, Ready, Blocked, Draft, Done, Revoked, each only where it holds a member, Running holding every phase that moves", () => {
  const rows = [
    row(1, "Done"),
    row(2, "Revoked"),
    row(3, "Work"),
    row(4, "Evaluation"),
    row(5, "Finalization"),
    row(6, "Pending"),
    row(7, "Pending", [{ ticket: 3, phase: "Work" }]),
    row(8, "Escalated"),
  ];
  const graph: EpicGraphResponse = {
    nodes: [{ ticket: 9, title: "Draft", member: true }],
    edges: [],
  };
  const groups = epicTicketsGrouped(
    epicTicketsMembersOf([1, 2, 3, 4, 5, 6, 7, 8, 9], rowsOf(rows), graph),
    "",
  );
  expect(
    groups.map((group) => [group.group, group.members.length]),
  ).toStrictEqual([
    ["Escalated", 1],
    ["Running", 3],
    ["Ready", 1],
    ["Blocked", 1],
    ["Draft", 1],
    ["Done", 1],
    ["Revoked", 1],
  ]);
  expect(
    epicTicketsGrouped(
      epicTicketsMembersOf([1, 6], rowsOf(rows), undefined),
      "",
    ).map((group) => group.group),
  ).toStrictEqual(["Ready", "Done"]);
});

test("a member is after everything it waits on, by its depth through a chain and a branch, then by number", () => {
  const edges = [
    { from: 10, to: 3 },
    { from: 3, to: 8 },
    { from: 10, to: 2 },
    { from: 99, to: 10 },
  ];
  expect(epicWorkOrdered([8, 3, 2, 10, 1], edges)).toStrictEqual([
    1, 10, 2, 3, 8,
  ]);
});

test("a member's order within its group is the order the work will happen", () => {
  const rows = [
    row(10, "Pending"),
    row(3, "Pending", [{ ticket: 10, phase: "Pending" }]),
    row(2, "Pending", [{ ticket: 10, phase: "Pending" }]),
    row(8, "Pending", [{ ticket: 3, phase: "Pending" }]),
  ];
  const graph: EpicGraphResponse = {
    nodes: rows.map((held) => ({
      ticket: held.ticket,
      phase: "Pending" as const,
      member: true,
    })),
    edges: [
      { from: 10, to: 3 },
      { from: 3, to: 8 },
      { from: 10, to: 2 },
    ],
  };
  const blocked = epicTicketsGrouped(
    epicTicketsMembersOf([8, 3, 2, 10], rowsOf(rows), graph),
    "",
  ).find((group) => group.group === "Blocked");
  expect(blocked?.members.map((member) => member.ticket)).toStrictEqual([
    2, 3, 8,
  ]);
});

test("a member comes after its unfinished dependencies in the epic and out of it, and blocks the members waiting on it", () => {
  const rows = [
    row(4, "Work"),
    row(5, "Pending", [
      { ticket: 2, phase: "Work" },
      { ticket: 4, phase: "Work" },
    ]),
    row(6, "Pending", [{ ticket: 4, phase: "Work" }]),
  ];
  const graph: EpicGraphResponse = {
    nodes: [
      { ticket: 1, phase: "Done", member: false },
      { ticket: 2, phase: "Work", member: false },
      { ticket: 4, phase: "Work", member: true },
      { ticket: 5, phase: "Pending", member: true },
      { ticket: 6, phase: "Pending", member: true },
      { ticket: 7, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 5 },
      { from: 2, to: 5 },
      { from: 4, to: 5 },
      { from: 4, to: 6 },
      { from: 1, to: 7 },
      { from: 6, to: 7 },
    ],
  };
  const members = new Map(
    epicTicketsMembersOf([4, 5, 6, 7], rowsOf(rows), graph).map((member) => [
      member.ticket,
      member,
    ]),
  );
  expect(members.get(5)?.after).toStrictEqual([2, 4]);
  expect(members.get(4)?.after).toStrictEqual([]);
  expect(members.get(4)?.blocks).toBe(2);
  expect(members.get(5)?.blocks).toBe(0);
  expect(members.get(7)?.after).toStrictEqual([6]);
});

test("a Done member says nothing of what waits on it", () => {
  const graph: EpicGraphResponse = {
    nodes: [
      { ticket: 4, phase: "Done", member: true },
      { ticket: 5, phase: "Pending", member: true },
    ],
    edges: [{ from: 4, to: 5 }],
  };
  const [done] = epicTicketsMembersOf(
    [4, 5],
    rowsOf([row(4, "Done"), row(5, "Pending")]),
    graph,
  );
  expect(done?.ticket).toBe(4);
  expect(done?.blocks).toBeUndefined();
});

test("the filter keeps the members whose number or title answers it, and no group where none does", () => {
  const members = epicTicketsMembersOf(
    [14, 41, 5],
    rowsOf([row(14, "Done"), row(41, "Pending"), row(5, "Work")]),
    undefined,
  );
  const kept = (typed: string) =>
    epicTicketsGrouped(members, typed).flatMap((group) =>
      group.members.map((member) => member.ticket),
    );
  expect(kept("#41")).toStrictEqual([41]);
  expect(kept("14")).toStrictEqual([14]);
  expect(kept("row 5")).toStrictEqual([5]);
  expect(epicTicketsGrouped(members, "nothing")).toStrictEqual([]);
});

const view: EpicViewResponse = {
  number: 7,
  revision: 3,
  title: "Billing",
  summary: "All of billing",
  description: "The whole of billing",
  visibility: "Active",
  progress: {
    byPhase: {
      Pending: 1,
      Work: 0,
      Evaluation: 0,
      Finalization: 0,
      Done: 1,
      Escalated: 0,
      Revoked: 0,
    },
    drafts: 0,
    done: 1,
    total: 2,
  },
  status: "in_progress",
  waitingOnOutside: [],
  tickets: [4, 5],
};

test("adding is one revision at the revision read, holding the tickets added", () => {
  expect(epicTicketsAdded(view, [12, 9])).toStrictEqual({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: {
      title: "Billing",
      summary: "All of billing",
      description: "The whole of billing",
      visibility: "Active",
      tickets: [4, 5, 9, 12],
    },
  });
});

test("removing is one revision at the revision read, without the ticket", () => {
  expect(epicTicketsRemoved(view, 4)).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { tickets: [5] },
  });
});
