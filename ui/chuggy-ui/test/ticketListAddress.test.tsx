/**
 * The ticket list's filter as the console's own routes hold it: the address
 * names it, a link to it draws it whatever this browser kept, and going back
 * to the list draws it again.
 */

import { fireEvent, screen } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { expect, test, vi } from "vitest";

import {
  consoleAdvanced,
  consoleMounted,
  consolePartition,
  consoleSession,
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

/** How long a screen is given to read what it reads and draw it. */
const ticketListAddressSettleMs = 1_000;

const projectAddress = `/${consolePartition.tenant}/${consolePartition.project}`;

const ticketListFilterStored = "chug.ticket-list.filter";

/** The phases each filtered read of the project's tickets asked for, one
 * read to an entry. The chat pane's mentions and a ticket reference read the
 * unfiltered list whatever the Tickets screen is filtered by. */
function phasesRead(reads: readonly string[]): readonly string[] {
  return reads
    .map((read) => new URL(read, "http://console.test"))
    .filter((read) =>
      read.pathname.endsWith(`/projects/${consolePartition.project}`),
    )
    .map((read) => read.searchParams.getAll("phase").join(","))
    .filter((phases) => phases !== "");
}

function filterDrawn(): string | null {
  return screen.getByRole("button", { name: /^Filter/u }).textContent;
}

test("a link naming a filter draws the list under it, whatever this browser kept", async () => {
  localStorage.setItem(ticketListFilterStored, "Done");
  consoleMounted(`${projectAddress}?filter=Escalated`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(filterDrawn()).toContain("Escalated");
  expect(new Set(phasesRead(site.reads))).toStrictEqual(new Set(["Escalated"]));
  consoleSiteClean(site);
});

test("going back to the list draws the filter it was left under, whatever this browser kept since", async () => {
  const history = createMemoryHistory({ initialEntries: [projectAddress] });
  consoleMounted(projectAddress, consoleSession(), false, history);
  await consoleAdvanced(ticketListAddressSettleMs);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Filter/u }), {
    key: "ArrowDown",
  });
  await consoleAdvanced(ticketListAddressSettleMs);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Done" }));
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=Done");
  history.push(`${projectAddress}/inbox`);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(screen.queryByRole("button", { name: /^Filter/u })).toBeNull();
  localStorage.setItem(ticketListFilterStored, "Escalated");
  const backAt = site.reads.length;
  history.back();
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=Done");
  expect(filterDrawn()).toContain("Done");
  expect(
    phasesRead(site.reads.slice(backAt)).filter((phases) => phases !== "Done"),
  ).toStrictEqual([]);
  consoleSiteClean(site);
});
