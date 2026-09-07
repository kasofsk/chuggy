/**
 * The rail under the real router: `Link` concatenates `className` with
 * `activeProps`/`inactiveProps`, and a mocked router cannot see the result.
 * `New thread` is an action, so only a real router can be seen arriving at
 * the session it opened.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

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
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** What Radix's dropdown reaches for that jsdom does not implement on its
 * own, the way `picker.test.tsx` primes it for the same primitive. */
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A row's menu opens on `ArrowDown` rather than a click: the trigger's own
 * open is a `pointerdown` Radix listens for, which `fireEvent.click` never
 * dispatches in jsdom. */
async function openThreadMenu(name = "Thread actions"): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
}

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
  styleless();
  return router;
}

function projectsOnly(): typeof fetch {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: () => answer({ projects: [atlas] }),
  });
  return api.fetch;
}

const mineOpen = {
  session: "thread-mine",
  owner: "geoff",
  state: "Open",
  mine: true,
  turns: 1,
  openedAt: "2026-09-02T09:00:00Z",
  lastActivityAt: "2026-09-02T10:00:00Z",
  hidden: false,
};

interface ThreadRailApiOpts {
  readonly listing?: readonly unknown[];
  readonly openedSession?: string;
  readonly refuseOpen?: boolean;
  readonly answering?: boolean;
}

/** Every POST the rail's own writes can make: opening, closing, renaming and
 * hiding the reader's thread. Split from the GET arm below only to keep
 * `threadRailApi` itself under the suite's line cap. */
function threadRailApiPost(
  url: string,
  init: { readonly body?: string },
  opts: ThreadRailApiOpts,
): Response {
  if (url.endsWith("/close"))
    return answer({ ...mineOpen, state: "Closed", hidden: false });
  if (url.endsWith("/rename")) {
    const body = JSON.parse(init.body ?? "{}") as { title?: string };
    return answer({ ...mineOpen, title: body.title });
  }
  if (url.endsWith("/hide")) {
    const body = JSON.parse(init.body ?? "{}") as { hidden?: boolean };
    return answer({ ...mineOpen, hidden: body.hidden === true });
  }
  if (opts.refuseOpen === true)
    return answer({ error: { code: "Conflict" } }, 409);
  return answer(
    {
      session: opts.openedSession ?? "s-new",
      owner: "geoff",
      state: "Open",
      mine: true,
      turns: 0,
      openedAt: "2026-09-02T09:00:00Z",
      lastActivityAt: "2026-09-02T10:00:00Z",
      hidden: false,
    },
    201,
  );
}

/**
 * `/threads` answers the listing a case wants; a POST to it opens a thread; a
 * POST to `.../close`, `.../rename` or `.../hide` answers the entry the way
 * those doors do (a count of turns, not the turns themselves); a GET to
 * `.../threads/:session` (none of those) answers the single thread's own
 * shape, turns and all, which is what `useThreadAnswering` reads. Every other
 * route is the switcher's own project list.
 */
function threadRailApi(opts: ThreadRailApiOpts = {}): {
  readonly fetch: typeof fetch;
  readonly posted: () => readonly string[];
} {
  const posted: string[] = [];
  const fetching = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      posted.push(url);
      return Promise.resolve(threadRailApiPost(url, init, opts));
    }
    if (url.endsWith("/threads"))
      return Promise.resolve(answer({ threads: opts.listing ?? [] }));
    if (url.includes("/threads/"))
      return Promise.resolve(
        answer({
          ...mineOpen,
          turns: [
            {
              turn: "thread-turn-1",
              ordinal: 1,
              inputKind: "UserMessage",
              state: opts.answering === true ? "Queued" : "Answered",
              input: "hello",
            },
          ],
          streams: [],
        }),
      );
    return Promise.resolve(answer({ projects: [atlas] }));
  };
  return {
    fetch: fetching as unknown as typeof fetch,
    posted: () => posted,
  };
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

test("with no thread of the reader's own, New thread opens one and follows it", async () => {
  const api = threadRailApi({ openedSession: "s-new" });
  vi.stubGlobal("fetch", api.fetch);
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
  const button = screen.getByRole("button", { name: "New thread" });
  await turned(() => {
    button.click();
  });
  await settled();
  styleless();
  expect(router.state.location.pathname).toBe("/acme/atlas/threads/s-new");
});

test("with an open thread of the reader's own, New thread closes it before opening another", async () => {
  const api = threadRailApi({ listing: [mineOpen], openedSession: "s-new" });
  vi.stubGlobal("fetch", api.fetch);
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
  const button = screen.getByRole("button", { name: "New thread" });
  await turned(() => {
    button.click();
  });
  await settled();
  styleless();
  expect(router.state.location.pathname).toBe("/acme/atlas/threads/s-new");
  expect(
    api.posted().some((url) => url.endsWith(`${mineOpen.session}/close`)),
  ).toBe(true);
});

test("while the open thread is answering, New thread is disabled and says so", async () => {
  const api = threadRailApi({ listing: [mineOpen], answering: true });
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
  const button = await screen.findByRole("button", { name: "Answering" });
  expect(button.hasAttribute("disabled")).toBe(true);
  styleless();
});

test("a titled thread of the reader's own draws its title, with no Yours tag", async () => {
  const titled = {
    ...mineOpen,
    session: "thread-titled",
    title: "why is 42 blocked",
  };
  const api = threadRailApi({ listing: [titled] });
  await mounted(api.fetch);
  expect(screen.getByText("why is 42 blocked")).toBeDefined();
  expect(screen.queryByText("Yours")).toBeNull();
});

test("an untitled thread of the reader's own reads New thread", async () => {
  const api = threadRailApi({ listing: [{ ...mineOpen, title: undefined }] });
  await mounted(api.fetch);
  expect(screen.getAllByText("New thread").length).toBeGreaterThan(0);
});

test("a refusal to open draws under New thread and the button re-enables", async () => {
  const api = threadRailApi({ refuseOpen: true });
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
  const button = screen.getByRole("button", { name: "New thread" });
  await turned(() => {
    button.click();
  });
  await settled();
  styleless();
  const button2 = screen.getByRole("button", { name: "New thread" });
  expect(button2.getAttribute("aria-busy")).toBe("false");
  expect(button2.hasAttribute("disabled")).toBe(false);
  expect(screen.getByText(/Refused/)).toBeDefined();
});

test("the row menu on an open thread offers Rename, Close and Hide, and opens no style element", async () => {
  const api = threadRailApi({
    listing: [{ ...mineOpen, title: "ship it" }],
  });
  await mounted(api.fetch);
  await openThreadMenu();
  styleless();
  expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDefined();
  expect(screen.getByRole("menuitem", { name: "Close" })).toBeDefined();
  expect(screen.getByRole("menuitem", { name: "Hide" })).toBeDefined();
});

test("renaming a thread posts the typed title and returns to the label", async () => {
  const api = threadRailApi({
    listing: [{ ...mineOpen, title: "ship it" }],
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
  await openThreadMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "Thread title" });
  fireEvent.change(input, { target: { value: "renamed" } });
  await turned(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await settled();
  styleless();
  expect(
    api.posted().some((url) => url.endsWith(`${mineOpen.session}/rename`)),
  ).toBe(true);
  expect(screen.queryByRole("textbox", { name: "Thread title" })).toBeNull();
});
