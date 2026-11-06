/**
 * The ticket list's filter as the console's own routes hold it: the address
 * names it, a link to it draws it whatever this browser kept, and going back
 * to the list draws it again.
 */

import { fireEvent, screen, within } from "@testing-library/react";
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
import { abilitiesEvery } from "./projectAbilitiesFixture.ts";
import { creatorLabel } from "../app/core/labels.ts";
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

function countPressed(standing: RegExp): string | null {
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  return within(counts)
    .getByRole("button", { name: standing })
    .getAttribute("aria-pressed");
}

/** Ready and Blocked are what the wire cannot name, so the address names the
 * standing and the read asks for its phase. The site holds no Pending ticket
 * under a phase, and the count tapped stays drawn so it can be tapped away. */
test("a count tapped is written to the address as the filter, and the read asks for the phase it stands in", async () => {
  const history = createMemoryHistory({ initialEntries: [projectAddress] });
  consoleMounted(projectAddress, consoleSession(), false, history);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(countPressed(/^Ready/u)).toBe("false");
  const tappedAt = site.reads.length;
  fireEvent.click(screen.getByRole("button", { name: /^Ready/u }));
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=Ready");
  expect(filterDrawn()).toContain("Ready");
  expect(countPressed(/^Ready/u)).toBe("true");
  expect(new Set(phasesRead(site.reads.slice(tappedAt)))).toStrictEqual(
    new Set(["Pending"]),
  );
  expect(localStorage.getItem(ticketListFilterStored)).toBe("Ready");
  fireEvent.click(screen.getByRole("button", { name: /^Ready/u }));
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=All");
  expect(filterDrawn()).toContain("All states");
  expect(countPressed(/^Ready/u)).toBe("false");
  consoleSiteClean(site);
});

test("a link naming a pending standing draws it in the picker and its count pressed", async () => {
  consoleMounted(`${projectAddress}?filter=Blocked`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(filterDrawn()).toContain("Blocked");
  expect(countPressed(/^Blocked/u)).toBe("true");
  expect(new Set(phasesRead(site.reads))).toStrictEqual(new Set(["Pending"]));
  consoleSiteClean(site);
});

/** The creators the reads of the project's tickets named. */
function namedCreators(reads: readonly string[]): ReadonlySet<string> {
  return new Set(
    reads
      .map((read) => new URL(read, "http://console.test"))
      .filter((read) =>
        read.pathname.endsWith(`/projects/${consolePartition.project}`),
      )
      .flatMap((read) => read.searchParams.getAll("creator")),
  );
}

function creatorDrawn(): string | null {
  return screen.getByRole("button", { name: /^Creator/u }).textContent;
}

async function creatorChosen(name: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Creator/u }), {
    key: "ArrowDown",
  });
  await consoleAdvanced(ticketListAddressSettleMs);
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
  await consoleAdvanced(ticketListAddressSettleMs);
}

/** The reader's principal names no issuer, so a person's is their subject. */
test("a link naming a creator draws the list under them, by their email", async () => {
  consoleMounted(`${projectAddress}?creator=s-ada`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(creatorDrawn()).toContain("ada@example.com");
  expect(namedCreators(site.reads)).toStrictEqual(new Set(["s-ada"]));
  consoleSiteClean(site);
});

test("a creator chosen is written to the address beside the filter, and Anyone takes it away", async () => {
  const history = createMemoryHistory({
    initialEntries: [`${projectAddress}?filter=Done`],
  });
  consoleMounted(
    `${projectAddress}?filter=Done`,
    consoleSession(),
    false,
    history,
  );
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(creatorDrawn()).toContain("Anyone");
  const chosenAt = site.reads.length;
  await creatorChosen("Me");
  const address = new URLSearchParams(history.location.search);
  expect(address.get("creator")).toBe(abilitiesEvery.principal);
  expect(address.get("filter")).toBe("Done");
  expect(creatorDrawn()).toContain("Me");
  expect(namedCreators(site.reads.slice(chosenAt))).toStrictEqual(
    new Set([abilitiesEvery.principal]),
  );
  await creatorChosen(creatorLabel("s-bob").text);
  expect(new URLSearchParams(history.location.search).get("creator")).toBe(
    "s-bob",
  );
  const clearedAt = site.reads.length;
  await creatorChosen("Anyone");
  expect(history.location.search).toBe("?filter=Done");
  expect(creatorDrawn()).toContain("Anyone");
  expect(site.reads.length).toBeGreaterThan(clearedAt);
  expect(namedCreators(site.reads.slice(clearedAt))).toStrictEqual(new Set());
  consoleSiteClean(site);
});
