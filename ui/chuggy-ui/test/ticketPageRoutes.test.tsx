/**
 * A ticket's page as addresses: one layout drawing the header and the tabs,
 * and under it the tab its address names. Each tab is a link the router marks
 * current, switching tabs reads nothing again, and the edit screen is its own
 * page without the tabs.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
import { runAttempt, runSummary } from "./runPageFixture.tsx";
import { answer } from "./screenHarness.tsx";
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

test("the Runs tab of a ticket nothing has run for says so", async () => {
  await mountedAt(`${ticketPath}/runs`);
  expect(tabCurrent()).toMatch(/^Runs/u);
  expect(screen.getByText("Nothing has run")).toBeDefined();
});

/** The site's answers with the ticket's one run on them: its summary in the
 * page and its own read, a work run that passed. */
function runServed(): void {
  const summary = runSummary({ ticket: Number(ticket), task: 1 });
  const answered = site.apiFetch;
  (site as { apiFetch: typeof site.apiFetch }).apiFetch = (url, init) => {
    const path = new URL(url, "http://console.test").pathname;
    if (path.endsWith("/executions/e1"))
      return Promise.resolve(
        answer({ ...summary, attempts: [runAttempt("a1")] }),
      );
    if (path.endsWith("/executions"))
      return Promise.resolve(answer({ executions: [summary] }));
    return answered(url, init);
  };
}

/** The sub-tabs a run's page offers, by their words and their addresses. */
function runViews(): readonly (readonly (string | null)[])[] {
  return within(screen.getByRole("navigation", { name: "Run" }))
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

function runViewCurrent(): string | null | undefined {
  return within(screen.getByRole("navigation", { name: "Run" }))
    .getAllByRole("link")
    .find((link) => link.getAttribute("aria-current") === "page")?.textContent;
}

test("every row of the Runs tab is a link to its run's page, and the landing's to the landing", async () => {
  runServed();
  await mountedAt(`${ticketPath}/runs`);
  const rows =
    document.querySelectorAll<HTMLAnchorElement>("a.ticket-runs-row");
  expect([...rows].map((row) => row.getAttribute("href"))).toStrictEqual([
    `${ticketPath}/runs/1`,
    `${ticketPath}/landing`,
  ]);
  expect(rows[1]?.textContent).toContain("Not reached");
});

test("a run's address draws its page under the Runs tab, the rail marking it, on Summary", async () => {
  runServed();
  await mountedAt(`${ticketPath}/runs/1`);
  expect(tabCurrent()).toMatch(/^Runs/u);
  expect(screen.getByRole("heading", { level: 2, name: "Work" })).toBeDefined();
  const rail = screen.getByRole("navigation", { name: "Runs" });
  expect(
    within(rail)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.getAttribute("href")),
  ).toStrictEqual([`${ticketPath}/runs/1`]);
  expect(runViews()).toStrictEqual([
    ["Summary", `${ticketPath}/runs/1?view=Summary`],
    ["Transcript", `${ticketPath}/runs/1?view=Transcript`],
    ["Details", `${ticketPath}/runs/1?view=Details`],
  ]);
  expect(runViewCurrent()).toBe("Summary");
  expect(
    screen.getByRole("link", { name: "All runs" }).getAttribute("href"),
  ).toBe(`${ticketPath}/runs`);
});

test("a run's sub-tab is its own address", async () => {
  runServed();
  await mountedAt(`${ticketPath}/runs/1?view=Details`);
  expect(runViewCurrent()).toBe("Details");
  expect(screen.getByText("Execution", { selector: "dt" })).toBeDefined();
  consoleSiteClean(site);
});

test("a run's address naming no run the ticket holds draws an empty tab, not a failed page", async () => {
  runServed();
  for (const task of ["7", "seven"]) {
    await mountedAt(`${ticketPath}/runs/${task}`);
    expect(tabCurrent()).toMatch(/^Runs/u);
    expect(screen.getByText("No such run")).toBeDefined();
    expect(screen.queryByText("Page failed")).toBeNull();
    cleanup();
  }
});

test("the landing's address draws under the Runs tab, and says when the ticket has none yet", async () => {
  runServed();
  await mountedAt(`${ticketPath}/landing`);
  expect(tabCurrent()).toMatch(/^Runs/u);
  expect(screen.getByText("No landing")).toBeDefined();
  const rail = screen.getByRole("navigation", { name: "Runs" });
  expect(
    within(rail)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.getAttribute("href")),
  ).toStrictEqual([`${ticketPath}/landing`]);
});

/** The site's answers with its landings read answered by `landings`. */
function landingsServed(landings: () => Promise<Response>): void {
  const answered = site.apiFetch;
  (site as { apiFetch: typeof site.apiFetch }).apiFetch = (url, init) =>
    new URL(url, "http://console.test").pathname.endsWith("/landings")
      ? landings()
      : answered(url, init);
}

test("the landing's address says its read has not answered rather than that the ticket has no landing", async () => {
  landingsServed(() => new Promise(() => undefined));
  await mountedAt(`${ticketPath}/landing`);
  expect(screen.getByText("Loading…")).toBeDefined();
  expect(screen.queryByText("No landing")).toBeNull();
});

test("the landing's address says its read failed rather than that the ticket has no landing", async () => {
  landingsServed(() =>
    Promise.resolve(
      answer({ error: { code: "NotFound", message: "Not found." } }, 404),
    ),
  );
  await mountedAt(`${ticketPath}/landing`);
  expect(document.querySelector(".read-failed")).not.toBeNull();
  expect(screen.queryByText("No landing")).toBeNull();
});
