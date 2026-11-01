/**
 * The ticket list's pages under a reader's press and a reread at once, a page
 * that could not be read, and the filter the address names.
 *
 * Each case serves the active list a page at a time from a cursor, holding the
 * answer a case needs to land after another, so a list whose press and reread
 * overwrote each other would draw fewer pages than the reader asked for.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import { phaseLabel } from "../app/core/codeLabels.ts";
import { ticketListAskDefault } from "../app/core/projectTableFilters.ts";
import type { TicketListQuery } from "../app/core/ticketListView.ts";
import { ticketRowsQuery } from "../app/core/ticketQueries.ts";
import {
  answer,
  heldAnswer,
  openedStream,
  press,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function held(ticket: number, phase = "Work"): unknown {
  return {
    ticket,
    title: `Ticket ${String(ticket)}`,
    phase,
    sequence: ticket,
    ...ticketInstants,
    openDependencies: [],
    revokedDependencies: [],
  };
}

function served(
  tickets: readonly unknown[],
  over: Readonly<Record<string, unknown>> = {},
): Response {
  return answer({ partition: atlas, sequence: 900, tickets, ...over });
}

/** The active list's first page, and its second behind the cursor the first answers. */
function activePaged(asked: URLSearchParams): Response {
  if (asked.get("active") !== "true") return served([]);
  return asked.get("cursor") === "active-2"
    ? served([held(149)])
    : served([held(150)], { nextCursor: "active-2" });
}

/**
 * The Tickets screen at an address holding `initial` over a project whose
 * reads `answered` decides, every project read recorded and every address
 * written. The cache is handed back, so a case can read the list again as a
 * frame would.
 */
async function drawnAt(
  initial: TicketListQuery,
  answered: (asked: URLSearchParams) => Response | Promise<Response>,
): Promise<{
  readonly client: QueryClient;
  readonly asked: readonly URLSearchParams[];
  readonly written: readonly TicketListQuery[];
}> {
  const asked: URLSearchParams[] = [];
  const written: TicketListQuery[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    const at = new URL(url, "http://stub");
    if (!at.pathname.endsWith("/projects/atlas"))
      return Promise.resolve(
        url.includes("/executions") ? answer({ executions: [] }) : served([]),
      );
    asked.push(at.searchParams);
    return Promise.resolve(answered(at.searchParams));
  });
  function Addressed(): ReactNode {
    const [query, setQuery] = useState(initial);
    const onQuery = useCallback((next: TicketListQuery) => {
      written.push(next);
      setQuery(next);
    }, []);
    return <ProjectTable query={query} onQuery={onQuery} />;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <Addressed />
    </ScreenHarness>,
  );
  await settled();
  return { client, asked, written };
}

function titlesDrawn(): readonly (string | null)[] {
  const list = screen.queryByRole("list", { name: "Tickets" });
  if (list === null) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector("h3")?.textContent ?? null);
}

/** The unfiltered list read again, as a frame that stales it does, and the
 * turns it sets off flushed; a read a case holds is still out after it. */
async function reread(client: QueryClient): Promise<void> {
  act(() => {
    void client.invalidateQueries({
      queryKey: ticketRowsQuery(atlas, ticketListAskDefault).queryKey,
      exact: true,
    });
  });
  await settled();
}

test("Show more pressed while a reread is running ends with both pages", async () => {
  let holding = false;
  const first = heldAnswer();
  const drawn = await drawnAt({}, (asked) =>
    holding && !asked.has("cursor")
      ? first.answered.then(() => activePaged(asked))
      : activePaged(asked),
  );
  holding = true;
  await reread(drawn.client);
  await press("Show more");
  holding = false;
  first.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 149"]);
});

test("a reread arriving while Show more reads its page ends with both pages", async () => {
  let holding = false;
  const second = heldAnswer();
  const drawn = await drawnAt({}, (asked) =>
    holding && asked.get("cursor") === "active-2"
      ? second.answered.then(() => activePaged(asked))
      : activePaged(asked),
  );
  holding = true;
  await press("Show more");
  await reread(drawn.client);
  holding = false;
  second.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 149"]);
});

/** The filter menu's `phase` chosen, as a reader does. */
async function filterChosen(phase: TicketPhase): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Filter/u }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: phaseLabel(phase) }),
  );
  await settled();
}

test("Show more joined to a reread reads no page of a list chosen before it ends", async () => {
  let holding = false;
  const first = heldAnswer();
  const drawn = await drawnAt({}, (asked) => {
    if (asked.getAll("phase").includes("Escalated"))
      return asked.has("cursor")
        ? served([held(11, "Escalated")], { nextCursor: "escalated-3" })
        : served([held(12, "Escalated")], { nextCursor: "escalated-2" });
    return holding && !asked.has("cursor")
      ? first.answered.then(() => activePaged(asked))
      : activePaged(asked);
  });
  holding = true;
  await reread(drawn.client);
  await press("Show more");
  await filterChosen("Escalated");
  holding = false;
  first.release(served([]));
  await settled();
  expect(
    drawn.asked
      .filter((asked) => asked.getAll("phase").includes("Escalated"))
      .map((asked) => asked.get("cursor")),
  ).toStrictEqual([null]);
  expect(titlesDrawn()).toStrictEqual(["Ticket 12"]);
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 12", "Ticket 11"]);
});

test("a reread reads again every page the list holds, and no more", async () => {
  const drawn = await drawnAt({}, activePaged);
  await press("Show more");
  const before = drawn.asked.length;
  await reread(drawn.client);
  expect(
    drawn.asked.slice(before).map((asked) => asked.get("cursor")),
  ).toStrictEqual([null, "active-2"]);
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 149"]);
});

test("a Show more that could not be read keeps the rows, says why, and can be asked again", async () => {
  let refusing = true;
  await drawnAt({}, (asked) =>
    refusing && asked.get("cursor") === "active-2"
      ? answer({ error: "InternalError", message: "boom" }, 500)
      : activePaged(asked),
  );
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 150"]);
  expect(
    screen.getByText(/^a further page could not be read — /u),
  ).toBeDefined();
  refusing = false;
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 149"]);
  expect(screen.queryByText(/^a further page could not be read/u)).toBeNull();
});

/** A frame folds into the entry by writing it, which is no read landing. */
test("a Show more that could not be read is still said once a frame writes into the list", async () => {
  const drawn = await drawnAt({}, (asked) =>
    asked.get("cursor") === "active-2"
      ? answer({ error: "InternalError", message: "boom" }, 500)
      : activePaged(asked),
  );
  await press("Show more");
  act(() => {
    drawn.client.setQueryData(
      ticketRowsQuery(atlas, ticketListAskDefault).queryKey,
      (pages) => (pages === undefined ? pages : { ...pages }),
    );
  });
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150"]);
  expect(
    screen.getByText(/^a further page could not be read — /u),
  ).toBeDefined();
});

/** Every ticket in the phase each read asks for. */
function phased(asked: URLSearchParams): Response {
  const phases = asked.getAll("phase");
  return served(
    [held(11, "Work"), held(12, "Escalated")].filter(
      (one) =>
        phases.length === 0 ||
        phases.includes((one as { readonly phase: string }).phase),
    ),
  );
}

test("a filter the address names is the list drawn, and the one this browser kept is not", async () => {
  localStorage.setItem("chug.ticket-list.filter", "Escalated");
  const drawn = await drawnAt({ filter: "Work" }, phased);
  expect(titlesDrawn()).toStrictEqual(["Ticket 11"]);
  expect(
    new Set(drawn.asked.map((asked) => asked.getAll("phase").join(","))),
  ).toStrictEqual(new Set(["Work"]));
  expect(drawn.written).toStrictEqual([]);
});

test("the filter this browser kept is drawn where the address names none, and writes no address", async () => {
  localStorage.setItem("chug.ticket-list.filter", "Escalated");
  const drawn = await drawnAt({}, phased);
  expect(titlesDrawn()).toStrictEqual(["Ticket 12"]);
  expect(drawn.written).toStrictEqual([]);
});

test("choosing a filter writes it to the address beside the search, and keeps it in this browser", async () => {
  const drawn = await drawnAt({ sort: "Newest" }, phased);
  await filterChosen("Escalated");
  expect(drawn.written).toStrictEqual([
    { sort: "Newest", filter: "Escalated" },
  ]);
  expect(localStorage.getItem("chug.ticket-list.filter")).toBe("Escalated");
  expect(titlesDrawn()).toStrictEqual(["Ticket 12"]);
});
