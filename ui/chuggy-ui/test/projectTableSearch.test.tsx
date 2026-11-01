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
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { readFailedLines } from "./readFailedLines.ts";
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
 * read is recorded, every address written, and the stream is handed back for
 * the frames a case pushes down it.
 */
async function drawnAt(
  initial: TicketListQuery,
  answered: (asked: URLSearchParams) => Response | Promise<Response>,
): Promise<{
  readonly asked: readonly URLSearchParams[];
  readonly written: readonly TicketListQuery[];
  readonly server: ReturnType<typeof openedStream>;
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
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <Addressed />
    </ScreenHarness>,
  );
  await settled();
  return { asked, written, server };
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

test("a further page that could not be read says so in one line, keeping its rows and its Show more", async () => {
  await drawnAt({}, (asked) => {
    if (asked.get("active") === "true") return served([held(150, "Work")]);
    if (asked.get("cursor") === "finished-2")
      return answer({ error: { code: "InternalError", message: "no" } }, 500);
    return served([held(120, "Done")], { nextCursor: "finished-2" });
  });
  await press("Show more");
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 120"]);
  expect(readFailedLines()).toStrictEqual(["More · Not read · Server error"]);
  expect(document.body.textContent).not.toContain("InternalError");
  expect(showMores()).toBe(1);
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

test("an empty active list says so and offers the finished tickets behind one Show more", async () => {
  const drawn = await drawnAt({}, (asked) =>
    asked.get("active") === "true" ? served([]) : served([held(120, "Done")]),
  );
  expect(screen.getByRole("status").textContent).toBe(
    "No active or recently finished tickets.",
  );
  expect(titlesDrawn()).toStrictEqual([]);
  const activeReads = drawn.asked.filter((asked) => asked.has("active"));
  const finishedReads = drawn.asked.filter((asked) => asked.has("phase"));
  expect(finishedReads.length).toBe(activeReads.length);
  expect(showMores()).toBe(1);
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 120"]);
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

/** Which page each read asked for: the active list's, or the finished list's
 * from its start or from a cursor. */
function pagesAsked(asked: readonly URLSearchParams[]): readonly string[] {
  return asked.map((each) =>
    each.has("active") ? "active" : (each.get("cursor") ?? "finished"),
  );
}

/** A ticket's frame, as the stream carries it. */
function ticketFrame(id: string, ticket: unknown): string {
  return frame("Ticket", id, {
    version: 1,
    resource: String((ticket as { readonly ticket: number }).ticket),
    representation: ticket,
  });
}

test("a Show more pressed while the list is read again keeps its page and a frame folded meanwhile, and the read is asked again for the pages held", async () => {
  const rereads = [heldAnswer(), heldAnswer()];
  let holding = false;
  const drawn = await drawnAt({}, (asked) => {
    if (asked.get("active") !== "true") return served([held(120, "Done")]);
    if (!holding) return served([held(150, "Work")]);
    const reread = rereads.shift();
    const answered = served([
      held(151, "Work"),
      held(150, "Work", { title: "Ticket 150, renamed" }),
    ]);
    return reread === undefined
      ? answered
      : reread.answered.then(() => answered);
  });
  const [stale, restarted] = rereads;
  holding = true;
  await turned(() => {
    drawn.server.push(ticketFrame("1", held(151, "Work")));
  });
  await turned(() => {
    drawn.server.push(
      ticketFrame("2", held(150, "Work", { title: "Ticket 150, renamed" })),
    );
  });
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150, renamed"]);
  const pressedAt = drawn.asked.length;
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 150, renamed", "Ticket 120"]);
  stale?.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual(["Ticket 150, renamed", "Ticket 120"]);
  restarted?.release(served([]));
  await settled();
  expect(titlesDrawn()).toStrictEqual([
    "Ticket 151",
    "Ticket 150, renamed",
    "Ticket 120",
  ]);
  expect(pagesAsked(drawn.asked.slice(pressedAt))).toStrictEqual([
    "finished",
    "active",
    "finished",
  ]);
});

test("a Show more pressed while no read of the list is running starts none", async () => {
  const drawn = await drawnAt({}, (asked) =>
    asked.get("active") === "true"
      ? served([held(150, "Work")])
      : served([held(120, "Done")]),
  );
  const pressedAt = drawn.asked.length;
  await press("Show more");
  expect(titlesDrawn()).toStrictEqual(["Ticket 150", "Ticket 120"]);
  expect(pagesAsked(drawn.asked.slice(pressedAt))).toStrictEqual(["finished"]);
});

/** The filter the list is drawn under, as its control names it. */
function filterDrawn(): string | null {
  return screen.getByRole("button", { name: /^Filter/u }).textContent;
}

/** The phases each read asked for, one read to an entry. */
function phasesAsked(asked: readonly URLSearchParams[]): readonly string[] {
  return asked.map((each) => each.getAll("phase").join(","));
}

/** Escalated and Done tickets alike, so a read under either filter draws one. */
function servedByPhase(asked: URLSearchParams): Response {
  const phases = asked.getAll("phase");
  return served(
    [held(4, "Escalated"), held(120, "Done")].filter(
      (one) =>
        phases.length === 0 ||
        phases.includes((one as { readonly phase: string }).phase),
    ),
  );
}

const ticketListFilterStored = "chug.ticket-list.filter";

test("a filter the address names is the list drawn, whatever this browser kept", async () => {
  localStorage.setItem(ticketListFilterStored, "Done");
  const drawn = await drawnAt({ filter: "Escalated" }, servedByPhase);
  expect(titlesDrawn()).toStrictEqual(["Ticket 4"]);
  expect(new Set(phasesAsked(drawn.asked))).toStrictEqual(
    new Set(["Escalated"]),
  );
  expect(filterDrawn()).toContain("Escalated");
  expect(drawn.written).toStrictEqual([]);
});

test("where the address names no filter the kept one is drawn, and one kept by another tab later does not move it", async () => {
  localStorage.setItem(ticketListFilterStored, "Escalated");
  const drawn = await drawnAt({}, servedByPhase);
  expect(titlesDrawn()).toStrictEqual(["Ticket 4"]);
  localStorage.setItem(ticketListFilterStored, "Done");
  fireEvent.keyDown(screen.getByRole("button", { name: /^Sort/u }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));
  await settled();
  expect(drawn.written).toStrictEqual([{ sort: "Oldest" }]);
  expect(titlesDrawn()).toStrictEqual(["Ticket 4"]);
  expect(new Set(phasesAsked(drawn.asked))).toStrictEqual(
    new Set(["Escalated"]),
  );
});

test("a filter chosen is written to the address and kept by this browser", async () => {
  const drawn = await drawnAt({ q: "gate" }, servedByPhase);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Filter/u }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Done" }));
  await settled();
  expect(drawn.written).toStrictEqual([{ q: "gate", filter: "Done" }]);
  expect(localStorage.getItem(ticketListFilterStored)).toBe("Done");
  expect(titlesDrawn()).toStrictEqual(["Ticket 120"]);
});
