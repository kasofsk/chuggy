/**
 * One epic's page as a layout: the header with its summary, its bar, its
 * notes and its actions, the four tabs and what each draws, and every read
 * made once by the layout so a tab switch reads nothing again.
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

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";

import { EpicGraphTab } from "../app/browser/epic/EpicGraphTab.tsx";
import { EpicHistoryTab } from "../app/browser/epic/EpicHistoryTab.tsx";
import { EpicOverviewTab } from "../app/browser/epic/EpicOverviewTab.tsx";
import { EpicTicketsTab } from "../app/browser/epic/EpicTicketsTab.tsx";
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
import { answer, settled, turned } from "./screenHarness.tsx";

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

test("the tabs are links to the epic's four addresses, Tickets counting its members and History its revisions", async () => {
  await epicPageDrawn(abilitiesNone);
  const tabs = within(screen.getByRole("navigation", { name: "Epic" }));
  expect(
    tabs
      .getAllByRole("link")
      .map((link) => [
        link.textContent,
        link.querySelector(".ticket-tab-count")?.textContent,
        link.getAttribute("href"),
      ]),
  ).toStrictEqual([
    ["Overview", undefined, epicPath],
    ["Tickets2", "2", `${epicPath}/tickets`],
    ["Graph", undefined, `${epicPath}/graph`],
    ["History3", "3", `${epicPath}/history`],
  ]);
});

test("a tab switch reads nothing again, since the layout made every read", async () => {
  const { sent, rerender } = await epicPageDrawn(abilitiesNone);
  const read = gets(sent);
  rerender(<EpicTicketsTab />);
  await settled();
  rerender(<EpicGraphTab />);
  await screen.findByRole("group", {
    name: "Tickets of the epic and what they wait on",
  });
  rerender(<EpicHistoryTab />);
  await settled();
  expect(screen.getByText("Edited title")).toBeTruthy();
  rerender(<EpicOverviewTab />);
  await settled();
  expect(screen.getByText("whole")).toBeTruthy();
  expect(gets(sent)).toBe(read);
});

test("the overview draws the description and neither the graph nor the summary", async () => {
  await epicPageDrawn(abilitiesNone);
  const overview = screen.getByRole("region", { name: "Description" });
  expect(within(overview).getByText("whole")).toBeTruthy();
  expect(within(overview).queryByText("All of billing")).toBeNull();
  expect(
    screen.queryByRole("region", {
      name: "Tickets of the epic and what they wait on",
    }),
  ).toBeNull();
});

function header(): HTMLElement {
  const drawn = document.querySelector<HTMLElement>("header.ticket-header");
  if (drawn === null) throw new Error("the header is drawn");
  return drawn;
}

test("the header draws the title, the status, the summary under them, the bar and a muted line naming the revision and who saved it", async () => {
  await epicPageDrawn(abilitiesNone);
  const title = within(header()).getByRole("heading", { level: 1 });
  expect(title.textContent).toBe("Billing #7");
  expect(within(header()).getByText("In progress")).toBeTruthy();
  const summary = within(header()).getByText("All of billing");
  expect(
    title.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(header()).getByRole("progressbar", { name: "1 of 2 done" }),
  ).toBeTruthy();
  expect(within(header()).queryByText("Archived")).toBeNull();
  expect(header().querySelector(".epic-header-saved")?.textContent).toMatch(
    /^Revision 3 · saved by .+/u,
  );
});

test("New ticket goes to a new ticket in the epic, and Edit to the edit page", async () => {
  await epicPageDrawn(abilitiesEvery);
  expect(
    within(header())
      .getByRole("link", { name: "New ticket" })
      .getAttribute("href"),
  ).toBe(
    `/${leadPartition.tenant}/${leadPartition.project}/tickets/new?epic=7`,
  );
  expect(
    within(header()).getByRole("link", { name: "Edit" }).getAttribute("href"),
  ).toBe(`${epicPath}/edit`);
});

test("an archived epic offers no new ticket", async () => {
  epicServing.view = { ...epicView, visibility: "Archived" };
  await epicPageDrawn(abilitiesEvery);
  expect(within(header()).queryByRole("link", { name: "New ticket" })).toBe(
    null,
  );
});

/** The header's ⋯ menu, opened as a keyboard opens it. */
async function menuOpened(): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.keyDown(
      within(header()).getByRole("button", { name: "More actions" }),
      { key: "ArrowDown" },
    );
  });
  return screen.getByRole("menu");
}

test("an archived epic says so beside its title and offers to reactivate it", async () => {
  epicServing.view = { ...epicView, visibility: "Archived" };
  await epicPageDrawn(abilitiesEvery);
  expect(within(header()).getByText("Archived")).toBeTruthy();
  expect(
    within(await menuOpened()).getByRole("menuitem", { name: "Reactivate" }),
  ).toBeTruthy();
});

test("the menu's Archive asks first, then revises the epic archived at the revision read", async () => {
  const { sent } = await epicPageDrawn(abilitiesEvery, {
    written: () => answer({ epic: 7, revision: 4 }),
  });
  fireEvent.click(
    within(await menuOpened()).getByRole("menuitem", { name: "Archive" }),
  );
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

test("a reader who may not write is offered no edit and no archive", async () => {
  await epicPageDrawn(abilitiesNone);
  expect(within(header()).queryByRole("link", { name: "Edit" })).toBeNull();
  const menu = within(header()).queryByRole("button", {
    name: "More actions",
  });
  if (menu === null) return;
  expect(
    within(await menuOpened()).queryByRole("menuitem", { name: "Archive" }),
  ).toBeNull();
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

test("the members' rows are read once, under the epic's filter, a page of the most a page holds", async () => {
  const { sent } = await epicPageDrawn(abilitiesNone, {
    tab: <EpicTicketsTab />,
  });
  const reads = sent
    .filter((request) => request.url.includes("/projects/atlas?"))
    .map((request) => new URL(request.url, "http://x").searchParams);
  expect(reads).toHaveLength(1);
  expect(reads[0]?.get("epic")).toBe("7");
  expect(reads[0]?.get("limit")).toBe(String(nativeHttpPageItemsMax));
});

test("a member past the first page of the project's tickets has its row", async () => {
  epicServing.unfiltered = Array.from(
    { length: nativeHttpPageItemsMax },
    (_, at) => epicRow(100 + at, "Pending"),
  );
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesNone, { tab: <EpicTicketsTab /> });
  const rows = within(screen.getByRole("list", { name: "Tickets" }))
    .getAllByRole("listitem")
    .map((row) => row.textContent);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toContain("Row 5");
});

test("a draft member, which has no row, is drawn by its title and the graph's word for it", async () => {
  epicServing.view = { ...epicView, tickets: [4, 5, 6] };
  epicServing.graph = {
    ...epicGraph,
    nodes: [...epicGraph.nodes, { ticket: 6, title: "Ledger", member: true }],
  };
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesNone, { tab: <EpicTicketsTab /> });
  const draft = within(screen.getByRole("list", { name: "Tickets" }))
    .getAllByRole("listitem")
    .at(-1);
  expect(draft?.textContent).toContain("Ledger");
  expect(draft?.textContent).toContain("Draft");
});

test("the Tickets tab of an epic holding none says so", async () => {
  epicServing.view = { ...epicView, tickets: [] };
  await epicPageDrawn(abilitiesNone, { tab: <EpicTicketsTab /> });
  expect(screen.getByText("This epic holds no tickets")).toBeTruthy();
});

function historyRows(): string[] {
  return screen
    .getAllByRole("list", { name: "Revisions" })
    .flatMap((list) =>
      [...list.querySelectorAll<HTMLElement>(":scope > li")].map(
        (item) => item.textContent ?? "",
      ),
    );
}

test("the History tab draws the revisions newest first, and an older page on asking", async () => {
  epicServing.history = epicHistoryPaged.first;
  epicServing.older = epicHistoryPaged.older;
  const { sent } = await epicPageDrawn(abilitiesNone, {
    tab: <EpicHistoryTab />,
  });
  expect(historyRows()).toHaveLength(2);
  expect(historyRows()[0]).toMatch(/^Revision 3Edited title/u);
  expect(historyRows()[1]).toMatch(/^Revision 2Edited title/u);
  fireEvent.click(screen.getByRole("button", { name: "Show older" }));
  await settled();
  expect(sent.some((request) => request.url.includes("after=2"))).toBe(true);
  expect(historyRows().at(-1)).toMatch(/^Revision 1Created/u);
});

const historyIssuer = "https://issuer.example/";

function historyPrincipal(subject: string): string {
  return `${String(historyIssuer.length)}:${historyIssuer}${subject}`;
}

function historyRevision(
  revision: number,
  changes: {
    readonly fields?: readonly string[];
    readonly added?: readonly number[];
  },
  subject = "dana",
): unknown {
  return {
    revision,
    changedAt: new Date(
      Date.parse("2026-10-01T02:41:00Z") + revision * 60_000,
    ).toISOString(),
    actor: { kind: "user", subject: historyPrincipal(subject) },
    title: "Billing",
    visibility: "Active",
    changes: {
      kind: "Revised",
      fields: changes.fields ?? [],
      added: changes.added ?? [],
      removed: [],
    },
  };
}

test("a revision's actor, in a row and in the header, is drawn by the email the project's people name, and otherwise by the subject shortened", async () => {
  epicServing.people = [
    {
      subject: "dana",
      mine: false,
      tenantAdmin: false,
      roles: ["Developer"],
      account: true,
      email: "dana@example.com",
    },
  ];
  epicServing.history = {
    revisions: [
      historyRevision(3, { fields: ["title"] }),
      historyRevision(2, { added: [9] }, "x".repeat(40)),
    ],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicHistoryTab /> });
  expect(historyRows()[0]).toContain("dana@example.com");
  expect(historyRows()[1]).toContain(`${"x".repeat(12)}…${"x".repeat(6)}`);
  expect(header().querySelector(".epic-header-saved")?.textContent).toMatch(
    /^Revision 3 · saved by dana@example\.com/u,
  );
});

test("a burst of one actor's ticket edits folds into one row, and Show each lists every revision in it", async () => {
  epicServing.history = {
    revisions: [
      historyRevision(4, { added: [434] }),
      historyRevision(3, { added: [433] }),
      historyRevision(2, { added: [432] }),
    ],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicHistoryTab /> });
  expect(historyRows()).toHaveLength(1);
  expect(historyRows()[0]).toMatch(
    /^Revisions 2–4Added #432–#434.* · 3 revisionsShow each/u,
  );
  expect(screen.queryByText("Revision 3 · Added #433")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show each" }));
  expect(
    screen
      .getAllByText(/^Revision \d · Added #43\d$/u)
      .map((line) => line.textContent),
  ).toStrictEqual([
    "Revision 4 · Added #434",
    "Revision 3 · Added #433",
    "Revision 2 · Added #432",
  ]);
});

test("a title edit inside a run breaks it into three rows", async () => {
  epicServing.history = {
    revisions: [
      historyRevision(4, { added: [434] }),
      historyRevision(3, { fields: ["title"], added: [433] }),
      historyRevision(2, { added: [432] }),
    ],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicHistoryTab /> });
  expect(historyRows()).toHaveLength(3);
  expect(
    [...document.querySelectorAll(".epic-history-said")].map(
      (said) => said.textContent,
    ),
  ).toStrictEqual(["Added #434", "Added #433 · Edited title", "Added #432"]);
  expect(screen.queryByRole("button", { name: "Show each" })).toBeNull();
});

test("two actors' runs do not fold together", async () => {
  epicServing.history = {
    revisions: [
      historyRevision(5, { added: [5] }, "eve"),
      historyRevision(4, { added: [4] }, "eve"),
      historyRevision(3, { added: [3] }),
      historyRevision(2, { added: [2] }),
    ],
  };
  await epicPageDrawn(abilitiesNone, { tab: <EpicHistoryTab /> });
  expect(historyRows()).toHaveLength(2);
  expect(historyRows()[0]).toMatch(/^Revisions 4–5Added #4–#5eve · 2/u);
  expect(historyRows()[1]).toMatch(/^Revisions 2–3Added #2–#3dana · 2/u);
});

test("a ready member's dispatch control cannot be pressed while the tab is offline", async () => {
  epicServing.rows = [epicRow(4, "Done"), epicRow(5, "Pending")];
  await epicPageDrawn(abilitiesEvery, { tab: <EpicGraphTab /> });
  const dispatch = await screen.findByRole("button", {
    name: "Dispatch ticket #5",
  });
  expect(dispatch.hasAttribute("disabled")).toBe(false);
  act(() => {
    onlineManager.setOnline(false);
  });
  expect(dispatch.hasAttribute("disabled")).toBe(true);
});
