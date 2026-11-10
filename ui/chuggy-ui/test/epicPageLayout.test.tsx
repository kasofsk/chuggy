/**
 * One epic's page as a layout: the header with its standing, notes and
 * actions, the three tabs and what each draws, and every read made once by
 * the layout so a tab switch reads nothing again.
 */

import { onlineManager } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  EpicHistoryTab,
  EpicOverviewTab,
  EpicTicketsTab,
} from "../app/browser/epic/EpicPageTabs.tsx";
import {
  epicGraph,
  epicHistoryPaged,
  epicPageDrawn,
  epicRow,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { intersectionObserverStubbed } from "./intersectionObserver.ts";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";
import { answer, settled } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
  onlineManager.setOnline(true);
});

const epicPath = `/${leadPartition.tenant}/${leadPartition.project}/epics/7`;

function gets(sent: readonly { method: string; url: string }[]): number {
  return sent.filter((request) => request.method === "GET").length;
}

test("the tabs are links to the epic's three addresses, Tickets naming how many it holds", async () => {
  await epicPageDrawn(abilitiesNone);
  const tabs = within(screen.getByRole("navigation", { name: "Epic" }));
  expect(
    tabs
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toStrictEqual([
    ["Overview", epicPath],
    ["Tickets2", `${epicPath}/tickets`],
    ["History", `${epicPath}/history`],
  ]);
});

test("a tab switch reads nothing again, since the layout made every read", async () => {
  const { sent, rerender } = await epicPageDrawn(abilitiesNone);
  const read = gets(sent);
  rerender(<EpicTicketsTab />);
  await settled();
  rerender(<EpicHistoryTab />);
  await settled();
  expect(screen.getByText("Billing 3")).toBeTruthy();
  rerender(<EpicOverviewTab />);
  await settled();
  expect(screen.getByText("All of billing")).toBeTruthy();
  expect(gets(sent)).toBe(read);
});

test("the overview draws the graph, then the summary, then the description", async () => {
  await epicPageDrawn(abilitiesNone);
  const graph = await screen.findByRole("region", {
    name: "Tickets of the epic and what they wait on",
  });
  const summary = screen.getByText("All of billing");
  const description = screen.getByText("whole");
  const following = Node.DOCUMENT_POSITION_FOLLOWING;
  expect(graph.compareDocumentPosition(summary) & following).toBe(following);
  expect(summary.compareDocumentPosition(description) & following).toBe(
    following,
  );
});

test("the header draws the title, the standing and a muted line naming the revision and who saved it", async () => {
  await epicPageDrawn(abilitiesNone);
  const header = document.querySelector<HTMLElement>("header.ticket-header");
  if (header === null) throw new Error("the header is drawn");
  expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe(
    "Billing #7",
  );
  expect(within(header).getByText("In progress")).toBeTruthy();
  expect(within(header).getByRole("progressbar")).toBeTruthy();
  expect(within(header).queryByText("Archived")).toBeNull();
  expect(header.querySelector(".epic-header-saved")?.textContent).toMatch(
    /^Revision 3 · saved by .+/u,
  );
});

test("an archived epic says so beside its title and offers to reactivate it", async () => {
  epicServing.view = { ...epicView, visibility: "Archived" };
  await epicPageDrawn(abilitiesEvery);
  const header = document.querySelector<HTMLElement>("header.ticket-header");
  if (header === null) throw new Error("the header is drawn");
  expect(within(header).getByText("Archived")).toBeTruthy();
  expect(
    within(header).getByRole("button", { name: "Reactivate" }),
  ).toBeTruthy();
});

test("archiving asks first, then revises the epic archived at the revision read", async () => {
  const { sent } = await epicPageDrawn(abilitiesEvery, {
    written: () => answer({ epic: 7, revision: 4 }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await settled();
  const asking = screen.getByRole("dialog", { name: "Archive this epic?" });
  expect(sent.filter((request) => request.method !== "GET")).toHaveLength(0);
  fireEvent.click(within(asking).getByRole("button", { name: "Archive" }));
  await settled();
  expect(
    sent.filter((request) => request.method !== "GET").at(-1)?.body,
  ).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { visibility: "Archived", tickets: [4, 5] },
  });
});

test("a reader who may not write is offered no action on the epic", async () => {
  await epicPageDrawn(abilitiesNone);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
});

test("the notes link the escalated member and the tickets outside the epic it waits on", async () => {
  epicServing.graph = {
    ...epicGraph,
    nodes: epicGraph.nodes.map((node) =>
      node.ticket === 5 ? { ...node, phase: "Escalated" } : node,
    ),
  };
  await epicPageDrawn(abilitiesNone);
  const attention = document.querySelector('[data-note="attention"]');
  expect(attention?.textContent).toBe(
    "Needs attention: #5 Refund is escalated",
  );
  expect(attention?.querySelector("a")?.getAttribute("href")).toBe(
    `/${leadPartition.tenant}/${leadPartition.project}/tickets/5`,
  );
  const waiting = document.querySelector('[data-note="waiting"]');
  expect(waiting?.textContent).toBe(
    "Waiting on 1 ticket outside this epic: #2 Schema",
  );
  expect(waiting?.querySelector("a")?.getAttribute("href")).toBe(
    `/${leadPartition.tenant}/${leadPartition.project}/tickets/2`,
  );
});

test("the sticky bar holding the status and the title shows once the header has scrolled away", async () => {
  const report = intersectionObserverStubbed();
  await epicPageDrawn(abilitiesNone);
  const bar = document.querySelector<HTMLElement>(".ticket-sticky-bar");
  expect(bar?.hidden).toBe(true);
  act(() => {
    report(false);
  });
  expect(bar?.hidden).toBe(false);
  expect(within(bar as HTMLElement).getByText("Billing")).toBeTruthy();
  expect(within(bar as HTMLElement).getByText("In progress")).toBeTruthy();
});

test("the Tickets tab draws each member as a row of the ticket list", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesNone, { tab: <EpicTicketsTab /> });
  const list = screen.getByRole("list", { name: "Tickets" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Row 4");
  expect(rows[1]?.textContent).toContain("Row 5");
});

test("the Tickets tab of an epic holding none says so", async () => {
  epicServing.view = { ...epicView, tickets: [] };
  await epicPageDrawn(abilitiesNone, { tab: <EpicTicketsTab /> });
  expect(screen.getByText("This epic holds no tickets")).toBeTruthy();
});

test("the History tab draws the revisions newest first, and an older page on asking", async () => {
  epicServing.history = epicHistoryPaged.first;
  epicServing.older = epicHistoryPaged.older;
  const { sent } = await epicPageDrawn(abilitiesNone, {
    tab: <EpicHistoryTab />,
  });
  const revisions = () =>
    screen
      .getAllByRole("list", { name: "Revisions" })
      .flatMap((list) => within(list).getAllByRole("listitem"))
      .map((item) => item.textContent ?? "");
  expect(revisions()).toHaveLength(2);
  expect(revisions()[0]).toContain("Billing 3");
  expect(revisions()[1]).toContain("Billing 2");
  fireEvent.click(screen.getByRole("button", { name: "Show older" }));
  await settled();
  expect(sent.some((request) => request.url.includes("after=2"))).toBe(true);
  expect(revisions().at(-1)).toContain("Billing 1");
});

test("a ready member's dispatch control cannot be pressed while the tab is offline", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesEvery);
  const dispatch = await screen.findByRole("button", {
    name: "Dispatch ticket #5",
  });
  expect(dispatch.hasAttribute("disabled")).toBe(false);
  act(() => {
    onlineManager.setOnline(false);
  });
  expect(dispatch.hasAttribute("disabled")).toBe(true);
});
