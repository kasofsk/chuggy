/**
 * An epic's page as addresses: one layout drawing the header and the tabs,
 * and under it the tab its address names. Each tab is a link the router marks
 * current, and switching tabs reads nothing again.
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
const epicPageSettleMs = 1_000;

const epic = consoleRouteParameters["epic"] ?? "";

const epicPath = `/${consolePartition.tenant}/${consolePartition.project}/epics/${epic}`;

function tabs(): HTMLElement {
  return screen.getByRole("navigation", { name: "Epic" });
}

/** The tab the router marks as the page the reader is on. */
function tabCurrent(): string {
  return within(tabs())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent ?? "")
    .join();
}

async function mountedAt(path: string): Promise<void> {
  consoleMounted(path);
  await consoleAdvanced(epicPageSettleMs);
}

test("the epic's address draws the header, marks Overview current, and draws the graph", async () => {
  await mountedAt(epicPath);
  expect(tabCurrent()).toBe("Overview");
  expect(document.querySelector("header.ticket-header")).not.toBeNull();
  expect(
    screen.getByRole("region", {
      name: "Tickets of the epic and what they wait on",
    }),
  ).toBeDefined();
  consoleSiteClean(site);
});

test("the Tickets address marks Tickets current and draws the members as ticket-list rows", async () => {
  await mountedAt(`${epicPath}/tickets`);
  expect(tabCurrent()).toMatch(/^Tickets/u);
  expect(document.querySelector("header.ticket-header")).not.toBeNull();
  expect(screen.getByRole("list", { name: "Tickets" })).toBeDefined();
  consoleSiteClean(site);
});

test("the History address marks History current and draws the revisions", async () => {
  await mountedAt(`${epicPath}/history`);
  expect(tabCurrent()).toBe("History");
  expect(screen.getByRole("list", { name: "Revisions" })).toBeDefined();
  expect(
    screen.queryByRole("region", {
      name: "Tickets of the epic and what they wait on",
    }),
  ).toBeNull();
  consoleSiteClean(site);
});

test("switching tabs reads nothing the page has already read", async () => {
  await mountedAt(epicPath);
  site.reads.length = 0;
  fireEvent.click(within(tabs()).getByRole("link", { name: /^Tickets/u }));
  await consoleAdvanced(epicPageSettleMs);
  expect(tabCurrent()).toMatch(/^Tickets/u);
  fireEvent.click(within(tabs()).getByRole("link", { name: "History" }));
  await consoleAdvanced(epicPageSettleMs);
  expect(tabCurrent()).toBe("History");
  const projectPath = `/tenants/${consolePartition.tenant}/projects/${consolePartition.project}`;
  expect(
    site.reads.filter(
      (read) =>
        read.includes("/epics/") ||
        read.includes(`${projectPath}?`) ||
        read.endsWith("/people"),
    ),
  ).toStrictEqual([]);
});
