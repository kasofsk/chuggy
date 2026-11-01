/**
 * A member's own chat, mounted at its address under a real router and its own
 * frame, with no project's stream around it: a thread of it is the page and
 * the history offers the threads projects keep as ways there, a workspace that
 * withholds it says who gives it, a missing chat host is said with where one
 * is registered, and a first message opens a thread the page moves to.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { nativeHttpRoutes } from "../../../src/contract/http.ts";
import { MemberChatPage } from "../app/browser/MemberChatPage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import { memberChatWithheld } from "../app/core/memberChat.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, holderDouble, settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadReadsAnswered } from "./threadConversationMount.tsx";
import {
  threadBody,
  threadEntry,
  threadTranscriptPage,
} from "./threadFixture.ts";
import { readFailedLines } from "./readFailedLines.ts";
import { ConsoleStoreProvided } from "./consoleStoreProvided.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tenant = "acme";
const ownSession = "chat-1";
const openedSession = "chat-2";
const heldSession = "thread-held";

const chatPath = nativeHttpRoutes.chatThreads.replace(":tenant", tenant);

const listed = [
  {
    ...threadEntry({ session: ownSession, mine: true, title: "my own" }),
    scope: "Member" as const,
  },
  {
    ...threadEntry({ session: heldSession, mine: true, title: "held" }),
    scope: "Project" as const,
    project: "atlas",
  },
];

interface ChatServed {
  /** Whether the workspace lets the reader chat outside a project. */
  readonly opens?: boolean;
  /** An abilities read that never answers, or one that fails. */
  readonly abilities?: "Pending" | "Failed";
  /** The reader's chat host, or none registered. */
  readonly host?: { readonly live: boolean } | undefined;
  /** What an open answers. */
  readonly open?: () => Response;
}

/** The chat's doors as the case scripts them, every post recorded. */
function chatServed(served: ChatServed, posts: string[]): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push(url);
    const ambient = threadReadsAnswered(url, threadTranscriptPage(0).entries);
    if (ambient !== undefined) return Promise.resolve(ambient);
    if (url.endsWith("/chat/abilities") && served.abilities === "Pending")
      return new Promise<Response>(() => undefined);
    if (url.endsWith("/chat/abilities") && served.abilities === "Failed")
      return Promise.resolve(answer({ error: { code: "Internal" } }, 500));
    if (url.endsWith("/chat/abilities"))
      return Promise.resolve(
        answer({
          principal: "geoff",
          openUnscopedChat: served.opens ?? true,
          executeHosted: false,
          registerPersonalRunner: false,
          administerTenant: false,
        }),
      );
    if (url.endsWith("/chat-host"))
      return Promise.resolve(
        "host" in served && served.host === undefined
          ? answer({ error: { code: "NotFound" } }, 404)
          : answer({
              id: "host-1",
              registeredAt: "2026-09-02T09:00:00Z",
              live: served.host?.live ?? true,
            }),
      );
    if (url === chatPath && init?.method === "POST")
      return Promise.resolve(
        (
          served.open ??
          (() =>
            answer(threadEntry({ session: openedSession, mine: true }), 201))
        )(),
      );
    if (url === chatPath) return Promise.resolve(answer({ threads: listed }));
    if (url.endsWith("/messages"))
      return Promise.resolve(answer({ turn: "t", ordinal: 1 }, 202));
    for (const session of [ownSession, openedSession])
      if (url.endsWith(`/chat/threads/${session}`))
        return Promise.resolve(
          answer({
            ...threadBody({ session, mine: true, owner: "geoff" }),
            title: session === ownSession ? "my own" : undefined,
          }),
        );
    return Promise.resolve(answer({ projects: [] }));
  }) as typeof fetch;
}

function MemberChatAt(): ReactNode {
  const params = useParams({ strict: false });
  return (
    <MemberChatPage tenant={params.tenant ?? ""} session={params.session} />
  );
}

/** The chat's two addresses, and the pages it links out to. */
function routerAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const at = (route: string, component: () => ReactNode) =>
    createRoute({ getParentRoute: () => root, path: route, component });
  return createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([
      at("/tenants/$tenant/chat", MemberChatAt),
      at("/tenants/$tenant/chat/$session", MemberChatAt),
      at("/tenants/$tenant/settings/runner", () => <p>my runners</p>),
      at("/$tenant/$project/threads/$session", () => <p>a project thread</p>),
    ]),
  });
}

async function mountedAt(
  path: string,
  served: ChatServed = {},
  posts: string[] = [],
): Promise<ReturnType<typeof routerAt>> {
  vi.stubGlobal("fetch", chatServed(served, posts));
  const router = routerAt(path);
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ConsoleStoreProvided>
          <RouterProvider router={router} />
        </ConsoleStoreProvided>
      </QueryClientProvider>
    </SessionProvider>,
  );
  await settled();
  return router;
}

/** What the history offers, its menu opened. */
async function historyOpened(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  return screen.findByRole("menu");
}

async function sent(text: string): Promise<void> {
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: text },
  });
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await settled();
}

test("a thread of the reader's own chat is the page, with its project threads offered as ways there", async () => {
  await mountedAt(`/tenants/${tenant}/chat/${ownSession}`);
  expect(
    screen.getByRole("heading", { level: 1, name: "my own" }),
  ).toBeDefined();
  const conversation = screen.getByRole("region", { name: "Conversation" });
  expect(conversation.closest(".chat-reading")).not.toBeNull();
  expect(screen.getByText("a member's question")).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
  const menu = await historyOpened();
  expect(within(menu).getByText("In projects")).toBeDefined();
  const held = within(menu).getByRole("menuitem", { name: /^atlas · held/u });
  expect(held.getAttribute("href")).toBe(
    `/${tenant}/atlas/threads/${heldSession}`,
  );
  expect(
    within(menu).getByRole("menuitemradio", { name: /^my own/u }),
  ).toBeDefined();
  styleless();
});

test("the project switcher names the chat as the workspace's own, with no project", async () => {
  await mountedAt(`/tenants/${tenant}/chat`);
  expect(
    screen.getByRole("heading", { level: 1, name: "New chat" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: /^Project / }).textContent,
  ).toContain(`${tenant} / No project`);
  styleless();
});

test("a reader whose chat an admin turned off is told so, and draws no composer", async () => {
  await mountedAt(`/tenants/${tenant}/chat`, { opens: false });
  expect(screen.getByText(memberChatWithheld)).toBeDefined();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  styleless();
});

test("abilities not read yet draw the page as loading, and no composer", async () => {
  await mountedAt(`/tenants/${tenant}/chat`, { abilities: "Pending" });
  expect(screen.getByText("Loading…")).toBeDefined();
  expect(screen.queryByText(memberChatWithheld)).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  styleless();
});

test("abilities whose read failed say so, and draw no composer", async () => {
  await mountedAt(`/tenants/${tenant}/chat`, { abilities: "Failed" });
  expect(readFailedLines()).toStrictEqual(["Not read · Server error"]);
  expect(screen.queryByText(memberChatWithheld)).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  styleless();
});

test("a reader with no chat host is told so, with where one is registered", async () => {
  await mountedAt(`/tenants/${tenant}/chat`, { host: undefined });
  expect(screen.getByText("No chat host")).toBeDefined();
  const runners = screen.getByRole("link", { name: "My runners" });
  expect(runners.getAttribute("href")).toBe(
    `/tenants/${tenant}/settings/runner`,
  );
  styleless();
});

test("a chat host that is not live is said as offline", async () => {
  await mountedAt(`/tenants/${tenant}/chat/${ownSession}`, {
    host: { live: false },
  });
  expect(screen.getByText("Chat host offline")).toBeDefined();
  styleless();
});

test("a first message opens a thread of the reader's own chat, and the page moves to it", async () => {
  const posts: string[] = [];
  const router = await mountedAt(`/tenants/${tenant}/chat`, {}, posts);
  await sent("hello");
  expect(posts).toStrictEqual([
    chatPath,
    `${chatPath}/${openedSession}/messages`,
  ]);
  expect(router.state.location.pathname).toBe(
    `/tenants/${tenant}/chat/${openedSession}`,
  );
  styleless();
});

test("a message sent to an open thread reads it again at once", async () => {
  await mountedAt(`/tenants/${tenant}/chat/${ownSession}`);
  const served = globalThis.fetch;
  const reads: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") reads.push(url);
    return served(url, init);
  });
  await sent("again");
  expect(reads).toContain(`${chatPath}/${ownSession}`);
  styleless();
});

test("a first message refused at the reader's thread limit says so and stays", async () => {
  const router = await mountedAt(`/tenants/${tenant}/chat`, {
    open: () =>
      answer({ error: { code: "ThreadLimitReached" }, threadsMax: 1 }, 409),
  });
  await sent("hello");
  expect(screen.getByText("Not sent · Thread limit reached")).toBeDefined();
  expect(router.state.location.pathname).toBe(`/tenants/${tenant}/chat`);
  styleless();
});
