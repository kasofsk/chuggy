/**
 * A ready row's Dispatch on the Tickets screen, drawn from what the row
 * holds: the version it expects is the row's own sequence, so a screen of
 * ready rows reads nothing per row and registers no list per row. A press
 * asks the ticket page's question, and only its confirm sends.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { onlineManager, QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import { ticketDispatchList } from "../app/core/ticketQueries.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { dispatchAskTitle } from "./ticketDispatchPressed.ts";
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

/** A ready ticket whose own row last moved at `sequence`. */
function ready(ticket: number, sequence: number): unknown {
  return {
    ticket,
    title: `Ready ${String(ticket)}`,
    phase: "Pending",
    sequence,
    ...ticketInstants,
    openDependencies: [],
    revokedDependencies: [],
  };
}

/** More ready rows than the project's list registrations may number. */
const readyRowsCount = 40;

/** The Tickets screen over these tickets, every request it sends recorded,
 * and each dispatch decided as `decided` says. */
async function drawnReady(
  tickets: readonly unknown[],
  decided: object = { state: "Succeeded", decidedSequence: 900 },
): Promise<{
  readonly urls: readonly string[];
  readonly client: QueryClient;
  readonly submitted: () => unknown;
  readonly submissions: () => number;
}> {
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      ...decided,
    },
    route: (url) =>
      url.includes("/executions")
        ? answer({ executions: [] })
        : answer({ partition: atlas, sequence: 900, tickets }),
  });
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    urls.push(url);
    return api.fetch(url, init);
  });
  const client = new QueryClient();
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <ProjectTable query={{}} onQuery={() => undefined} />
    </ScreenHarness>,
  );
  await settled();
  return {
    urls,
    client,
    submitted: api.submitted,
    submissions: api.submissions,
  };
}

/** The question a row's chip asked, once its chip is pressed. */
async function rowAsked(ticket: number): Promise<HTMLElement> {
  await turned(() => {
    screen
      .getByRole("button", { name: `Dispatch ticket #${String(ticket)}` })
      .click();
  });
  return screen.getByRole("dialog", { name: dispatchAskTitle(ticket) });
}

/** A row's chip pressed and the question it asked confirmed. */
async function rowConfirmed(ticket: number): Promise<void> {
  const asked = await rowAsked(ticket);
  await turned(() => {
    within(asked).getByRole("button", { name: "Dispatch" }).click();
  });
  await settled();
}

test("a screen of ready rows draws each one, reading and registering nothing per row", async () => {
  const tickets = Array.from({ length: readyRowsCount }, (_, at) =>
    ready(at + 1, at + 100),
  );
  const drawn = await drawnReady(tickets);
  expect(
    screen.getAllByRole("button", { name: /^Dispatch ticket #/u }),
  ).toHaveLength(readyRowsCount);
  expect(drawn.urls.filter((url) => url.includes("/dispatch-view"))).toEqual(
    [],
  );
  expect(
    drawn.client
      .getQueryCache()
      .find({ queryKey: ticketDispatchList(atlas, 1).key, exact: true }),
  ).toBeUndefined();
});

test("a row's Dispatch expects the version the row was drawn at", async () => {
  const drawn = await drawnReady([ready(24, 57), ready(25, 61)]);
  await rowConfirmed(25);
  expect(drawn.submitted()).toMatchObject({
    mutation: {
      mutation: "ManualDispatch",
      ticket: 25,
      expectedTicketVersion: 61,
    },
  });
});

test("a row's Dispatch refused because the ticket moved says so beside the row", async () => {
  await drawnReady([ready(24, 57)], {
    state: "Refused",
    code: "TicketChanged",
    refusedHead: 58,
    refusedLifecycleGeneration: 1,
  });
  await rowConfirmed(24);
  const row = screen.getByText("Ready 24").closest("li");
  expect(row).not.toBeNull();
  if (row === null) return;
  expect(
    within(row).getByText("Dispatch refused · Ticket changed"),
  ).toBeDefined();
  expect(
    within(row).getByRole("button", { name: "Dispatch ticket #24" }),
  ).toBeDefined();
});

test("a row's chip asks the ticket page's question and sends nothing until it is confirmed", async () => {
  const drawn = await drawnReady([ready(24, 57)]);
  const asked = await rowAsked(24);
  await settled();
  expect(
    within(asked).getByText("Dispatches the observed version"),
  ).toBeDefined();
  expect(within(asked).getByRole("button", { name: "Cancel" })).toBeDefined();
  expect(drawn.submissions()).toBe(0);
});

test("a row's question cancelled, or escaped, sends nothing and leaves the row ready", async () => {
  const drawn = await drawnReady([ready(24, 57)]);
  const asked = await rowAsked(24);
  await turned(() => {
    within(asked).getByRole("button", { name: "Cancel" }).click();
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  await rowAsked(24);
  await turned(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
  });
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(drawn.submissions()).toBe(0);
  expect(
    screen.getByRole("button", { name: "Dispatch ticket #24" }).textContent,
  ).toBe("Ready");
});

test("a row's question confirmed sends the dispatch once", async () => {
  const drawn = await drawnReady([ready(24, 57)]);
  await rowConfirmed(24);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(drawn.submissions()).toBe(1);
  expect(drawn.submitted()).toMatchObject({
    mutation: { mutation: "ManualDispatch", ticket: 24 },
  });
});

test("a row's question offers no confirm while this tab is offline", async () => {
  const drawn = await drawnReady([ready(24, 57)]);
  const asked = await rowAsked(24);
  const confirm = within(asked).getByRole("button", { name: "Dispatch" });
  expect(confirm.hasAttribute("disabled")).toBe(false);
  act(() => {
    onlineManager.setOnline(false);
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  act(() => {
    onlineManager.setOnline(true);
  });
  expect(drawn.submissions()).toBe(0);
});
