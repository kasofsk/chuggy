/**
 * A ready row's Dispatch on the Tickets screen, drawn from what the row
 * holds: the version it expects is the row's own sequence, so a screen of
 * ready rows reads nothing per row and registers no list per row.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import { ticketDispatchList } from "../app/core/ticketActions.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
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
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <ProjectTable query={{}} onQuery={() => undefined} />
    </ScreenHarness>,
  );
  await settled();
  return { urls, client, submitted: api.submitted };
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
  await turned(() => {
    screen.getByRole("button", { name: "Dispatch ticket #25" }).click();
  });
  await settled();
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
  await turned(() => {
    screen.getByRole("button", { name: "Dispatch ticket #24" }).click();
  });
  await settled();
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
