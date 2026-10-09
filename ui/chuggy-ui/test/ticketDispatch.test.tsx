// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadBody } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesNone,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import {
  ticketDispatchViewOf,
  ticketPageCandidate,
  ticketPageRoutes,
} from "./ticketPageFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a dispatchable ticket submits the version from the strict view", async () => {
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Succeeded",
      decidedSequence: 8,
    },
    route: ticketPageRoutes(atlas, () =>
      ticketDispatchViewOf(atlas, [ticketPageCandidate]),
    ),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();

  await turned(() => {
    screen.getByRole("button", { name: "Dispatch" }).click();
  });

  expect(api.submitted()).toMatchObject({
    mutation: {
      mutation: "ManualDispatch",
      ticket: 11,
      expectedTicketVersion: 4,
    },
  });
});

/** The page over a server whose lead route answers `lead`, with the ticket a
 * dispatch candidate or not as `candidate` says, and the abilities read
 * answering as the page's other reads do unless `over` answers it. */
async function drawnWithLead(
  lead: unknown,
  candidate = true,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<void> {
  const routes = ticketPageRoutes(atlas, () =>
    ticketDispatchViewOf(atlas, candidate ? [ticketPageCandidate] : []),
  );
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => (url.endsWith("/lead") ? answer(lead) : routes(url)),
  });
  vi.stubGlobal("fetch", over(api.fetch));
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
}

/** No lead dispatches the project, so the press beside the line is how the
 * ticket runs, and the page says so where the press is. */
test("Dispatch in a project with no lead says tickets are dispatched by hand", async () => {
  await drawnWithLead({ lead: "None" });
  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
  expect(screen.getByText("No lead · Dispatched by hand")).toBeDefined();
});

test("Dispatch in a project with a lead says nothing of the hand", async () => {
  await drawnWithLead(leadBody(1, 1));
  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
  expect(screen.queryByText("No lead · Dispatched by hand")).toBeNull();
});

test("a ticket offered no Dispatch says nothing of the hand, lead or none", async () => {
  await drawnWithLead({ lead: "None" }, false);
  expect(screen.queryByRole("button", { name: "Dispatch" })).toBeNull();
  expect(screen.queryByText("No lead · Dispatched by hand")).toBeNull();
});

function dispatchOffered(): boolean {
  return screen.queryByRole("button", { name: "Dispatch" }) !== null;
}

test("a reader who may not dispatch is offered no Dispatch and is told nothing of the hand", async () => {
  await drawnWithLead(
    { lead: "None" },
    true,
    abilitiesOver({ ...abilitiesEvery, dispatch: false }),
  );
  expect(dispatchOffered()).toBe(false);
  expect(screen.queryByText("No lead · Dispatched by hand")).toBeNull();
  expect(screen.getByText("Edit")).toBeDefined();
});

test("a reader who may dispatch and not mutate is offered Dispatch alone", async () => {
  await drawnWithLead(
    { lead: "None" },
    true,
    abilitiesOver({ ...abilitiesNone, dispatch: true }),
  );
  expect(dispatchOffered()).toBe(true);
  expect(screen.queryByText("Edit")).toBeNull();
  expect(screen.queryByText("Duplicate")).toBeNull();
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Dispatch",
  async (_said, abilities) => {
    await drawnWithLead({ lead: "None" }, true, abilitiesOver(abilities));
    expect(dispatchOffered()).toBe(true);
    expect(screen.getByText("Edit")).toBeDefined();
  },
);
