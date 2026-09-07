/**
 * The rail's active entry, under the real router: `Link` concatenates
 * `className` with `activeProps`/`inactiveProps`, and a mocked `Link` cannot
 * see the result. This case renders the real one.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Rail } from "../app/browser/shell/Rail.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function railRouter(): ReturnType<typeof createRouter> {
  const rootRoute = createRootRoute({ component: Outlet });
  const partitionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$tenant/$project",
    component: Outlet,
  });
  const leaf = (path: string) =>
    createRoute({
      getParentRoute: () => partitionRoute,
      path,
      component: () => null,
    });
  const overviewRoute = createRoute({
    getParentRoute: () => partitionRoute,
    path: "/",
    component: () => <Rail partition={atlas} />,
  });
  const routeTree = rootRoute.addChildren([
    partitionRoute.addChildren([
      overviewRoute,
      leaf("/inbox"),
      leaf("/lead"),
      leaf("/threads"),
      leaf("/threads/$session"),
      leaf("/selector"),
      leaf("/tickets/new"),
    ]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/acme/atlas"] }),
  });
}

async function mounted(): Promise<void> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <RouterProvider router={railRouter()} />
    </ScreenHarness>,
  );
  await settled();
}

test("the active rail entry's ink is not shared with a resting one", async () => {
  await mounted();
  const active = screen.getByRole("link", { name: "Overview" });
  expect(active.className.split(" ")).not.toContain("text-ink-2");
  expect(active.className.split(" ")).toContain("text-ink-1");
  const resting = screen.getByRole("link", { name: "Inbox" });
  expect(resting.className.split(" ")).toContain("text-ink-2");
  expect(resting.className.split(" ")).not.toContain("text-ink-1");
});
