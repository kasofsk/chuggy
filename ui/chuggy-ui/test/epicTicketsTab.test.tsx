/**
 * The epic page's Tickets tab as a reader meets it: the groups under their
 * marks, words and counts, each row's line of what it comes after, the ready
 * row's dispatch, the filter, and adding and removing members, which only a
 * reader who may write an Active epic is offered.
 */

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { EpicTicketsTab } from "../app/browser/epic/EpicTicketsTab.tsx";
import {
  epicPageDrawn,
  epicRow,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { answer, settled, turned } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
});

const ticketsPath = `/${leadPartition.tenant}/${leadPartition.project}/tickets`;

function waiting(
  ticket: number,
  on: readonly { ticket: number; phase: string }[],
): unknown {
  return {
    ...(epicRow(ticket, "Pending") as object),
    openDependencies: on,
  };
}

/** A chain 4 → 5 → 6 with a branch 4 → 8, 2 outside the epic before 5, 9 a
 * draft, and 10 escalated, 11 done and 12 revoked. */
function epicChained(): void {
  epicServing.view = { ...epicView, tickets: [4, 5, 6, 8, 9, 10, 11, 12] };
  epicServing.rows = [
    epicRow(4, "Work"),
    waiting(5, [
      { ticket: 2, phase: "Work" },
      { ticket: 4, phase: "Work" },
    ]),
    waiting(6, [{ ticket: 5, phase: "Pending" }]),
    waiting(8, [{ ticket: 4, phase: "Work" }]),
    epicRow(10, "Escalated"),
    epicRow(11, "Done"),
    epicRow(12, "Revoked"),
  ];
  epicServing.graph = {
    nodes: [
      { ticket: 2, title: "Schema", phase: "Work", member: false },
      { ticket: 4, title: "Row 4", phase: "Work", member: true },
      { ticket: 5, title: "Row 5", phase: "Pending", member: true },
      { ticket: 6, title: "Row 6", phase: "Pending", member: true },
      { ticket: 8, title: "Row 8", phase: "Pending", member: true },
      { ticket: 9, title: "Ledger", member: true },
      { ticket: 10, title: "Row 10", phase: "Escalated", member: true },
      { ticket: 11, title: "Row 11", phase: "Done", member: true },
      { ticket: 12, title: "Row 12", phase: "Revoked", member: true },
    ],
    edges: [
      { from: 2, to: 5 },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 4, to: 8 },
      { from: 11, to: 4 },
    ],
  };
}

function tab(): HTMLElement {
  return screen.getByRole("region", { name: "Tickets" });
}

function rowOf(ticket: number): HTMLElement {
  const row = tab().querySelector<HTMLElement>(
    `li[data-ticket="${String(ticket)}"]`,
  );
  if (row === null) throw new Error(`#${String(ticket)} has a row`);
  return row;
}

function heads(): readonly string[] {
  return within(tab())
    .queryAllByRole("heading", { level: 3 })
    .map((head) => head.textContent ?? "");
}

function writes(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((request) => request.method !== "GET");
}

async function drawn(
  abilities: AbilitiesAnswer,
  written?: (request: SentRequest) => Response,
) {
  return epicPageDrawn(abilities, {
    tab: <EpicTicketsTab />,
    ...(written === undefined ? {} : { written }),
  });
}

test("the members are grouped Escalated, Running, Ready, Blocked, Draft, Done, Revoked, each headed by its word and its count", async () => {
  epicChained();
  await drawn(abilitiesNone);
  expect(heads()).toStrictEqual([
    "Escalated1",
    "Running1",
    "Blocked3",
    "Draft1",
    "Done1",
    "Revoked1",
  ]);
  expect(
    tab().querySelector('[data-group="Blocked"] h3 svg.ticket-state-mark'),
  ).not.toBeNull();
});

test("a group's rows are in the order the work will happen, through the chain and its branch", async () => {
  epicChained();
  await drawn(abilitiesNone);
  const blocked = within(screen.getByRole("list", { name: "Blocked, 3" }))
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("data-ticket"));
  expect(blocked).toStrictEqual(["5", "8", "6"]);
});

test("a row names the unfinished dependencies it comes after, in the epic and out of it, each a link, and how many members wait on it", async () => {
  epicChained();
  await drawn(abilitiesNone);
  const meta = rowOf(5).querySelector(".epic-tickets-meta");
  expect(meta?.textContent).toBe("after 2, 4 · blocks 1");
  expect(
    [...(meta?.querySelectorAll("a") ?? [])].map((link) =>
      link.getAttribute("href"),
    ),
  ).toStrictEqual([`${ticketsPath}/2`, `${ticketsPath}/4`]);
  expect(rowOf(4).querySelector(".epic-tickets-meta")?.textContent).toBe(
    "blocks 2",
  );
  expect(
    within(rowOf(5)).getByRole("link", { name: "Row 5" }).getAttribute("href"),
  ).toBe(`${ticketsPath}/5`);
});

test("a Done row says nothing of what waits on it", async () => {
  epicChained();
  await drawn(abilitiesNone);
  expect(rowOf(11).querySelector(".epic-tickets-meta")).toBeNull();
});

test("a ready row's state is the ticket list's dispatch, which sends the dispatch", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  const { sent } = await drawn(abilitiesEvery, () => answer({}, 503));
  const dispatch = await within(rowOf(5)).findByRole("button", {
    name: "Dispatch ticket #5",
  });
  expect(dispatch.textContent).toBe("Ready");
  await turned(() => {
    fireEvent.click(dispatch);
  });
  await settled();
  expect(writes(sent).map((request) => request.body)).toMatchObject([
    { mutation: { mutation: "ManualDispatch", ticket: 5 } },
  ]);
});

test("a reader who may not dispatch sees the ready row's state, not a button", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await drawn(abilitiesNone);
  expect(within(rowOf(5)).getByText("Ready").closest("button")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Dispatch/u })).toBeNull();
});

test("the filter keeps the rows a number or a title answers, hides a group left empty, and says when none match", async () => {
  epicChained();
  await drawn(abilitiesNone);
  const filter = screen.getByRole("textbox", { name: "Filter tickets" });
  fireEvent.change(filter, { target: { value: "#10" } });
  expect(heads()).toStrictEqual(["Escalated1"]);
  fireEvent.change(filter, { target: { value: "ledger" } });
  expect(heads()).toStrictEqual(["Draft1"]);
  fireEvent.change(filter, { target: { value: "nothing at all" } });
  expect(heads()).toStrictEqual([]);
  expect(within(tab()).getByText("No tickets match")).toBeTruthy();
});

test("Add tickets finds tickets by number or title and adds the chosen ones in one revision at the revision read", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  epicServing.unfiltered = [epicRow(5, "Pending"), epicRow(12, "Pending")];
  const { sent } = await drawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  await turned(() => {
    fireEvent.click(within(tab()).getByRole("button", { name: "Add tickets" }));
  });
  const dialog = screen.getByRole("dialog", { name: "Add tickets" });
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Number or title" }),
    { target: { value: "Row" } },
  );
  const twelve = await within(dialog).findByRole("checkbox", {
    name: "#12 Row 12",
  });
  expect(sent.some((request) => request.url.includes("q=Row"))).toBe(true);
  expect(
    within(dialog)
      .getByRole("checkbox", { name: "#5 Row 5" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await turned(() => {
    fireEvent.click(twelve);
  });
  await turned(() => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add 1 ticket" }),
    );
  });
  await settled();
  expect(writes(sent)).toHaveLength(1);
  expect(writes(sent)[0]?.body).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { tickets: [4, 5, 12] },
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Add tickets" })).toBeNull();
  });
});

async function removed(ticket: number): Promise<void> {
  await turned(() => {
    fireEvent.keyDown(
      within(rowOf(ticket)).getByRole("button", {
        name: `More actions for #${String(ticket)}`,
      }),
      { key: "ArrowDown" },
    );
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Remove from epic",
      }),
    );
  });
  await settled();
}

test("Remove from epic sends one revision without the ticket, at the revision read, asking nothing first", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  const { sent } = await drawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  await removed(4);
  expect(writes(sent)).toHaveLength(1);
  expect(writes(sent)[0]?.body).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { tickets: [5] },
  });
});

test("a removal over another's revision is refused as stale, and the page reads the epic again", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  const { sent } = await drawn(abilitiesEvery, () =>
    answer(
      { error: { code: "StaleRevision", message: "stale" }, current: 5 },
      409,
    ),
  );
  const reads = () =>
    sent.filter(
      (request) => request.method === "GET" && request.url.endsWith("/epics/7"),
    ).length;
  const before = reads();
  await removed(4);
  expect(within(tab()).getByRole("alert").textContent).toBe(
    "The epic was changed since you opened it. Reload it and make the change again.",
  );
  expect(reads()).toBeGreaterThan(before);
});

test("a reader who may not write epics is offered neither adding nor removing", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await drawn(abilitiesNone);
  expect(
    within(tab()).queryByRole("button", { name: "Add tickets" }),
  ).toBeNull();
  expect(
    within(tab()).queryByRole("button", { name: /^More actions for/u }),
  ).toBeNull();
});

test("an archived epic offers neither adding nor removing", async () => {
  epicServing.view = { ...epicView, visibility: "Archived" };
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await drawn(abilitiesEvery);
  expect(
    within(tab()).queryByRole("button", { name: "Add tickets" }),
  ).toBeNull();
  expect(
    within(tab()).queryByRole("button", { name: /^More actions for/u }),
  ).toBeNull();
});
