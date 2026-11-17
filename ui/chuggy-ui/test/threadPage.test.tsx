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
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Shell } from "../app/browser/Shell.tsx";
import { ThreadPage } from "../app/browser/ThreadPage.tsx";
import { chatPaneStoreKey } from "../app/core/chatPane.ts";
import { abilitiesEvery, abilitiesOver } from "./projectAbilitiesFixture.ts";
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
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import type { ViewportFrame } from "./viewport.ts";
import { readFailedLines } from "./readFailedLines.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { contextSessionBody } from "./contextFixture.ts";
import { chatPaneHistoryChosen, chatPaneMenuChosen } from "./chatPaneMenu.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.fontSize = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  return answer({
    projects: [{ ...threadPartition, name: threadPartition.project }],
  });
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

async function mountedAt(
  path: string,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
  frame?: ViewportFrame,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): Promise<ReturnType<typeof routerAt>> {
  viewportAtEm(viewportDeskEm, frame);
  vi.stubGlobal(
    "fetch",
    over(((url: string) =>
      Promise.resolve(threadsServed(url))) as typeof fetch),
  );
  const router = routerAt(path);
  renderCopied(
    <ScreenHarness
      partition={threadPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <RouterProvider router={router} />
    </ScreenHarness>,
  );
  await settled();
  return router;
}

/** The names of what the thread's menu offers, its menu opened. */
async function threadMenuOffers(): Promise<readonly string[]> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat menu" }), {
    key: "ArrowDown",
  });
  return within(await screen.findByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

function threadPath(session: string): string {
  return `/${threadPartition.tenant}/${threadPartition.project}/threads/${session}`;
}

/** The one line drawn in the composer's place, and where its way forward,
 * Back to the project, links. */
function threadPageUnavailableSaid(): {
  readonly line: string | undefined;
  readonly forward: string | null;
} {
  const forward = screen.getByRole("link", { name: "Back to atlas" });
  return {
    line: forward.parentElement?.querySelector("span")?.textContent,
    forward: forward.getAttribute("href"),
  };
}

/** The page's own head, which the bar standing in for it once it has
 * scrolled away is not. */
function threadPageHead(): HTMLElement {
  const head = document.querySelector<HTMLElement>("header.page-header");
  if (head === null) throw new Error("the page draws no head");
  return head;
}

function chatDrawn(): HTMLElement | null {
  return screen.queryByRole("complementary", { name: "Chat" });
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
  expect(screen.getByText("question-1")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
  expect(await threadMenuOffers()).toStrictEqual([
    "Copy link",
    "Rename",
    "Close",
  ]);
  styleless();
});

test("a thread's page heads itself with its title as its one heading, its project linked under it, and Context beside the Chat menu", async () => {
  await mountedAt(threadPath(threadMineSession));
  const head = threadPageHead();
  expect(
    screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
  ).toStrictEqual(["mine"]);
  const project = within(head).getByRole("link", { name: "In atlas" });
  expect(project.closest(".page-header-meta")).not.toBeNull();
  expect(project.getAttribute("href")).toBe(
    `/${threadPartition.tenant}/${threadPartition.project}`,
  );
  expect(
    within(head)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent),
  ).toStrictEqual(["Context", "Chat menu"]);
  expect(screen.getAllByRole("log")).toHaveLength(1);
});

test("a thread kept running says so beside its standing, with how to end it, and one that is not says nothing of it", async () => {
  await mountedAt(threadPath(threadMineSession));
  expect(screen.queryByText("Kept running")).toBeNull();
  cleanup();
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      (async (url: string, init?: RequestInit) => {
        const read = await served(url, init);
        if (!url.endsWith(`/threads/${threadMineSession}`)) return read;
        return answer({ ...(await read.json()), jobsStanding: true });
      }) as typeof fetch,
  );
  const kept = screen.getByText("Kept running");
  expect(
    within(threadPageHead()).getByText("Open").closest(".page-header-status"),
  ).not.toBeNull();
  fireEvent.focus(kept.closest("[tabindex]") ?? kept);
  expect(
    (await screen.findAllByText(/Close it, or ask it to stop them/u)).length,
  ).toBeGreaterThan(0);
});

test("a thread its owner's chat host holds says so beside its standing, with what it may do there, and one no chat host holds says nothing of it", async () => {
  await mountedAt(threadPath(threadMineSession));
  expect(screen.queryByText("On your chat host")).toBeNull();
  cleanup();
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      (async (url: string, init?: RequestInit) => {
        const read = await served(url, init);
        if (!url.endsWith(`/threads/${threadMineSession}`)) return read;
        return answer({
          ...(await read.json()),
          chatHostCapabilities: ["RepositoryRead", "RunCommands"],
        });
      }) as typeof fetch,
  );
  const hosted = screen.getByText("On your chat host");
  fireEvent.focus(hosted.closest("[tabindex]") ?? hosted);
  expect(
    (
      await screen.findAllByText(
        "On your chat host, this chat may: Read the repository, Run commands",
      )
    ).length,
  ).toBeGreaterThan(0);
});

test("the bar's Context opens the thread's context beside its conversation, and its close takes it away", async () => {
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      ((url: string, init?: RequestInit) =>
        url.includes("/context")
          ? Promise.resolve(
              answer(contextSessionBody([{ ordinal: 1, total: 125_280 }])),
            )
          : served(url, init)) as typeof fetch,
  );
  expect(screen.queryByRole("complementary", { name: "Context" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Context" }));
  await settled();
  const panel = screen.getByRole("complementary", { name: "Context" });
  expect(panel.closest(".context-beside")).not.toBeNull();
  expect(screen.getByRole("region", { name: "Conversation" })).toBeDefined();
  const window = within(panel).getByRole("region", { name: "Window" });
  expect(within(window).getByText("125,280")).toBeDefined();
  expect(within(window).getByText("Turn 1")).toBeDefined();
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("complementary", { name: "Context" })).toBeNull();
});

test("a thread that cannot be read draws the read's own line, and no pane", async () => {
  await mountedAt(threadPath(missingSession));
  expect(readFailedLines()).toStrictEqual(["Not found"]);
  expect(screen.queryByRole("region", { name: "Conversation" })).toBeNull();
  expect(chatDrawn()).toBeNull();
  styleless();
});

/** A read of the thread in the background that fails leaves the composer
 * holding what the reader was writing. */
test("the composer keeps what was typed through a read of the thread that fails", async () => {
  const failing = { on: false };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let reads = 0;
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      ((url: string) => {
        if (!url.endsWith(`/threads/${threadMineSession}`)) return served(url);
        reads += 1;
        return failing.on
          ? Promise.resolve(answer({ error: { code: "InternalError" } }, 500))
          : served(url);
      }) as typeof fetch,
    undefined,
    client,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "written before the read failed" },
  });
  failing.on = true;
  const before = reads;
  await turned(() => void client.invalidateQueries());
  await settled();
  expect(reads).toBeGreaterThan(before);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" }).value,
  ).toBe("written before the read failed");
});

/** Whose thread it is, is the server's `mine`: another member's is read with
 * no composer, and only what anyone may do to it is offered. */
test("another member's thread is read without a composer", async () => {
  await mountedAt(threadPath(threadOtherSession));
  expect(
    screen.getByRole("heading", { level: 1, name: "theirs" }),
  ).toBeDefined();
  expect(screen.getByText("question-1")).toBeDefined();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(chatDrawn()).toBeNull();
  expect(threadPageUnavailableSaid()).toStrictEqual({
    line: "Not your chat · View only",
    forward: `/${threadPartition.tenant}/${threadPartition.project}`,
  });
  expect(await threadMenuOffers()).toStrictEqual(["Copy link", "Close"]);
  styleless();
});

test("a thread that takes no more messages says its standing in the composer's place, with the way back to its project", async () => {
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      (async (url: string, init?: RequestInit) => {
        const read = await served(url, init);
        if (!url.endsWith(`/threads/${threadMineSession}`)) return read;
        return answer({ ...(await read.json()), state: "Closed" });
      }) as typeof fetch,
  );
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(threadPageUnavailableSaid()).toStrictEqual({
    line: "Closed · Takes no more messages",
    forward: `/${threadPartition.tenant}/${threadPartition.project}`,
  });
  styleless();
});

/** A project thread waits on the reader's own runner, which is replaced on
 * their Personal runners page whether it is absent or offline. */
test("a thread whose runner is offline says so in the composer's place, with the way to Personal runners", async () => {
  await mountedAt(
    threadPath(threadMineSession),
    (served) =>
      ((url: string, init?: RequestInit) =>
        url.endsWith("/session-placement")
          ? Promise.resolve(
              answer(sessionPlacementBody({ thread: "Pool", mine: "Offline" })),
            )
          : served(url, init)) as typeof fetch,
  );
  expect(screen.getByText("Chat host offline")).toBeDefined();
  expect(
    screen.getByRole("link", { name: "Personal runners" }).getAttribute("href"),
  ).toBe(
    `/${threadPartition.tenant}/${threadPartition.project}/settings/workspace/runner`,
  );
  styleless();
});

test("a reader who may not mutate is offered only the link on a thread's page", async () => {
  await mountedAt(
    threadPath(threadMineSession),
    abilitiesOver({ ...abilitiesEvery, mutate: false }),
  );
  expect(screen.getByRole("heading", { level: 1, name: "mine" })).toBeDefined();
  expect(await threadMenuOffers()).toStrictEqual(["Copy link"]);
  styleless();
});

/** A thread's own page draws the pages alone, so the pane leaving it is drawn
 * into a frame already laid out, and is drawn as it was stored. */
test("a pane left collapsed is still the strip on the way back from a thread's own page", async () => {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Collapsed" }),
  );
  const router = await mountedAt(threadPath(threadOtherSession), undefined, {});
  expect(screen.queryByRole("separator")).toBeNull();
  await turned(() => {
    router.history.push(
      `/${threadPartition.tenant}/${threadPartition.project}`,
    );
  });
  await settled();
  expect(screen.getByText("the tickets")).toBeDefined();
  expect(chatDrawn()).toBeNull();
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeDefined();
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Collapsed");
  styleless();
});

/** Open is a real anchor the router follows, and going back draws the pane
 * holding the thread the reader picked before they left. */
test("Open goes to the thread's page, and back draws the pane holding what it held", async () => {
  const router = await mountedAt(
    `/${threadPartition.tenant}/${threadPartition.project}`,
  );
  expect(paneHolds()).toBe("mine");
  await chatPaneHistoryChosen(/^theirs,/);
  expect(paneHolds()).toBe("theirs");
  await chatPaneMenuChosen("Open");
  expect(router.state.location.pathname).toBe(threadPath(threadOtherSession));
  expect(chatDrawn()).toBeNull();
  expect(
    screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
  ).toStrictEqual(["theirs"]);
  await turned(() => {
    router.history.back();
  });
  await settled();
  expect(screen.getByText("the tickets")).toBeDefined();
  expect(paneHolds()).toBe("theirs");
  styleless();
});
