/**
 * The bar's entries under a real router, which is what decides a link is
 * current: the page the router is at, and exactly one entry saying so.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ChatPaneProvider } from "../app/browser/shell/chatPaneHeld.tsx";
import { TopBarNavEntry } from "../app/browser/shell/TopBar.tsx";
import { shellNav } from "../app/core/shellNav.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

afterEach(cleanup);

function Bar(): ReactNode {
  return (
    <ChatPaneProvider twoColumn>
      <nav aria-label="Console">
        <ul>
          {shellNav({ partition: atlas }).map((entry) => (
            <TopBarNavEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      </nav>
      <Outlet />
    </ChatPaneProvider>
  );
}

async function drawnAt(path: string): Promise<readonly string[]> {
  const root = createRootRoute({ component: Outlet });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
    component: Bar,
  });
  const leaf = (at: string) =>
    createRoute({ getParentRoute: () => partition, path: at });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([
      partition.addChildren([
        leaf("/"),
        leaf("/inbox"),
        leaf("/lead"),
        leaf("/selector"),
        leaf("/repositories"),
        leaf("/runners"),
        leaf("/tickets/new"),
        leaf("/tickets/$ticket"),
        leaf("/tickets/$ticket/edit"),
      ]),
    ]),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Console" });
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

test("the Runners page is the one current entry, and Tickets is not beside it", async () => {
  expect(await drawnAt("/acme/atlas/runners")).toStrictEqual(["Runners"]);
});

test("the overview is Tickets alone", async () => {
  expect(await drawnAt("/acme/atlas")).toStrictEqual(["Tickets"]);
});

test("a ticket's page and its edit are Tickets", async () => {
  expect(await drawnAt("/acme/atlas/tickets/7")).toStrictEqual(["Tickets"]);
  cleanup();
  expect(await drawnAt("/acme/atlas/tickets/7/edit")).toStrictEqual([
    "Tickets",
  ]);
});

test("a new ticket is New ticket and not Tickets", async () => {
  expect(await drawnAt("/acme/atlas/tickets/new")).toStrictEqual([
    "New ticket",
  ]);
});
