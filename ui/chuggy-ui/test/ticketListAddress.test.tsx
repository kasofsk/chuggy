/**
 * The ticket list's filters as the console's own routes hold them: the
 * address names each, a link to it draws it in the Filter panel and as a mark
 * under the bar whatever this browser kept, and going back to the list draws
 * it again.
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

/** The Filter panel, opened from the bar where it is not open already. */
async function filterPanel(): Promise<HTMLElement> {
  const open = screen.queryByRole("dialog", { name: "Filter" });
  if (open !== null) return open;
  fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
  await consoleAdvanced(ticketListAddressSettleMs);
  return screen.getByRole("dialog", { name: "Filter" });
}

/** What one of the panel's filters holds, by its label. */
async function filterDrawn(label = "State"): Promise<string | null> {
  const panel = await filterPanel();
  const select = within(panel).getByRole<HTMLSelectElement>("combobox", {
    name: label,
  });
  return select.selectedOptions[0]?.textContent ?? null;
}

/** One of the panel's filters set to the choice it names. */
async function filterChosen(label: string, name: string): Promise<void> {
  const panel = await filterPanel();
  const select = within(panel).getByRole("combobox", { name: label });
  fireEvent.change(select, {
    target: {
      value: within(select).getByRole<HTMLOptionElement>("option", { name })
        .value,
    },
  });
  await consoleAdvanced(ticketListAddressSettleMs);
}

/** The marks under the bar, by what each says. */
function marksDrawn(): readonly (string | null)[] {
  const marks = screen.queryByRole("list", { name: "Filters on" });
  return [...(marks?.querySelectorAll(".chip-label") ?? [])].map(
    (mark) => mark.textContent,
  );
}

test("a link naming a filter draws the list under it, whatever this browser kept", async () => {
  localStorage.setItem(ticketListFilterStored, "Done");
  consoleMounted(`${projectAddress}?filter=Escalated`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(await filterDrawn()).toBe("Escalated");
  expect(marksDrawn()).toStrictEqual(["State: Escalated"]);
  expect(new Set(phasesRead(site.reads))).toStrictEqual(new Set(["Escalated"]));
  consoleSiteClean(site);
});

test("going back to the list draws the filter it was left under, whatever this browser kept since", async () => {
  const history = createMemoryHistory({ initialEntries: [projectAddress] });
  consoleMounted(projectAddress, consoleSession(), false, history);
  await consoleAdvanced(ticketListAddressSettleMs);
  await filterChosen("State", "Done");
  expect(history.location.search).toBe("?filter=Done");
  history.push(`${projectAddress}/inbox`);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(screen.queryByRole("button", { name: /^Filter/u })).toBeNull();
  localStorage.setItem(ticketListFilterStored, "Escalated");
  const backAt = site.reads.length;
  history.back();
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=Done");
  expect(await filterDrawn()).toBe("Done");
  expect(
    phasesRead(site.reads.slice(backAt)).filter((phases) => phases !== "Done"),
  ).toStrictEqual([]);
  consoleSiteClean(site);
});

/** Ready and Blocked are what the wire cannot name, so the address names the
 * standing and the read asks for its phase. */
test("a standing chosen in the panel is written to the address as the filter and drawn as a mark, which removed writes All", async () => {
  const history = createMemoryHistory({ initialEntries: [projectAddress] });
  consoleMounted(projectAddress, consoleSession(), false, history);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(marksDrawn()).toStrictEqual([]);
  const chosenAt = site.reads.length;
  await filterChosen("State", "Ready");
  expect(history.location.search).toBe("?filter=Ready");
  expect(marksDrawn()).toStrictEqual(["State: Ready"]);
  expect(new Set(phasesRead(site.reads.slice(chosenAt)))).toStrictEqual(
    new Set(["Pending"]),
  );
  expect(localStorage.getItem(ticketListFilterStored)).toBe("Ready");
  fireEvent.click(screen.getByRole("button", { name: "Remove State: Ready" }));
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(history.location.search).toBe("?filter=All");
  expect(marksDrawn()).toStrictEqual([]);
  expect(await filterDrawn()).toBe("All states");
  consoleSiteClean(site);
});

test("a link naming a pending standing draws it in the panel and as its mark", async () => {
  consoleMounted(`${projectAddress}?filter=Blocked`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(marksDrawn()).toStrictEqual(["State: Blocked"]);
  expect(await filterDrawn()).toBe("Blocked");
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

function creatorDrawn(): Promise<string | null> {
  return filterDrawn("Creator");
}

function creatorChosen(name: string): Promise<void> {
  return filterChosen("Creator", name);
}

/** The reader's principal names no issuer, so a person's is their subject. */
test("a link naming a creator draws the list under them, by their email", async () => {
  consoleMounted(`${projectAddress}?creator=s-ada`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(await creatorDrawn()).toContain("ada@example.com");
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
  expect(await creatorDrawn()).toContain("Anyone");
  const chosenAt = site.reads.length;
  await creatorChosen("Me");
  const address = new URLSearchParams(history.location.search);
  expect(address.get("creator")).toBe(abilitiesEvery.principal);
  expect(address.get("filter")).toBe("Done");
  expect(await creatorDrawn()).toContain("Me");
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
  expect(await creatorDrawn()).toContain("Anyone");
  expect(site.reads.length).toBeGreaterThan(clearedAt);
  expect(namedCreators(site.reads.slice(clearedAt))).toStrictEqual(new Set());
  consoleSiteClean(site);
});

/** The owners the reads of the project's tickets named. */
function namedOwners(reads: readonly string[]): ReadonlySet<string> {
  return new Set(
    reads
      .map((read) => new URL(read, "http://console.test"))
      .filter((read) =>
        read.pathname.endsWith(`/projects/${consolePartition.project}`),
      )
      .flatMap((read) => read.searchParams.getAll("owner")),
  );
}

function ownerDrawn(): Promise<string | null> {
  return filterDrawn("Owner");
}

function ownerChosen(name: string): Promise<void> {
  return filterChosen("Owner", name);
}

test("a link naming an owner draws the list under them, by their email, and names no creator", async () => {
  consoleMounted(`${projectAddress}?owner=s-ada`, consoleSession(), false);
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(await ownerDrawn()).toContain("ada@example.com");
  expect(await creatorDrawn()).toContain("Anyone");
  expect(namedOwners(site.reads)).toStrictEqual(new Set(["s-ada"]));
  expect(namedCreators(site.reads)).toStrictEqual(new Set());
  consoleSiteClean(site);
});

test("an owner chosen is written to the address beside the creator, and Anyone takes it away", async () => {
  const history = createMemoryHistory({
    initialEntries: [`${projectAddress}?creator=s-bob`],
  });
  consoleMounted(
    `${projectAddress}?creator=s-bob`,
    consoleSession(),
    false,
    history,
  );
  await consoleAdvanced(ticketListAddressSettleMs);
  expect(await ownerDrawn()).toContain("Anyone");
  const chosenAt = site.reads.length;
  await ownerChosen("Me");
  const address = new URLSearchParams(history.location.search);
  expect(address.get("owner")).toBe(abilitiesEvery.principal);
  expect(address.get("creator")).toBe("s-bob");
  expect(await ownerDrawn()).toContain("Me");
  expect(namedOwners(site.reads.slice(chosenAt))).toStrictEqual(
    new Set([abilitiesEvery.principal]),
  );
  const clearedAt = site.reads.length;
  await ownerChosen("Anyone");
  expect(history.location.search).toBe("?creator=s-bob");
  expect(await ownerDrawn()).toContain("Anyone");
  expect(site.reads.length).toBeGreaterThan(clearedAt);
  expect(namedOwners(site.reads.slice(clearedAt))).toStrictEqual(new Set());
  consoleSiteClean(site);
});
