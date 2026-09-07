/**
 * The project's full thread list: who is offered an `Open`, the Mine/Everyone
 * and Open/Closed/Hidden filter chips, and the row menu shared with the rail
 * (Rename, Close, Hide) with the same ownership gating.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ThreadsPage } from "../app/browser/ThreadsPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { ShellSlotHarness, styleless } from "./shellSlotHarness.tsx";
import {
  threadEntry,
  threadMineSession,
  threadOrphanSession,
  threadOtherSession,
  threadPartition,
  threadsBody,
  threadsBodyWithoutMine,
} from "./threadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

const navigations: unknown[] = [];

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => {
    navigations.push(to);
  },
  useParams: () => ({ ...threadPartition }),
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
  navigations.length = 0;
  vi.unstubAllGlobals();
});

/** A row's menu opens on `ArrowDown` rather than a click: the trigger's own
 * open is a `pointerdown` Radix listens for, which `fireEvent.click` never
 * dispatches in jsdom. */
async function openThreadMenu(trigger: Element): Promise<void> {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("menu");
}

function rowMenuTrigger(row: Element): Element {
  const trigger = row.querySelector('button[aria-label="Thread actions"]');
  if (trigger === null) throw new Error("expected the row's own menu trigger");
  return trigger;
}

/** The open menu's items, in the order the menu draws them. */
function menuItemNames(): readonly string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

/** The listing route answering one body; a POST to `.../close`, `.../rename`
 * or `.../hide` answers the entry the door writes, and any other POST is the
 * open. Every post is recorded by its URL. */
function drawThreads(
  listing: () => unknown,
  opening: () => { readonly body: unknown; readonly status: number } = () => ({
    body: {
      session: threadMineSession,
      state: "Open",
      mine: true,
      turns: 0,
      owner: "geoff",
      openedAt: "2026-09-02T09:00:00Z",
      lastActivityAt: "2026-09-02T10:00:00Z",
      hidden: false,
    },
    status: 201,
  }),
): { readonly posts: () => number; readonly posted: () => readonly string[] } {
  let posts = 0;
  const posted: string[] = [];
  const fetching = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      posts += 1;
      posted.push(url);
      if (url.endsWith("/rename")) {
        const body = JSON.parse(init.body ?? "{}") as { title?: string };
        return Promise.resolve(
          answer(
            threadEntry({
              session: threadMineSession,
              mine: true,
              title: body.title,
            }),
          ),
        );
      }
      if (url.endsWith("/hide")) {
        const body = JSON.parse(init.body ?? "{}") as { hidden?: boolean };
        return Promise.resolve(
          answer(
            threadEntry({
              session: threadMineSession,
              mine: true,
              hidden: body.hidden === true,
            }),
          ),
        );
      }
      const answered = opening();
      return Promise.resolve(answer(answered.body, answered.status));
    }
    if (url.includes("/threads"))
      return Promise.resolve(answer(listing() as object));
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  return { posts: () => posts, posted: () => posted };
}

async function mountThreads(): Promise<void> {
  const server = openedStream();
  render(
    <ScreenHarness
      partition={threadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <ShellSlotHarness>
        <ThreadsPage />
      </ShellSlotHarness>
    </ScreenHarness>,
  );
  await settled();
  styleless();
}

function rowSessions(): readonly string[] {
  return [...document.querySelectorAll("tbody tr td:first-child")].map(
    (cell) => cell.textContent ?? "",
  );
}

test("the bar names the page", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  expect(screen.getByRole("heading", { name: "Threads" })).toBeDefined();
});

/** The default filters are Mine and Open, so a reader's own open threads are
 * what they land on. */
test("with the default filters, only the reader's own open thread is drawn", async () => {
  drawThreads(() => ({
    threads: [
      ...threadsBody().threads,
      threadEntry({
        session: "thread-closed-mine",
        mine: true,
        state: "Closed",
      }),
    ],
  }));
  await mountThreads();
  expect(rowSessions()).toStrictEqual([threadMineSession]);
});

test("the Everyone chip draws every open thread, mine included", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
  await settled();
  styleless();
  expect(rowSessions()).toContain(threadMineSession);
  expect(rowSessions()).toContain(threadOtherSession);
  expect(rowSessions()).toContain(threadOrphanSession);
});

test("the Hidden chip forces Mine regardless of the owner chip", async () => {
  drawThreads(() => ({
    threads: [
      ...threadsBody().threads,
      threadEntry({ session: "thread-hidden-mine", mine: true, hidden: true }),
      threadEntry({
        session: "thread-hidden-other",
        mine: false,
        hidden: true,
      }),
    ],
  }));
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  await settled();
  styleless();
  expect(rowSessions()).toStrictEqual(["thread-hidden-mine"]);
});

test("a member with a thread is offered no Open", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  expect(
    screen.queryByRole("button", { name: "Open" }),
    "a member who already has a thread was offered a second",
  ).toBeNull();
});

test("a member whose only thread is closed is offered Open", async () => {
  drawThreads(() => ({
    threads: [
      ...threadsBodyWithoutMine().threads,
      threadEntry({ session: threadMineSession, mine: true, state: "Closed" }),
    ],
  }));
  await mountThreads();
  expect(screen.getByRole("button", { name: "Open" })).toBeDefined();
});

test("a member with no thread opens one and is taken to it", async () => {
  const server = drawThreads(threadsBodyWithoutMine);
  await mountThreads();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  await settled();
  styleless();
  expect(server.posts()).toBe(1);
  expect(navigations.at(-1)).toStrictEqual({
    to: "/$tenant/$project/threads/$session",
    params: { ...threadPartition, session: threadMineSession },
  });
});

test("an open the server refused says so and navigates nowhere", async () => {
  drawThreads(threadsBodyWithoutMine, () => ({
    body: { error: { code: "Forbidden", message: "no" } },
    status: 403,
  }));
  await mountThreads();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  await settled();
  styleless();
  expect(screen.getByText(/^Refused · /u)).toBeDefined();
  expect(navigations.length, "a refused open navigated anyway").toBe(0);
});

/** The menu is per row: Close is offered where the thread is not already
 * Closed, and Rename and Hide/Show only on the reader's own — the door
 * refuses `NotYourThread` for anyone else's, for both. */
test("a stranger's row offers no Rename or Hide, and the reader's own does", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
  await settled();
  const rows = [...document.querySelectorAll("tbody tr")];
  const mineRow = rows.find((row) =>
    row.textContent?.includes(threadMineSession),
  );
  const otherRow = rows.find((row) =>
    row.textContent?.includes(threadOtherSession),
  );
  if (mineRow === undefined || otherRow === undefined)
    throw new Error("expected both rows to be drawn");
  const mineTrigger = rowMenuTrigger(mineRow);
  await openThreadMenu(mineTrigger);
  expect(menuItemNames()).toStrictEqual(["Rename", "Close", "Hide"]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  await openThreadMenu(rowMenuTrigger(otherRow));
  expect(
    menuItemNames(),
    "a stranger's row offered Rename or Hide, which the door refuses",
  ).toStrictEqual(["Close"]);
  styleless();
});

test("a stranger's closed row draws no menu trigger at all", async () => {
  drawThreads(() => ({
    threads: [
      ...threadsBody().threads,
      threadEntry({ session: "thread-done", state: "Closed" }),
    ],
  }));
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
  fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
  await settled();
  const row = [...document.querySelectorAll("tbody tr")].find((tr) =>
    tr.textContent?.includes("thread-done"),
  );
  if (row === undefined) throw new Error("expected the closed row");
  expect(
    row.querySelector('button[aria-label="Thread actions"]'),
    "a row with no action drew a trigger anyway",
  ).toBeNull();
  styleless();
});

test("closing a row's thread posts to that row's own close door", async () => {
  const server = drawThreads(() => ({
    threads: [
      ...threadsBody().threads,
      threadEntry({ session: "thread-done", state: "Closed", turns: 9 }),
    ],
  }));
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
  await settled();
  const orphanRow = [...document.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes(threadOrphanSession),
  );
  if (orphanRow === undefined) throw new Error("expected the orphaned row");
  await openThreadMenu(rowMenuTrigger(orphanRow));
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }));
  });
  await settled();
  styleless();
  expect(server.posted()).toStrictEqual([
    `/api/v1/tenants/acme/projects/atlas/threads/${threadOrphanSession}/close`,
  ]);
  expect(navigations.length, "a close navigated somewhere").toBe(0);
});

/**
 * The updated title itself is not asserted here: the row still reads the
 * listing's own cache, which only the stream's `Session` frame refreshes —
 * that reread is `shellRail.test.ts` and the panel-list machinery's own
 * territory, not this row's. What is this row's own is the door it posts to
 * and that a successful write closes the editor.
 */
test("renaming a row posts the typed title to that row's own rename door", async () => {
  const server = drawThreads(threadsBody);
  await mountThreads();
  const mineRow = [...document.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes(threadMineSession),
  );
  if (mineRow === undefined) throw new Error("expected the reader's own row");
  await openThreadMenu(rowMenuTrigger(mineRow));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "Thread title" });
  fireEvent.change(input, { target: { value: "ship it" } });
  await turned(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await settled();
  styleless();
  expect(server.posted()).toStrictEqual([
    `/api/v1/tenants/acme/projects/atlas/threads/${threadMineSession}/rename`,
  ]);
  expect(screen.queryByRole("textbox", { name: "Thread title" })).toBeNull();
});

test("Escape cancels a rename in progress and posts nothing", async () => {
  const server = drawThreads(threadsBody);
  await mountThreads();
  const mineRow = [...document.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes(threadMineSession),
  );
  if (mineRow === undefined) throw new Error("expected the reader's own row");
  await openThreadMenu(rowMenuTrigger(mineRow));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox", { name: "Thread title" });
  fireEvent.change(input, { target: { value: "not sent" } });
  fireEvent.keyDown(input, { key: "Escape" });
  await settled();
  styleless();
  expect(
    screen.queryByRole("textbox", { name: "Thread title" }),
    "Escape left the editor open",
  ).toBeNull();
  expect(server.posts(), "Escape posted a rename anyway").toBe(0);
});

test("a hidden row's menu offers Show, and it unhides the thread", async () => {
  const server = drawThreads(() => ({
    threads: [
      ...threadsBody().threads,
      threadEntry({ session: "thread-hidden-mine", mine: true, hidden: true }),
    ],
  }));
  await mountThreads();
  fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));
  await settled();
  const hiddenRow = [...document.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes("thread-hidden-mine"),
  );
  if (hiddenRow === undefined) throw new Error("expected the hidden row");
  await openThreadMenu(rowMenuTrigger(hiddenRow));
  expect(
    screen.queryByRole("menuitem", { name: "Hide" }),
    "a hidden row still offered Hide",
  ).toBeNull();
  await turned(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Show" }));
  });
  await settled();
  styleless();
  expect(server.posted()).toStrictEqual([
    "/api/v1/tenants/acme/projects/atlas/threads/thread-hidden-mine/hide",
  ]);
});

test("a project with no threads says so", async () => {
  drawThreads(() => ({ threads: [] }));
  await mountThreads();
  expect(screen.getByText("No threads")).toBeDefined();
});
