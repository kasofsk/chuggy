/**
 * The epic console logic: the address's view, the graph's layout, the form's
 * request and the sentences a refusal is drawn as.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import {
  epicDraftRefusal,
  epicFormFaults,
  epicFormFrom,
  epicGraphColumnWidth,
  epicGraphLabelCharsMax,
  epicGraphLayout,
  epicGraphRowHeight,
  epicProgressLine,
  epicStatusLook,
  epicTicketsParsed,
  epicWriteFrom,
  epicWriteRefusal,
  epicsAskOf,
  epicsQueryOf,
  epicsQueryWith,
} from "../app/core/epics.ts";
import type { EpicForm } from "../app/core/epics.ts";
import { epicStatusRoster } from "../../../src/contract/responses.ts";
import { phaseTone } from "../app/core/tones.ts";

const form: EpicForm = {
  title: "Billing",
  summary: "",
  description: "Everything about billing",
  visibility: "Active",
  tickets: "#9, 3 3 12",
};

test("an address names only the choices that differ from the defaults", () => {
  expect(epicsQueryOf({})).toStrictEqual({});
  expect(
    epicsQueryOf({ q: " bill ", visibility: "Active", sort: "newest" }),
  ).toStrictEqual({ q: "bill" });
  expect(
    epicsQueryOf({ q: 12, visibility: "Archived", sort: "title" }),
  ).toStrictEqual({ q: "12", visibility: "Archived", sort: "title" });
  expect(epicsQueryOf({ visibility: "Gone", sort: 3 })).toStrictEqual({});
});

test("a part of the address is replaced and the rest is kept", () => {
  const query = { q: "bill", sort: "title" } as const;
  expect(epicsQueryWith(query, { visibility: "All" })).toStrictEqual({
    q: "bill",
    sort: "title",
    visibility: "All",
  });
  expect(epicsQueryWith(query, { q: undefined })).toStrictEqual({
    sort: "title",
  });
});

test("the list asks for the defaults an address leaves out", () => {
  expect(epicsAskOf({})).toMatchObject({
    visibility: "Active",
    sort: "newest",
    search: undefined,
  });
  expect(epicsAskOf({ q: "x", visibility: "All" })).toMatchObject({
    search: "x",
    visibility: "All",
  });
});

test("every status the wire speaks has a word and a tone", () => {
  for (const status of epicStatusRoster)
    expect(epicStatusLook(status).word).not.toBe("");
});

test("an epic needing attention is drawn in the hue an Escalated ticket is", () => {
  expect(epicStatusLook("attention").tone).toBe(phaseTone("Escalated"));
});

test("progress is said as what is done of what there is", () => {
  const byPhase = {
    Pending: 0,
    Work: 0,
    Evaluation: 0,
    Finalization: 0,
    Done: 0,
    Escalated: 0,
    Revoked: 0,
  };
  expect(epicProgressLine({ byPhase, drafts: 0, done: 0, total: 0 })).toBe(
    "no tickets",
  );
  expect(epicProgressLine({ byPhase, drafts: 0, done: 2, total: 5 })).toBe(
    "2 of 5 done",
  );
});

const graph: EpicGraphResponse = {
  nodes: [
    { ticket: 5, title: "Charge", phase: "Work", member: true },
    { ticket: 2, title: "Schema", phase: "Done", member: false },
    { ticket: 7, phase: "Pending", member: true },
    { ticket: 4, title: "Refund", phase: "Pending", member: true },
  ],
  edges: [
    { from: 2, to: 5 },
    { from: 5, to: 7 },
    { from: 5, to: 4 },
    { from: 9, to: 4 },
  ],
};

test("a node stands in the column of its longest chain, and every edge runs rightward", () => {
  const layout = epicGraphLayout(graph);
  const at = new Map(layout.nodes.map((node) => [node.ticket, node]));
  expect(at.get(2)?.x).toBe(0);
  expect(at.get(5)?.x).toBe(epicGraphColumnWidth);
  expect(at.get(4)?.x).toBe(2 * epicGraphColumnWidth);
  expect(at.get(7)?.x).toBe(2 * epicGraphColumnWidth);
  expect(layout.edges).toHaveLength(3);
  for (const edge of layout.edges) expect(edge.from.x).toBeLessThan(edge.to.x);
});

test("nodes of one column take rows by ticket number", () => {
  const layout = epicGraphLayout(graph);
  const column = layout.nodes.filter(
    (node) => node.x === 2 * epicGraphColumnWidth,
  );
  expect(column.map((node) => [node.ticket, node.y])).toStrictEqual([
    [4, 0],
    [7, epicGraphRowHeight],
  ]);
  expect(layout.height).toBe(2 * epicGraphRowHeight);
});

test("an edge from a ticket the graph does not hold is left undrawn", () => {
  const layout = epicGraphLayout(graph);
  expect(layout.edges.some((edge) => edge.from.ticket === 9)).toBe(false);
});

test("a cycle is laid out without looping and draws no backward edge", () => {
  const layout = epicGraphLayout({
    nodes: [
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 2, to: 1 },
    ],
  });
  expect(layout.nodes).toHaveLength(2);
  for (const edge of layout.edges) expect(edge.from.x).toBeLessThan(edge.to.x);
});

test("a cycle hanging off a chain leaves the chain's columns as they were", () => {
  const layout = epicGraphLayout({
    nodes: [1, 2, 3, 4, 5].map((ticket) => ({
      ticket,
      phase: "Pending" as const,
      member: true,
    })),
    edges: [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 4, to: 5 },
      { from: 5, to: 4 },
      { from: 3, to: 4 },
    ],
  });
  const at = new Map(layout.nodes.map((node) => [node.ticket, node.x]));
  expect([1, 2, 3].map((ticket) => at.get(ticket))).toStrictEqual([
    0,
    epicGraphColumnWidth,
    2 * epicGraphColumnWidth,
  ]);
  for (const edge of layout.edges) expect(edge.from.x).toBeLessThan(edge.to.x);
});

test("a label past what its node holds is cut, and a draft says so where it has no title", () => {
  const layout = epicGraphLayout({
    nodes: [
      { ticket: 3, title: "x".repeat(epicGraphLabelCharsMax), member: true },
      { ticket: 4, member: true },
      { ticket: 5, title: "Short", phase: "Work", member: true },
    ],
    edges: [],
  });
  const label = new Map(layout.nodes.map((node) => [node.ticket, node.label]));
  expect([...(label.get(3) ?? "")]).toHaveLength(epicGraphLabelCharsMax);
  expect(label.get(3)?.endsWith("…")).toBe(true);
  expect(label.get(4)).toBe("#4 Draft");
  expect(label.get(5)).toBe("#5 Short");
});

test("an empty graph has a height and no nodes", () => {
  const layout = epicGraphLayout({ nodes: [], edges: [] });
  expect(layout.nodes).toStrictEqual([]);
  expect(layout.height).toBe(epicGraphRowHeight);
});

test("tickets are read from numbers, commas, spaces and hashes", () => {
  expect(epicTicketsParsed("#9, 3 3 12")).toStrictEqual({
    parsed: "Tickets",
    tickets: [9, 3, 3, 12],
  });
  expect(epicTicketsParsed("4, x, 0")).toStrictEqual({
    parsed: "Refused",
    words: ["x", "0"],
  });
  expect(epicTicketsParsed("")).toStrictEqual({
    parsed: "Tickets",
    tickets: [],
  });
});

test("a creation is sent with its tickets once each in order, and a revision at the revision read", () => {
  expect(epicWriteFrom(form, undefined)).toStrictEqual({
    kind: "Create",
    content: {
      title: "Billing",
      description: "Everything about billing",
      visibility: "Active",
      tickets: [3, 9, 12],
    },
  });
  expect(epicWriteFrom(form, { epic: 7, revision: 4 })).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 4,
  });
  expect(epicWriteFrom({ ...form, tickets: "x" }, undefined)).toBeUndefined();
});

test("a form reads back as the epic it was made from", () => {
  const read = epicFormFrom({
    number: 7,
    revision: 2,
    title: "Billing",
    summary: "All of it",
    description: "d",
    visibility: "Archived",
    progress: {
      byPhase: {
        Pending: 0,
        Work: 0,
        Evaluation: 0,
        Finalization: 0,
        Done: 0,
        Escalated: 0,
        Revoked: 0,
      },
      drafts: 0,
      done: 0,
      total: 0,
    },
    status: "empty",
    waitingOnOutside: [],
    tickets: [3, 9],
  });
  expect(read).toStrictEqual({
    title: "Billing",
    summary: "All of it",
    description: "d",
    visibility: "Archived",
    tickets: "3, 9",
  });
});

test("a form with no title or unreadable tickets is faulted before it is sent", () => {
  expect(epicFormFaults(form)).toStrictEqual([]);
  expect(epicFormFaults({ ...form, title: " " })).toStrictEqual([
    "The title is empty.",
  ]);
  expect(epicFormFaults({ ...form, tickets: "q" })).toStrictEqual([
    "Not ticket numbers: q.",
  ]);
});

test("a stale revision is said to need a reload, and unknown tickets are named", () => {
  expect(
    epicWriteRefusal({
      outcome: "Conflict",
      code: "StaleRevision",
      body: { current: 5 },
    }),
  ).toContain("Reload");
  expect(
    epicWriteRefusal({
      outcome: "Conflict",
      code: "UnknownTickets",
      body: { tickets: [4, 8] },
    }),
  ).toBe("The project has no ticket #4, #8.");
  expect(epicWriteRefusal({ outcome: "Absent" })).toBe(
    "The epic no longer exists.",
  );
});

test("a draft refused for its epic is said so, and any other refusal is not the epic's", () => {
  expect(
    epicDraftRefusal({ outcome: "Conflict", code: "ArchivedEpic", body: {} }),
  ).toContain("archived");
  expect(
    epicDraftRefusal({ outcome: "Conflict", code: "LargeContent", body: {} }),
  ).toContain("full");
  expect(epicDraftRefusal({ outcome: "Absent" })).toContain("no longer exists");
  expect(
    epicDraftRefusal({
      outcome: "Conflict",
      code: "DraftInitializationStale",
      body: {},
    }),
  ).toBeUndefined();
});
