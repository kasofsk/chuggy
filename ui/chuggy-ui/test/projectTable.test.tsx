/**
 * The project table: that a ticket is drawn under the heading its state puts
 * it in, that "up next" says which of its tickets could start now, and that a
 * filter narrows the page to one section without asking the API again.
 *
 * THE READ IS COUNTED, BECAUSE THAT IS THE CLAIM THE SCREEN MAKES. One body
 * answers the whole project, so a filter is a view of what is held; a filter
 * that went back to the wire would draw exactly the same rows and nothing
 * about the page would look wrong.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { AdoptedTicket } from "../../../src/contract/adoptedTickets.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import { leadPartition } from "./leadFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ticketOf(
  ticket: number,
  state: AdoptedTicket["state"],
  dependencies: readonly number[] = [],
): AdoptedTicket {
  return {
    ticket,
    revision: 1,
    workCyclesStarted: 0,
    state,
    dependencies: [...dependencies],
  };
}

const project: readonly AdoptedTicket[] = [
  ticketOf(1, "Done"),
  ticketOf(2, "Work"),
  ticketOf(3, "Escalated"),
  ticketOf(4, "Pending", [2]),
  ticketOf(5, "Pending", [1]),
  ticketOf(6, "Revoked"),
];

interface Drawn {
  readonly reads: () => number;
}

async function drawn(
  tickets: readonly AdoptedTicket[] = project,
): Promise<Drawn> {
  let reads = 0;
  const fetching = ((url: string) => {
    if (url.includes("/tickets")) reads += 1;
    return Promise.resolve(answer({ tickets }));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <ProjectTable />
    </ScreenHarness>,
  );
  await settled();
  return { reads: () => reads };
}

/** The table under one heading, found by the caption the section draws it
 * with, so a row is asserted against the section it is actually in. */
function sectionTable(title: string): HTMLElement {
  const caption = screen.getByText(title, { selector: "caption" });
  const table = caption.closest("table");
  if (table === null) throw new Error(`no table captioned ${title}`);
  return table;
}

function bodyRows(title: string): readonly HTMLTableRowElement[] {
  return within(sectionTable(title))
    .getAllByRole("row")
    .slice(1) as HTMLTableRowElement[];
}

function rowsOf(title: string): readonly string[] {
  return bodyRows(title).map((row) => row.cells[0]?.textContent ?? "");
}

test("a ticket is drawn under the heading its state puts it in", async () => {
  await drawn();

  expect(rowsOf("needs you")).toEqual(["#3"]);
  expect(rowsOf("in progress")).toEqual(["#2"]);
  expect(rowsOf("done")).toEqual(["#1"]);
  expect(rowsOf("failed or revoked")).toEqual(["#6"]);
});

test("up next draws what could start now first and says how many", async () => {
  await drawn();

  expect(rowsOf("up next")).toEqual(["#5", "#4"]);
  const waiting = bodyRows("up next");
  expect(waiting[0]?.textContent).toContain("ready");
  expect(waiting[1]?.textContent).toContain("#2");
  expect(screen.getByText("1 of 2 waiting on nothing")).toBeDefined();
});

test("choosing a section narrows the page without asking the API again", async () => {
  const held = await drawn();
  const before = held.reads();

  fireEvent.click(screen.getByRole("button", { name: "needs you" }));

  expect(rowsOf("needs you")).toEqual(["#3"]);
  expect(screen.queryByRole("heading", { name: "in progress" })).toBeNull();
  expect(held.reads()).toBe(before);
});

test("a section with no ticket in it says so rather than looking healthy", async () => {
  await drawn([ticketOf(1, "Done")]);

  expect(screen.getAllByText("no ticket is here").length).toBeGreaterThan(0);
  expect(rowsOf("done")).toEqual(["#1"]);
});
