/**
 * The ticket list asks the server what a search, an order and the active list
 * hold, so what it draws and counts is the project's and not one page's.
 *
 * Each case serves a project whose answer depends on what the read asked for,
 * so a screen that searched, ordered or held back the rows it already had
 * would draw something the server never said.
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
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import {
  ticketListSearchWaitMs,
  type TicketListQuery,
} from "../app/core/ticketListView.ts";
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

/** One ticket the served project holds, titled by its number. */
function held(
  ticket: number,
  phase: string,
  over: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    ticket,
    title: `Ticket ${String(ticket)}`,
    phase,
    sequence: ticket,
    ...ticketInstants,
    openDependencies: [],
    revokedDependencies: [],
    ...over,
  };
}

/** A page of the project read, as the route answers it. */
function served(
  tickets: readonly unknown[],
  over: Readonly<Record<string, unknown>> = {},
): Response {
  return answer({ partition: atlas, sequence: 900, tickets, ...over });
}

/** What a project read asked for, or undefined for a request to any other route. */
type ProjectAsked = URLSearchParams | undefined;

function projectAsked(url: string): ProjectAsked {
  const at = new URL(url, "http://stub");
  return at.pathname.endsWith("/projects/atlas") ? at.searchParams : undefined;
}

/**
 * The Tickets screen at an address holding `initial`, which it writes into as
 * a route would, over a project whose read `answered` decides. Every project
 * read is recorded, and every address written.
 */
async function drawnAt(
  initial: TicketListQuery,
  answered: (asked: URLSearchParams) => Response | Promise<Response>,
): Promise<{
  readonly asked: readonly URLSearchParams[];
  readonly written: readonly TicketListQuery[];
}> {
  const asked: URLSearchParams[] = [];
  const written: TicketListQuery[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    const project = projectAsked(url);
    if (project === undefined)
      return Promise.resolve(
        url.includes("/executions") ? answer({ executions: [] }) : served([]),
      );
    asked.push(project);
    return Promise.resolve(answered(project));
  });
  function Addressed(): ReactNode {
    const [query, setQuery] = useState(initial);
    const onQuery = useCallback((next: TicketListQuery) => {
      written.push(next);
      setQuery(next);
    }, []);
    return <ProjectTable query={query} onQuery={onQuery} />;
  }
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <Addressed />
    </ScreenHarness>,
  );
  await settled();
  return { asked, written };
}

/** The titles the list draws, in the order it draws them. */
function titlesDrawn(): readonly (string | null)[] {
  const list = screen.queryByRole("list", { name: "Tickets" });
  if (list === null) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector("h3")?.textContent ?? null);
}

/** Typing, and the wait the list gives it before asking the server. */
async function typedAndWaited(typed: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Search tickets"), {
    target: { value: typed },
  });
  await act(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, ticketListSearchWaitMs + 50),
      ),
  );
}

const firstHundred = Array.from({ length: 100 }, (_unused, at) =>
  held(at + 1, "Work"),
);

test("a search for a ticket past the first page finds it, counts from the server, and holds the rows until it answers", async () => {
  const searched = heldAnswer();
  const drawn = await drawnAt({}, (asked) =>
    asked.get("q") === "#121"
      ? searched.answered.then(() =>
          served([held(121, "Done")], { matched: 1 }),
        )
      : asked.get("active") === "true"
        ? served(firstHundred, { nextCursor: "active-2" })
        : served([]),
  );
  expect(titlesDrawn()).toHaveLength(100);
  expect(titlesDrawn()).not.toContain("Ticket 121");
  await typedAndWaited("#121");
  expect(drawn.written).toStrictEqual([{ q: "#121" }]);
  expect(titlesDrawn()).toHaveLength(100);
  searched.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 121"]);
  expect(screen.getByRole("status").textContent).toBe("1 matching ticket");
  const read = drawn.asked.at(-1);
  expect(read?.get("q")).toBe("#121");
  expect(read?.has("active")).toBe(false);
});

test("a search's count is the server's, not the rows a page holds", async () => {
  await drawnAt({ q: "gate" }, (asked) =>
    asked.get("q") === "gate"
      ? served([held(4, "Work")], { matched: 230, nextCursor: "gate-2" })
      : served([]),
  );
  expect(screen.getByRole("status").textContent).toBe("230 matching tickets");
});

test("a search the address holds is the one read and typed after a reload", async () => {
  const drawn = await drawnAt({ q: "#121" }, (asked) =>
    asked.get("q") === "#121"
      ? served([held(121, "Done")], { matched: 1 })
      : served(firstHundred),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Search tickets").value).toBe(
    "#121",
  );
  expect(drawn.asked.length).toBeGreaterThan(0);
  expect(new Set(drawn.asked.map((asked) => asked.get("q")))).toStrictEqual(
    new Set(["#121"]),
  );
  expect(titlesDrawn()).toStrictEqual(["Ticket 121"]);
  expect(drawn.written).toStrictEqual([]);
});

test("oldest first starts at the project's oldest ticket, whatever the active list held", async () => {
  const drawn = await drawnAt({}, (asked) => {
    if (asked.get("order") === "Oldest")
      return served([held(1, "Done"), held(2, "Done")], {
        nextCursor: "oldest-2",
      });
    return asked.get("active") === "true"
      ? served([held(150, "Work"), held(149, "Work")])
      : served([]);
  });
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 149"]);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Sort/u }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));
  await settled();
  expect(drawn.written).toStrictEqual([{ sort: "Oldest" }]);
  expect(titlesDrawn()).toStrictEqual(["Ticket 1", "Ticket 2"]);
  expect(drawn.asked.at(-1)?.has("active")).toBe(false);
});

test("a Pending ticket that has not moved in months is drawn without pressing anything", async () => {
  const drawn = await drawnAt({}, (asked) =>
    asked.get("active") === "true"
      ? served([
          held(150, "Work"),
          held(7, "Pending", { changedAt: "2026-01-01T00:00:00Z" }),
        ])
      : served([held(149, "Done")]),
  );
  expect(titlesDrawn()).toContain("Ticket 7");
  expect(drawn.asked[0]?.get("active")).toBe("true");
  expect(drawn.asked[0]?.get("order")).toBe("RecentActivity");
});

function showMores(): number {
  return screen.queryAllByRole("button", { name: /^Show more/u }).length;
}

test("one Show more continues the active list into what finished before it, drawing no row twice", async () => {
  const drawn = await drawnAt({}, (asked) => {
    if (asked.get("active") === "true")
      return served([held(150, "Work"), held(148, "Done")]);
    if (asked.get("cursor") === "finished-2")
      return served([held(100, "Revoked")]);
    return served([held(148, "Done"), held(120, "Done")], {
      nextCursor: "finished-2",
    });
  });
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 148"]);
  expect(showMores()).toBe(1);
  await press("Show more");
  expect(drawn.asked.at(-1)?.getAll("phase")).toStrictEqual([
    "Done",
    "Revoked",
  ]);
  expect(titlesDrawn()).toStrictEqual([
    "Ticket 150",
    "Ticket 148",
    "Ticket 120",
  ]);
  expect(showMores()).toBe(1);
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual([
    "Ticket 150",
    "Ticket 148",
    "Ticket 120",
    "Ticket 100",
  ]);
  expect(showMores()).toBe(0);
});

test("a Show more whose first finished page holds only rows already drawn reads past it to one that adds a row", async () => {
  const drawn = await drawnAt({}, (asked) => {
    if (asked.get("active") === "true")
      return served([held(150, "Work"), held(148, "Done")]);
    if (asked.get("cursor") === "finished-2")
      return served([held(100, "Revoked")]);
    return served([held(148, "Done")], { nextCursor: "finished-2" });
  });
  await press("Show more");
  expect(
    drawn.asked
      .filter((asked) => asked.has("phase"))
      .map((asked) => asked.get("cursor")),
  ).toStrictEqual([null, "finished-2"]);
  expect(titlesDrawn()).toStrictEqual([
    "Ticket 150",
    "Ticket 148",
    "Ticket 100",
  ]);
  expect(showMores()).toBe(0);
});

test("leaving a search that matched nothing keeps the list's controls drawn until the default list answers", async () => {
  const active = heldAnswer();
  const drawn = await drawnAt({ q: "nomatch" }, (asked) => {
    if (asked.get("q") === "nomatch") return served([], { matched: 0 });
    return asked.get("active") === "true"
      ? active.answered.then(() => served([held(150, "Work")]))
      : served([]);
  });
  expect(screen.getByRole("status").textContent).toBe("0 matching tickets");
  await typedAndWaited("");
  expect(drawn.written).toStrictEqual([{}]);
  expect(screen.queryByText("No tickets")).toBeNull();
  expect(screen.getByLabelText("Search tickets")).toBeDefined();
  active.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150"]);
});
