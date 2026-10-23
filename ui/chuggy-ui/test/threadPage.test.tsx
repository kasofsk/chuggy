/**
 * A thread's own page, mounted at its address under a real router and the
 * real frame: the conversation is the page and no chat pane is drawn beside
 * it, a thread that cannot be read says so, another member's has no composer,
 * and the pane holds what it held after a trip there and back.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Shell } from "../app/browser/Shell.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import { ThreadPage } from "../app/browser/ThreadPage.tsx";
import { chatPaneStoreKey } from "../app/core/chatPane.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadReadsAnswered } from "./threadConversationMount.tsx";
import {
  threadBody,
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
  threadTranscriptPage,
} from "./threadFixture.ts";
import { viewportAtEm } from "./viewport.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(chatPaneStoreKey);
  vi.unstubAllGlobals();
});

const missingSession = "thread-missing";

const listed = [
  threadEntry({
    session: threadMineSession,
    owner: "geoff",
    mine: true,
    title: "mine",
  }),
  threadEntry({ session: threadOtherSession, owner: "ada", title: "theirs" }),
];

/** Each thread read as itself and the missing one refused; the listing, the
 * store and the reads a conversation makes as it mounts; and an empty answer
 * for the frame's own reads. */
function threadsServed(url: string): Response {
  if (url.includes(`/threads/${missingSession}`))
    return answer({ error: { code: "NotFound" } }, 404);
  const ambient = threadReadsAnswered(url, threadTranscriptPage(0).entries);
  if (ambient !== undefined) return ambient;
  const read = listed.find((thread) =>
    url.endsWith(`/threads/${thread.session}`),
  );
  if (read !== undefined)
    return answer({
      ...threadBody({
        session: read.session,
        mine: read.mine,
        owner: read.owner ?? "ada",
      }),
      title: read.title,
    });
  if (url.endsWith("/threads")) return answer({ threads: listed });
  return answer({ projects: [threadPartition] });
}

function ThreadAt(): ReactNode {
  const params = useParams({ strict: false });
  return (
    <ThreadPage partition={threadPartition} session={params.session ?? ""} />
  );
}

/** The partition's frame over two of its pages, the tickets and a thread's
 * own, at `path`. */
function routerAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
    component: () => <Shell partition={threadPartition} />,
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([
      partition.addChildren([
        createRoute({
          getParentRoute: () => partition,
          path: "/",
          component: () => <p>the tickets</p>,
        }),
        createRoute({
          getParentRoute: () => partition,
          path: "/threads/$session",
          component: ThreadAt,
        }),
      ]),
    ]),
  });
}

async function mountedAt(path: string): Promise<ReturnType<typeof routerAt>> {
  viewportAtEm(viewportDeskEm);
  vi.stubGlobal("fetch", (url: string) => Promise.resolve(threadsServed(url)));
  const router = routerAt(path);
  render(
    <ScreenHarness
      partition={threadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RouterProvider router={router} />
    </ScreenHarness>,
  );
  await settled();
  return router;
}

function threadPath(session: string): string {
  return `/${threadPartition.tenant}/${threadPartition.project}/threads/${session}`;
}

function chatDrawn(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Chat" });
}

/** The title the pane's header holds, which is its one second-level heading. */
function paneHolds(): string | undefined {
  return chatDrawn()?.querySelector("header h2")?.textContent ?? undefined;
}

test("a thread's address draws its conversation as the page, with no chat pane and no strip", async () => {
  await mountedAt(threadPath(threadMineSession));
  expect(screen.getByRole("heading", { level: 1, name: "mine" })).toBeDefined();
  expect(chatDrawn()).toBeNull();
  expect(screen.queryByRole("button", { name: "Expand chat" })).toBeNull();
  const conversation = screen.getByRole("region", { name: "Conversation" });
  expect(conversation.closest(".chat-reading")).not.toBeNull();
  expect(screen.getByText("a member's question")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Copy link" })).toBeDefined();
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  styleless();
});

test("a thread that cannot be read draws the read's own line, and no pane", async () => {
  await mountedAt(threadPath(missingSession));
  expect(screen.getByText(/^Not available · /u)).toBeDefined();
  expect(screen.queryByRole("region", { name: "Conversation" })).toBeNull();
  expect(chatDrawn()).toBeNull();
  styleless();
});

/** Whose thread it is, is the server's `mine`: another member's is read with
 * no composer, and only what anyone may do to it is offered. */
test("another member's thread is read without a composer", async () => {
  await mountedAt(threadPath(threadOtherSession));
  expect(
    screen.getByRole("heading", { level: 1, name: "theirs" }),
  ).toBeDefined();
  expect(screen.getByText("a member's question")).toBeDefined();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  expect(chatDrawn()).toBeNull();
  styleless();
});

/** Open is a real anchor the router follows, and going back draws the pane
 * holding the thread the reader picked before they left. */
test("Open goes to the thread's page, and back draws the pane holding what it held", async () => {
  const router = await mountedAt(
    `/${threadPartition.tenant}/${threadPartition.project}`,
  );
  expect(paneHolds()).toBe("mine");
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  const theirs = await screen.findByRole("menuitemradio", { name: /^theirs,/ });
  await turned(() => {
    fireEvent.click(theirs);
  });
  await settled();
  expect(paneHolds()).toBe("theirs");
  await turned(() => {
    fireEvent.click(screen.getByRole("link", { name: "Open" }));
  });
  await settled();
  expect(router.state.location.pathname).toBe(threadPath(threadOtherSession));
  expect(chatDrawn()).toBeNull();
  expect(
    screen.getByRole("heading", { level: 1, name: "theirs" }),
  ).toBeDefined();
  await turned(() => {
    router.history.back();
  });
  await settled();
  expect(screen.getByText("the tickets")).toBeDefined();
  expect(paneHolds()).toBe("theirs");
  styleless();
});
