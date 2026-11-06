/**
 * A ticket's page as addresses: one layout drawing the header and the tabs,
 * and under it the tab its address names. Each tab is a link the router marks
 * current, switching tabs reads nothing again, and the edit screen is its own
 * page without the tabs.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import {
  consoleAdvanced,
  consoleMounted,
  consolePartition,
  consoleRouteParameters,
  consoleSiteClean,
  consoleSiteEachCase,
} from "./consoleSite.tsx";
import type { ConsoleSite } from "./consoleSite.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./consoleNetwork.ts")).consolePortsOver(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

let site: ConsoleSite;

consoleSiteEachCase((made) => {
  site = made;
});

/** How long the page is given to read what it reads and draw it. */
const ticketPageSettleMs = 1_000;

const ticket = consoleRouteParameters["ticket"] ?? "";

const ticketPath = `/${consolePartition.tenant}/${consolePartition.project}/tickets/${ticket}`;

function tabs(): HTMLElement {
  return screen.getByRole("navigation", { name: "Ticket" });
}

/** The tab the router marks as the page the reader is on. */
function tabCurrent(): string | undefined {
  return within(tabs())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent ?? "")
    .join();
}

async function mountedAt(path: string): Promise<void> {
  consoleMounted(path);
  await consoleAdvanced(ticketPageSettleMs);
}

test.each([
  ["", "Overview", "Instructions"],
  ["/runs", "Runs", "Cycles"],
  ["/usage", "Usage", "Activity"],
])(
  "the ticket's address%s draws the header, marks %s current, and draws %s",
  async (tab, current, heading) => {
    await mountedAt(`${ticketPath}${tab}`);
    expect(tabCurrent()).toBe(current);
    expect(document.querySelector("header.ticket-header")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: new RegExp(`^${heading}`, "u") }),
    ).toBeDefined();
    consoleSiteClean(site);
  },
);

test("a ticket naming no configuration says so on its Configuration tab", async () => {
  await mountedAt(`${ticketPath}/configuration`);
  expect(tabCurrent()).toBe("Configuration");
  expect(screen.getByText("No configuration")).toBeDefined();
});

test("each tab draws only its own panels", async () => {
  await mountedAt(`${ticketPath}/runs`);
  expect(screen.queryByRole("region", { name: "Status" })).toBeNull();
  expect(screen.queryByRole("heading", { name: /^Instructions/u })).toBeNull();
  expect(screen.queryByRole("heading", { name: /^Activity/u })).toBeNull();
});

test("the tabs are links to each tab's own address, the same whatever the ticket's state", async () => {
  await mountedAt(ticketPath);
  expect(
    within(tabs())
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toStrictEqual([
    ["Overview", ticketPath],
    ["Runs", `${ticketPath}/runs`],
    ["Configuration", `${ticketPath}/configuration`],
    ["Usage", `${ticketPath}/usage`],
  ]);
});

test("switching tabs reads nothing the page has already read", async () => {
  await mountedAt(ticketPath);
  site.reads.length = 0;
  fireEvent.click(within(tabs()).getByRole("link", { name: /^Runs/u }));
  await consoleAdvanced(ticketPageSettleMs);
  expect(tabCurrent()).toBe("Runs");
  expect(
    site.reads.filter((read) => read.includes(`/tickets/${ticket}`)),
  ).toStrictEqual([]);
  expect(site.reads.filter((read) => read.includes("/executions"))).toEqual([]);
});

test("the edit screen is its own page, without the header or the tabs", async () => {
  await mountedAt(`${ticketPath}/edit`);
  expect(screen.queryByRole("navigation", { name: "Ticket" })).toBeNull();
  expect(document.querySelector("header.ticket-header")).toBeNull();
});
