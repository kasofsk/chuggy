/**
 * A phone's bar under a real router: an item for each of the model's primary
 * places, in its order, each named by its own word; the page the router is
 * at marked current on exactly one; the inbox's count on the inbox; More
 * holding the rest where the places outnumber the items; and nothing at all
 * wider than a phone.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { InboxEntryResponse } from "../../../src/contract/responses.ts";
import { TopBarPhone } from "../app/browser/shell/TopBar.tsx";
import { viewportNarrowEm } from "../app/browser/shell/viewport.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { shellNav } from "../app/core/shellNav.ts";
import { renderCopied } from "./copied.tsx";
import { inboxAsked, inboxBody, inboxEntry } from "./inboxFixture.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const waiting: InboxEntryResponse = inboxEntry({
  ticket: 11,
  title: "Land the release notes",
  phase: "Escalated",
  sequence: 6,
  ...ticketInstants,
});

interface PhoneDrawing {
  readonly path: string;
  readonly em?: number;
  readonly itemsMax?: number;
  readonly inbox?: readonly InboxEntryResponse[];
}

async function drawnAt(drawing: PhoneDrawing): Promise<void> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) =>
      inboxAsked(url)
        ? answer(inboxBody(drawing.inbox ?? []))
        : answer({ partition: atlas, sequence: 1, tickets: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Bar(): ReactNode {
    return (
      <ScreenHarness
        partition={atlas}
        client={client}
        transport={server.ports.fetch}
      >
        <TopBarPhone
          partition={atlas}
          {...(drawing.itemsMax === undefined
            ? {}
            : { itemsMax: drawing.itemsMax })}
        />
        <Outlet />
      </ScreenHarness>
    );
  }
  const root = createRootRoute({ component: Outlet });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
    component: Bar,
  });
  const leaf = (at: string) =>
    createRoute({ getParentRoute: () => partition, path: at });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [drawing.path] }),
    routeTree: root.addChildren([
      partition.addChildren([
        leaf("/"),
        leaf("/inbox"),
        leaf("/epics"),
        leaf("/tickets/$ticket"),
      ]),
    ]),
  });
  viewportAtEm(drawing.em ?? viewportNarrowEm);
  renderCopied(<RouterProvider router={router} />);
  await settled();
}

function bar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Console" });
}

function currentNames(): readonly string[] {
  return within(bar())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

test("every primary place of the model is an item of the bar, in its order, named by its own word", async () => {
  await drawnAt({ path: "/acme/atlas" });
  const words = shellNav(atlas).map((entry) => copyTextEn(entry.label));
  const items = within(bar()).getAllByRole("link");
  expect(items.map((item) => item.textContent)).toStrictEqual(words);
  expect(
    items.map((item) => item.querySelector(".topbar-phone-label")?.textContent),
  ).toStrictEqual(words);
  expect(within(bar()).queryByRole("button", { name: "More" })).toBeNull();
});

test("the page the router is at is the one item marked current", async () => {
  await drawnAt({ path: "/acme/atlas/epics" });
  expect(currentNames()).toStrictEqual(["Epics"]);
  cleanup();
  await drawnAt({ path: "/acme/atlas/tickets/7" });
  expect(currentNames()).toStrictEqual(["Tickets"]);
});

test("the inbox's item carries what waits in it as a badge, and says the count in its name", async () => {
  await drawnAt({ path: "/acme/atlas", inbox: [waiting] });
  const inbox = within(bar()).getByRole("link", { name: "Inbox, 1 unread" });
  expect(inbox.querySelector(".topbar-inbox-badge")?.textContent).toBe("1");
  expect(inbox.querySelector(".topbar-phone-label")?.textContent).toBe("Inbox");
});

test("places that outnumber the items leave the last item More, which opens the rest and is marked where the reader is on one of them", async () => {
  await drawnAt({ path: "/acme/atlas/inbox", itemsMax: 2 });
  expect(
    within(bar())
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toStrictEqual(["Tickets"]);
  const more = within(bar()).getByRole("button", { name: "More" });
  expect(more.hasAttribute("data-current")).toBe(true);
  fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
  const items = await screen.findAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toStrictEqual([
    "Epics",
    "Inbox",
  ]);
  expect(items.map((item) => item.getAttribute("aria-current"))).toStrictEqual([
    null,
    "page",
  ]);
});

test("wider than a phone the bar is not drawn", async () => {
  await drawnAt({ path: "/acme/atlas", em: viewportDeskEm });
  expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
});
