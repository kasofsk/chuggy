/**
 * The rail under the real router: `Link` concatenates `className` with
 * `activeProps`/`inactiveProps`, and a mocked router cannot see the result,
 * and `New thread` is offered as a route only the router's own navigation can
 * be caught taking nowhere.
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
  turned,
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

/** The rail persists across a route change beneath it, drawn once at the
 * partition and not per leaf, so a case can navigate under it and still find
 * it. */
function railRouter(): ReturnType<typeof createRouter> {
  const rootRoute = createRootRoute({ component: Outlet });
  const partitionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$tenant/$project",
    component: () => <Rail partition={atlas} />,
  });
  const leaf = (path: string) =>
    createRoute({
      getParentRoute: () => partitionRoute,
      path,
      component: () => null,
    });
  const routeTree = rootRoute.addChildren([
    partitionRoute.addChildren([
      leaf("/"),
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

async function mounted(
  fetchDouble: typeof fetch,
): Promise<ReturnType<typeof createRouter>> {
  vi.stubGlobal("fetch", fetchDouble);
  const server = openedStream();
  const router = railRouter();
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <RouterProvider router={router} />
    </ScreenHarness>,
  );
  await settled();
  return router;
}

function projectsOnly(): typeof fetch {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  return api.fetch;
}

/** `/threads` answers the listing a case wants; a POST to it answers the
 * open, refused or not. Every other route is the switcher's own project
 * list, which the rail's other reads fail to parse and draw nothing for. */
function threadOpenApi(opts: { readonly refuse?: boolean } = {}): typeof fetch {
  return ((url: string, init?: { readonly method?: string }) => {
    if (init?.method === "POST" && url.endsWith("/threads"))
      return Promise.resolve(
        opts.refuse === true
          ? answer({ error: { code: "Conflict" } }, 409)
          : answer(
              {
                session: "s-new",
                owner: "geoff",
                state: "Open",
                mine: true,
                turns: 0,
              },
              201,
            ),
      );
    if (url.endsWith("/threads"))
      return Promise.resolve(answer({ threads: [] }));
    return Promise.resolve(answer({ projects: [atlas] }));
  }) as unknown as typeof fetch;
}

test("the active rail entry's ink is not shared with a resting one", async () => {
  await mounted(projectsOnly());
  const active = screen.getByRole("link", { name: "Overview" });
  expect(active.className.split(" ")).not.toContain("text-ink-2");
  expect(active.className.split(" ")).toContain("text-ink-1");
  const resting = screen.getByRole("link", { name: "Inbox" });
  expect(resting.className.split(" ")).toContain("text-ink-2");
  expect(resting.className.split(" ")).not.toContain("text-ink-1");
});

test("New thread opens a thread and follows it", async () => {
  const router = await mounted(threadOpenApi());
  const button = screen.getByRole("button", { name: "New thread" });
  await turned(() => {
    button.click();
  });
  await settled();
  expect(router.state.location.pathname).toBe("/acme/atlas/threads/s-new");
});

test("a refusal draws under New thread and the button re-enables", async () => {
  await mounted(threadOpenApi({ refuse: true }));
  const button = screen.getByRole("button", { name: "New thread" });
  await turned(() => {
    button.click();
  });
  await settled();
  const button2 = screen.getByRole("button", { name: "New thread" });
  expect(button2.getAttribute("aria-busy")).toBe("false");
  expect(button2.hasAttribute("disabled")).toBe(false);
  expect(screen.getByText(/Refused/)).toBeDefined();
});
