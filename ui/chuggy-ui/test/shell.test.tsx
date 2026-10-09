/**
 * The frame: the chat pane beside the pages, under them or over them, the bar a
 * page fills, the details beside the page or instead of it, and the slot under
 * it.
 *
 * Every case ends by asserting `styleless()`, because the served policy refuses
 * a `<style>` element: a primitive that appends a sheet passes every other
 * assertion here and is refused by the browser.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import { conversationWaitWordAfterMs } from "../app/browser/conversation/ConversationLines.tsx";
import { DetailsSlot, TopBarSlot } from "../app/browser/shell/slots.tsx";
import {
  viewportDeskEm,
  viewportNarrowEm,
  viewportTwoColumnEm,
} from "../app/browser/shell/viewport.ts";
import { sessionPlacementResource } from "../app/browser/sessionPlacement.tsx";
import { hostedRunsResource } from "../app/browser/thread/threadSend.tsx";
import { chatPaneStoreKey } from "../app/core/chatPane.ts";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { leadBody } from "./leadFixture.ts";
import {
  abilitiesFetch,
  abilitiesNone,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  threadBody,
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadTranscriptPage,
  threadTurn,
} from "./threadFixture.ts";
import { viewportAtEm } from "./viewport.ts";
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
import type * as RouterModule from "@tanstack/react-router";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

let pageDrawn: () => ReactNode = () => null;

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: {
    readonly children?: ReactNode;
    readonly onClick?: () => void;
  }) => (
    <a href="/" onClick={props.onClick}>
      {props.children}
    </a>
  ),
  Outlet: () => pageDrawn(),
  useNavigate: () => () => undefined,
  useParams: () => atlas,
  useRouterState: (options: {
    readonly select: (state: {
      readonly location: { readonly pathname: string };
    }) => unknown;
  }) => options.select({ location: { pathname: "/acme/atlas" } }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
});

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
  pageDrawn = () => null;
  localStorage.removeItem(chatPaneStoreKey);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
}

/** The project inventory for the switcher, an empty thread listing for the
 * chat pane, and the same body for everything else — a read that cannot parse
 * it draws its own unready state, which is not what these cases are about. */
function shellRoute(url: string): Response {
  if (url.includes("/threads")) return answer({ threads: [] });
  return answer({ projects: [atlas] });
}

async function mounted(
  em: number,
  served?: typeof fetch,
  client: QueryClient = new QueryClient(),
): Promise<void> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: shellRoute,
  });
  viewportAtEm(em);
  vi.stubGlobal("fetch", served ?? api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
    </ScreenHarness>,
  );
  await settled();
}

function chatDrawn(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Chat" });
}

function navDrawn(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "Console" });
}

function frameTracks(): string {
  return document.querySelector("[data-chat]")?.className ?? "";
}

async function pressed(name: string): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name }).click();
  });
  await settled();
}

async function tooltipNamed(name: string): Promise<void> {
  const button = screen.getByRole("button", { name });
  const trigger = button.closest('[tabindex="0"]');
  if (trigger === null) throw new Error(`no tooltip trigger around ${name}`);
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(name);
  fireEvent.blur(trigger);
}

test("the chat pane sits beside the pages at the two-column width", async () => {
  await mounted(viewportTwoColumnEm);
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat)]",
  );
  styleless();
});

/** The bar reaches every screen and the banner speaks for all of them, so a
 * bar inside the column the pane divides would give a quarter of itself to a
 * pane that has nothing to do with it. */
test("the bar spans the frame rather than sharing the row with the pane", async () => {
  await mounted(viewportDeskEm);
  const nav = navDrawn();
  expect(nav).not.toBeNull();
  expect(
    nav?.closest("[data-chat]"),
    "the bar was drawn inside the tracks the chat pane divides",
  ).toBeNull();
  expect(
    document.querySelector(".shell-banner")?.closest("[data-chat]"),
  ).toBeNull();
  expect(chatDrawn()?.closest("[data-chat]")).not.toBeNull();
  styleless();
});

/** A docked pane under the pages takes a share of every page's height, which
 * a narrow viewport cannot spare until the reader asks for the chat. */
test("under that width it starts as a strip under the pages, and expands there", async () => {
  await mounted(viewportTwoColumnEm - 1);
  expect(chatDrawn()).toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-rows-[minmax(0,1fr)_var(--width-chat-strip)]",
  );
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
  styleless();
  await pressed("Expand chat");
  expect(chatDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-rows-[minmax(0,1fr)_var(--height-chat)]",
  );
  styleless();
});

/** What the reader chose is theirs at every width: a pane they expanded is
 * not put away again because the viewport is narrow. */
test("under that width a pane the reader expanded starts expanded", async () => {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Docked" }),
  );
  await mounted(viewportTwoColumnEm - 1);
  expect(chatDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-rows-[minmax(0,1fr)_var(--height-chat)]",
  );
  styleless();
});

/** Each icon control's hidden name is also what a pointer or a keyboard focus
 * reveals, so a reader who does not use a screen reader learns what New, Full
 * screen, Exit full screen, Collapse and Expand chat do before pressing them. */
test("the pane's icon controls name themselves again on focus", async () => {
  await mounted(viewportDeskEm);
  await tooltipNamed("New");
  await tooltipNamed("Full screen");
  await tooltipNamed("Collapse");
  await pressed("Full screen");
  await tooltipNamed("Exit full screen");
  await pressed("Exit full screen");
  await pressed("Collapse");
  await tooltipNamed("Expand chat");
  styleless();
});

test("collapsing leaves a strip whose own control expands it again", async () => {
  await mounted(viewportDeskEm);
  await pressed("Collapse");
  expect(chatDrawn()).toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat-strip)]",
  );
  styleless();
  await pressed("Expand chat");
  expect(chatDrawn()).not.toBeNull();
  styleless();
});

/** Leaving a full screen is not collapsing it: the pages come back beside the
 * pane, which is the whole difference between the two controls. The bar stands
 * through both, so every screen is one press away from a filled chat. */
test("full screen takes the body under the bar, and exiting puts the pages back", async () => {
  await mounted(viewportDeskEm);
  await pressed("Full screen");
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain("grid-cols-1");
  styleless();
  await pressed("Exit full screen");
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat)]",
  );
  styleless();
});

test("a collapsed pane goes straight to full screen and back to its column", async () => {
  await mounted(viewportDeskEm);
  await pressed("Collapse");
  await pressed("Expand chat");
  await pressed("Full screen");
  expect(frameTracks()).toContain("grid-cols-1");
  await pressed("Exit full screen");
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat)]",
  );
  styleless();
});

/** A reader pressing for a screen is asking to see it, and a pane still over
 * the whole body would answer by drawing the chat again. */
test("pressing a screen puts a filled pane back beside the pages", async () => {
  await mounted(viewportDeskEm);
  await pressed("Full screen");
  expect(frameTracks()).toContain("grid-cols-1");
  await turned(() => {
    screen.getByRole("link", { name: /Inbox/u }).click();
  });
  await settled();
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat)]",
  );
  styleless();
});

/** A pane the reader put away stays away: that press was theirs too, and a
 * screen they asked for is not a reason to hand the chat back. */
test("pressing a screen leaves a collapsed pane collapsed", async () => {
  await mounted(viewportDeskEm);
  await pressed("Collapse");
  await turned(() => {
    screen.getByRole("link", { name: /Inbox/u }).click();
  });
  await settled();
  expect(frameTracks()).toContain(
    "grid-cols-[minmax(0,1fr)_var(--width-chat-strip)]",
  );
  styleless();
});

function paneDocked(): void {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Docked" }),
  );
}

/** A phone's bar wraps to rows a conversation cannot spare, so a chat given
 * the frame there takes them too. The banner's place stands through it, since
 * what the banner says is true of the chat as well. */
test("on a narrow viewport a full screen takes the bar's rows, and leaving it draws the bar again", async () => {
  paneDocked();
  await mounted(viewportNarrowEm - 1);
  expect(navDrawn()).not.toBeNull();
  await pressed("Full screen");
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(document.querySelector(".shell-banner")).not.toBeNull();
  styleless();
  await pressed("Exit full screen");
  expect(navDrawn()).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeNull();
  styleless();
});

test("a viewport at the narrow width keeps the bar over a full screen", async () => {
  paneDocked();
  await mounted(viewportNarrowEm);
  await pressed("Full screen");
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  styleless();
});

/** A pane with the frame sets its conversation as a column to read, which the
 * sheet does for the class the pane carries then and not beside the pages. */
test("a pane given the whole frame is marked as one to read, and beside the pages it is not", async () => {
  await mounted(viewportDeskEm);
  expect(chatDrawn()?.classList.contains("chat-reading")).toBe(false);
  await pressed("Full screen");
  expect(chatDrawn()?.classList.contains("chat-reading")).toBe(true);
  await pressed("Exit full screen");
  expect(chatDrawn()?.classList.contains("chat-reading")).toBe(false);
  styleless();
});

/** Where the pane sits is set once, so it lives behind the bar's gear rather
 * than in the pane's own header. */
test("repositioning the pane divides the frame the other way and is remembered", async () => {
  await mounted(viewportDeskEm);
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
      key: "ArrowDown",
    });
  });
  await screen.findByRole("menu");
  await turned(() => {
    screen.getByRole("menuitemradio", { name: "Left" }).click();
  });
  await settled();
  expect(frameTracks()).toContain(
    "grid-cols-[var(--width-chat)_minmax(0,1fr)]",
  );
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Left");
  styleless();
});

const openedSession = "thread-new";

/** A server that opens one thread of the reader's own and answers reads of it,
 * with `listed` standing for what the listing carries before the frame that
 * stales it arrives. */
function threadServed(listed: readonly unknown[]): typeof fetch {
  return ((url: string, init?: { readonly method?: string }) => {
    if (init?.method === "POST")
      return Promise.resolve(
        answer(
          threadEntry({ session: openedSession, owner: "geoff", mine: true }),
        ),
      );
    if (url.includes(`/threads/${openedSession}/transcript`))
      return Promise.resolve(answer(threadTranscriptPage(0)));
    if (url.includes(`/threads/${openedSession}`))
      return Promise.resolve(
        answer(
          threadBody({ session: openedSession, streamless: true, turns: [] }),
        ),
      );
    if (url.includes("/threads")) return answer({ threads: listed });
    return Promise.resolve(shellRoute(url));
  }) as unknown as typeof fetch;
}

function composerDrawn(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

/** A server holding the reader's own thread with a turn the mailbox has not
 * settled, which is what withholds New and renames it Answering. */
function answeringThreadServed(): typeof fetch {
  return ((url: string) => {
    if (url.includes(`/threads/${threadMineSession}/transcript`))
      return Promise.resolve(answer(threadTranscriptPage(0)));
    if (url.includes(`/threads/${threadMineSession}`))
      return Promise.resolve(
        answer(
          threadBody({
            session: threadMineSession,
            turns: [threadTurn({ turn: "thread-turn-1", state: "Queued" })],
          }),
        ),
      );
    if (url.includes("/threads"))
      return Promise.resolve(
        answer({
          threads: [
            threadEntry({
              session: threadMineSession,
              owner: "geoff",
              mine: true,
            }),
          ],
        }),
      );
    return Promise.resolve(shellRoute(url));
  }) as unknown as typeof fetch;
}

/** New is withheld and renamed Answering while the reader's own thread has not
 * settled, which is exactly where a reader most needs its tooltip: the control
 * cannot be pressed to learn what it does, so the tooltip has to open on focus
 * regardless. */
test("Answering's tooltip still opens on focus while New is disabled", async () => {
  await mounted(viewportDeskEm, answeringThreadServed());
  const button = screen.getByRole("button", { name: "Answering" });
  expect(button.hasAttribute("disabled")).toBe(true);
  await tooltipNamed("Answering");
  styleless();
});

/**
 * A thread just opened is not in the listing yet: the `Session` frame that
 * stales it has not arrived. So the pane holds what the open answered rather
 * than waiting to be told, which is the difference between a reader typing
 * straight away and a reader looking at an empty pane.
 */
test("starting a thread holds it at once, and the box takes the caret", async () => {
  await mounted(viewportDeskEm, threadServed([]));
  await pressed("New");
  expect(screen.getByRole("region", { name: "Conversation" })).toBeDefined();
  expect(
    document.activeElement,
    "a reader who started a thread had to click the box before typing in it",
  ).toBe(composerDrawn());
  styleless();
});

/** The item of the pane's header an element stands in. */
function headerItem(element: HTMLElement): Element | null {
  const header = chatDrawn()?.querySelector("header");
  let item: Element | null = element;
  while (item !== null && item.parentElement !== header)
    item = item.parentElement;
  return item;
}

/** The header is one row: the thread's title with what is done to that thread
 * beside it, then the pane's own controls, each an item of the same row, and
 * the title the one item that gives way where the row is short. How tall that
 * row is drawn is a browser's to say. */
test("the pane's title and every control of it stand in the header's one row", async () => {
  await mounted(
    viewportDeskEm,
    threadServed([
      threadEntry({
        session: openedSession,
        owner: "geoff",
        mine: true,
        title: "held",
      }),
    ]),
  );
  const header = chatDrawn()?.querySelector("header");
  expect(header?.classList.contains("flex")).toBe(true);
  const title = headerItem(screen.getByRole("heading", { name: "held" }));
  expect(title).not.toBeNull();
  expect(title?.classList.contains("flex-1")).toBe(true);
  expect(title?.classList.contains("min-w-0")).toBe(true);
  const named = (name: string): Element | null =>
    headerItem(screen.getByRole("button", { name }));
  expect(named("Rename")).toBe(title);
  expect(named("Close")).toBe(title);
  const controls = ["New", "History", "Full screen", "Collapse"].map(named);
  for (const control of controls) {
    expect(control).not.toBeNull();
    expect(control).not.toBe(title);
  }
  expect(new Set(controls).size).toBe(controls.length);
  expect([...(header?.children ?? [])]).toStrictEqual([title, ...controls]);
  styleless();
});

/** The caret is for a thread the reader named, and arriving at the one they
 * already had is not naming it: a pane that grabbed focus on the first paint
 * would take it from whatever page the reader actually opened. */
test("a thread the reader arrived at leaves the caret where it was", async () => {
  await mounted(
    viewportDeskEm,
    threadServed([
      threadEntry({ session: openedSession, owner: "geoff", mine: true }),
    ]),
  );
  expect(composerDrawn()).toBeDefined();
  expect(document.activeElement).toBe(document.body);
  styleless();
});

/** A first message the door refused leaves the reader where they typed it,
 * and New is still theirs to press: the thread it opens is the one drawn. */
test("New after a refused first message holds the thread it opens", async () => {
  const read: string[] = [];
  const served = threadServed([]);
  await mounted(viewportDeskEm, ((
    url: string,
    init?: { readonly method?: string },
  ) => {
    if (init?.method === "POST" && url.endsWith("/messages"))
      return Promise.resolve(answer({ error: { code: "Invalid" } }, 400));
    if (init?.method !== "POST") read.push(url);
    return served(url, init);
  }) as unknown as typeof fetch);
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  await turned(() => {
    screen.getByRole("button", { name: "Send" }).click();
  });
  await settled();
  expect(read.some((url) => url.includes(`/threads/${openedSession}`))).toBe(
    false,
  );
  await pressed("New");
  expect(read.some((url) => url.includes(`/threads/${openedSession}`))).toBe(
    true,
  );
  styleless();
});

/** One answer a case holds back until it lets it go. */
function heldBack(): {
  readonly let: Promise<void>;
  readonly go: () => void;
} {
  let go = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    go = resolve;
  });
  return {
    let: held,
    go: () => {
      go();
    },
  };
}

/** The asks the pane draws that say "hello". */
function helloAsks(): readonly Element[] {
  return Array.from(
    chatDrawn()?.querySelectorAll('[data-message-id$="-ask"]') ?? [],
  ).filter((ask) => ask.textContent === "hello");
}

/** A reader with no thread sees their first message from the press: through
 * the open, the door taking it, and the read of the thread it opened, each
 * held back in turn, with no line saying the pane is loading in its place. */
test("a first message is drawn once from the press until its thread is read, and no loading line stands in for it", async () => {
  const opening = heldBack();
  const taking = heldBack();
  const reading = heldBack();
  const served = threadServed([]);
  let turn = "";
  await mounted(viewportDeskEm, ((
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ) => {
    if (init?.method === "POST" && url.endsWith("/messages")) {
      turn = (JSON.parse(init.body ?? "") as { readonly turn: string }).turn;
      return taking.let.then(() => answer({ turn, ordinal: 1 }, 202));
    }
    if (init?.method === "POST")
      return opening.let.then(() => served(url, init));
    if (url.endsWith(`/threads/${openedSession}`))
      return reading.let.then(() =>
        answer(
          threadBody({
            session: openedSession,
            streamless: true,
            turns: [threadTurn({ turn, input: "hello", state: "Queued" })],
          }),
        ),
      );
    return served(url, init);
  }) as unknown as typeof fetch);
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  await turned(() => {
    screen.getByRole("button", { name: "Send" }).click();
  });
  const drawnOnce = (): void => {
    expect(helloAsks()).toHaveLength(1);
    expect(screen.queryByText("Loading…")).toBeNull();
  };
  drawnOnce();
  for (const answered of [opening, taking, reading]) {
    await turned(answered.go);
    await settled();
    drawnOnce();
  }
  expect(turn).not.toBe("");
  expect(composerDrawn().value).toBe("");
  styleless();
});

/** A server whose thread door refuses every open for the hosted grant. */
function unhostedServed(): typeof fetch {
  const served = threadServed([]);
  return ((url: string, init?: { readonly method?: string }) =>
    init?.method === "POST" && url.endsWith("/threads")
      ? Promise.resolve(
          answer({ error: { code: "HostedRunsNotGranted" } }, 403),
        )
      : served(url, init)) as unknown as typeof fetch;
}

/** The box a refused message was typed in, which keeps it to be read and
 * copied and takes nothing more. */
function heldBox(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

/** No thread the reader opens could run, so the box takes no more presses and
 * keeps the message it handed back, with what refused it beneath. */
test("a first message the hosted grant refuses stays in the box, read-only, over the refusal", async () => {
  await mounted(viewportDeskEm, unhostedServed());
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  await turned(() => {
    screen.getByRole("button", { name: "Send" }).click();
  });
  await settled();
  expect(heldBox().value).toBe("hello");
  expect(heldBox().readOnly).toBe(true);
  expect(
    within(screen.getByRole("region", { name: "Conversation" })).getByText(
      "Needs hosted runs",
    ),
  ).toBeTruthy();
  styleless();
});

test("New the hosted grant refuses puts the refusal where the composer was", async () => {
  await mounted(viewportDeskEm, unhostedServed());
  await pressed("New");
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  styleless();
});

/** The thread posts a server saw, in order, each named by what it asked for. */
function postsNamed(posts: readonly string[]): readonly string[] {
  return posts.map((url) => (url.endsWith("/close") ? "close" : "open"));
}

/** A server holding the reader's own idle thread, recording every thread post
 * and answering an open as `open` names. */
function heldThreadServed(
  posts: string[],
  open: () => Promise<unknown>,
): typeof fetch {
  const served = threadServed([
    threadEntry({ session: openedSession, owner: "geoff", mine: true }),
  ]);
  return ((url: string, init?: { readonly method?: string }) => {
    if (init?.method !== "POST") return served(url, init);
    posts.push(url);
    return url.endsWith("/threads") ? open() : served(url, init);
  }) as unknown as typeof fetch;
}

test("New with a thread the grant allows closes it and opens another", async () => {
  const posts: string[] = [];
  await mounted(
    viewportDeskEm,
    heldThreadServed(posts, () =>
      Promise.resolve(
        answer(
          threadEntry({ session: openedSession, owner: "geoff", mine: true }),
        ),
      ),
    ),
  );
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open", "close", "open"]);
  styleless();
});

/** The open is asked before the close, so a reader the hosted grant refuses
 * keeps the thread they had rather than losing it to one that cannot open. */
test("New the hosted grant refuses closes nothing, and the refusal is drawn", async () => {
  const posts: string[] = [];
  await mounted(
    viewportDeskEm,
    heldThreadServed(posts, () =>
      Promise.resolve(answer({ error: { code: "HostedRunsNotGranted" } }, 403)),
    ),
  );
  await pressed("New");
  expect(
    postsNamed(posts),
    "a thread was closed for one that could not open",
  ).toStrictEqual(["open"]);
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  styleless();
});

/** A server whose thread door refuses every open for the hosted grant until
 * the case grants it. */
function grantedLaterServed(listed: readonly unknown[]): {
  readonly served: typeof fetch;
  readonly grant: () => void;
} {
  const served = threadServed(listed);
  let granted = false;
  return {
    served: ((url: string, init?: { readonly method?: string }) =>
      !granted && init?.method === "POST" && url.endsWith("/threads")
        ? Promise.resolve(
            answer({ error: { code: "HostedRunsNotGranted" } }, 403),
          )
        : served(url, init)) as unknown as typeof fetch,
    grant: () => {
      granted = true;
    },
  };
}

/** A thread that opens where the route is read as hosted answers the refusal
 * New met before it, so none stands once the grant is given. */
async function grantedAfterRefusal(listed: readonly unknown[]): Promise<void> {
  const server = grantedLaterServed(listed);
  await mounted(
    viewportDeskEm,
    placedServed(server.served, { thread: "InCluster" }),
  );
  await pressed("New");
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  server.grant();
  await pressed("New");
  expect(screen.queryAllByText("Needs hosted runs")).toStrictEqual([]);
  styleless();
}

test("New after the grant is given leaves no refusal standing, with no thread held", async () => {
  await grantedAfterRefusal([]);
});

test("New after the grant is given leaves no refusal standing, with a thread held", async () => {
  await grantedAfterRefusal([
    threadEntry({ session: openedSession, owner: "geoff", mine: true }),
  ]);
});

/** A grant withdrawn after the thread opened refuses its next message, and the
 * box keeps that message while taking no more. */
test("a message to a held thread the hosted grant refuses stays in the box, read-only, over the refusal", async () => {
  const served = threadServed([
    threadEntry({ session: openedSession, owner: "geoff", mine: true }),
  ]);
  let sends = 0;
  await mounted(viewportDeskEm, ((
    url: string,
    init?: { readonly method?: string },
  ) => {
    if (init?.method !== "POST" || !url.endsWith("/messages"))
      return served(url, init);
    sends += 1;
    return Promise.resolve(
      answer({ error: { code: "HostedRunsNotGranted" } }, 403),
    );
  }) as unknown as typeof fetch);
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  await turned(() => {
    screen.getByRole("button", { name: "Send" }).click();
  });
  await settled();
  expect(heldBox().value).toBe("hello");
  expect(heldBox().readOnly).toBe(true);
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  expect(screen.queryByText("Closed")).toBeNull();
  await turned(() => {
    fireEvent.keyDown(heldBox(), { key: "Enter" });
  });
  await settled();
  expect(sends, "a held box sent its message again").toBe(1);
  styleless();
});

/** The shell over a server answering the lead route with `lead`. */
function leadServed(lead: unknown): typeof fetch {
  return apiDouble({
    operation: operationAt("Pending"),
    route: (url) => (url.endsWith("/lead") ? answer(lead) : shellRoute(url)),
  }).fetch;
}

/** A project with no lead is answered rather than refused, so the bar draws the
 * entry with nothing beside it, and one with a lead draws where it stands. */
test("the bar's Lead entry stands only where the project has a lead", async () => {
  await mounted(viewportDeskEm, leadServed({ lead: "None" }));
  const bar = (): HTMLElement => navDrawn() ?? document.body;
  const unled = within(bar()).getByRole("link", { name: "Lead" });
  expect(unled.querySelector("[aria-hidden]"), "a dot with no lead").toBeNull();
  cleanup();
  await mounted(viewportDeskEm, leadServed(leadBody(1, 1)));
  const led = within(bar()).getByRole("link", { name: "OpenLead" });
  expect(led.querySelector("[aria-hidden]")).not.toBeNull();
  styleless();
});

/** A server whose grant read answers as `granted` says, holding `listed`, and
 * answering the held thread's own read in the standing `state` names. */
function grantReadServed(
  granted: boolean,
  listed: readonly unknown[],
  state: "Open" | "Orphaned" = "Open",
): typeof fetch {
  const served = threadServed(listed);
  return ((url: string, init?: { readonly method?: string }) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted }));
    if (url.endsWith(`/threads/${openedSession}`) && init?.method !== "POST")
      return Promise.resolve(
        answer(
          threadBody({
            session: openedSession,
            streamless: true,
            turns: [],
            state,
          }),
        ),
      );
    return served(url, init);
  }) as unknown as typeof fetch;
}

test("a reader the tenant grants no hosted runs is told so where the composer would be, before typing", async () => {
  await mounted(viewportDeskEm, grantReadServed(false, []));
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  const conversation = within(
    screen.getByRole("region", { name: "Conversation" }),
  );
  expect(conversation.getByText("Needs hosted runs")).toBeTruthy();
  expect(conversation.getByText("· Granted by the operator")).toBeTruthy();
  styleless();
});

test("a reader the tenant grants hosted runs is offered the composer", async () => {
  await mounted(viewportDeskEm, grantReadServed(true, []));
  expect(composerDrawn()).toBeTruthy();
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  styleless();
});

/** The box is the one place a held thread says it, so the bar beside New does
 * not say it a second time. */
test("a held thread's box takes nothing where the grant is read as not given, and says so once", async () => {
  await mounted(
    viewportDeskEm,
    grantReadServed(false, [
      threadEntry({ session: openedSession, owner: "geoff", mine: true }),
    ]),
  );
  expect(heldBox().readOnly).toBe(true);
  expect(
    within(screen.getByRole("region", { name: "Conversation" })).getByText(
      "Needs hosted runs",
    ),
  ).toBeTruthy();
  expect(screen.getAllByText("Needs hosted runs")).toHaveLength(1);
  styleless();
});

/** A thread that takes no messages draws `Closed` where the box would be, so
 * the grant is said beside New, which is what it would refuse. */
test("a held thread that takes no messages has the grant said beside New", async () => {
  await mounted(
    viewportDeskEm,
    grantReadServed(
      false,
      [
        threadEntry({
          session: openedSession,
          owner: "geoff",
          mine: true,
          state: "Orphaned",
        }),
      ],
      "Orphaned",
    ),
  );
  const conversation = within(
    screen.getByRole("region", { name: "Conversation" }),
  );
  expect(conversation.getByText("Closed")).toBeTruthy();
  expect(conversation.queryByText("Needs hosted runs")).toBeNull();
  expect(screen.getAllByText("Needs hosted runs")).toHaveLength(1);
  styleless();
});

/** `served`, with the session placement read answering `placement`. */
function placedServed(
  served: typeof fetch,
  placement: Parameters<typeof sessionPlacementBody>[0],
): typeof fetch {
  return ((url: string, init?: { readonly method?: string }) =>
    url.endsWith("/session-placement")
      ? Promise.resolve(answer(sessionPlacementBody(placement)))
      : served(url, init)) as unknown as typeof fetch;
}

function conversationRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Conversation" });
}

/** On runners the door asks no grant, so a reader without one types as any. */
test("a reader without the hosted grant is offered the composer where threads run on runners", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(false, []), { thread: "Pool" }),
  );
  expect(composerDrawn()).toBeTruthy();
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  styleless();
});

test("a reader without the hosted grant is told so where threads run hosted", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(false, []), { thread: "InCluster" }),
  );
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(
    within(conversationRegion()).getByText("Needs hosted runs"),
  ).toBeTruthy();
  styleless();
});

/** The composer stays the reader's whatever their runner, and says, beneath,
 * only what stands in a turn's way. */
test.each([
  ["Unregistered", "No runner"],
  ["Offline", "Runner offline"],
] as const)(
  "a reader whose runner is %s is told %s under a composer that still takes text",
  async (mine, said) => {
    await mounted(
      viewportDeskEm,
      placedServed(grantReadServed(false, []), { thread: "Pool", mine }),
    );
    expect(heldBox().readOnly).toBe(false);
    expect(within(conversationRegion()).getByText(said)).toBeTruthy();
    styleless();
  },
);

test("a reader with no runner is pointed at the Runners page", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(true, []), {
      thread: "Pool",
      mine: "Unregistered",
    }),
  );
  expect(
    within(conversationRegion()).getByRole("link", { name: "Runners" }),
  ).toBeTruthy();
  styleless();
});

test("a reader whose runner is live is told nothing about it", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(false, []), { thread: "Pool", mine: "Live" }),
  );
  expect(screen.queryByText("No runner")).toBeNull();
  expect(screen.queryByText("Runner offline")).toBeNull();
  styleless();
});

/** "hello" sent from a pane whose read says the reader's runner is live, to a
 * door that refuses `door`'s every post for no runner: the open where the
 * reader has no thread, or the message where they have one. */
async function sentRefusedNoRunner(
  door: "/threads" | "/messages",
): Promise<void> {
  const served = threadServed(
    door === "/messages"
      ? [threadEntry({ session: openedSession, owner: "geoff", mine: true })]
      : [],
  );
  await mounted(
    viewportDeskEm,
    placedServed(
      ((url: string, init?: { readonly method?: string }) =>
        init?.method === "POST" && url.endsWith(door)
          ? Promise.resolve(answer({ error: { code: "NoRunner" } }, 403))
          : served(url, init)) as unknown as typeof fetch,
      { thread: "Pool", mine: "Live" },
    ),
  );
  await helloSent();
}

/** "hello" typed into the box and sent. */
async function helloSent(): Promise<void> {
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  await turned(() => {
    screen.getByRole("button", { name: "Send" }).click();
  });
  await settled();
}

/** A runner withdrawn after the read refuses the send, and the box keeps the
 * message and takes it again once the reader has one. */
test("a message the door refuses for no runner stays in the box, which still takes text", async () => {
  await sentRefusedNoRunner("/messages");
  expect(heldBox().value).toBe("hello");
  expect(heldBox().readOnly).toBe(false);
  expect(within(conversationRegion()).getByText("No runner")).toBeTruthy();
  styleless();
});

/** The open is asked before the close, so a reader whose runner went since
 * the pane read it keeps the thread they had, and the box under it says what
 * New met. */
test("New the door refuses for no runner closes nothing, and the box says so", async () => {
  const posts: string[] = [];
  let mine: "Live" | "Unregistered" = "Live";
  const served = heldThreadServed(posts, () =>
    Promise.resolve(answer({ error: { code: "NoRunner" } }, 403)),
  );
  await mounted(viewportDeskEm, ((
    url: string,
    init?: { readonly method?: string },
  ) =>
    url.endsWith("/session-placement")
      ? Promise.resolve(answer(sessionPlacementBody({ thread: "Pool", mine })))
      : served(url, init)) as unknown as typeof fetch);
  expect(screen.queryByText("No runner")).toBeNull();
  mine = "Unregistered";
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open"]);
  expect(within(conversationRegion()).getByText("No runner")).toBeTruthy();
  expect(screen.queryByText(/^Refused/u)).toBeNull();
  styleless();
});

/** Reads the session placement again, as its poll would. */
async function placementReread(client: QueryClient): Promise<void> {
  await turned(() => {
    void client.invalidateQueries({
      queryKey: projectResourceKey(atlas, "Project", sessionPlacementResource),
    });
  });
  await settled();
}

/** What a case moves under the pane: the route the placement answers, or a
 * failed read where none, and the post the grant refuses, if any. */
interface PaneMoving {
  thread: "Pool" | "InCluster" | undefined;
  refusing: "/threads" | "/messages" | undefined;
}

function movingServed(moving: PaneMoving, served: typeof fetch): typeof fetch {
  return ((url: string, init?: { readonly method?: string }) => {
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        moving.thread === undefined
          ? answer({ error: { code: "Unavailable" } }, 500)
          : answer(sessionPlacementBody({ thread: moving.thread })),
      );
    if (
      moving.refusing !== undefined &&
      init?.method === "POST" &&
      url.endsWith(moving.refusing)
    )
      return Promise.resolve(
        answer({ error: { code: "HostedRunsNotGranted" } }, 403),
      );
    return served(url, init);
  }) as unknown as typeof fetch;
}

/** A route moved to hosted under the reader refuses the send for the grant,
 * which every screen then reads as withheld, and the box holds the message
 * until the route is read as runners again. */
test("a message the hosted grant refuses where the read said runners is held until runners are read again", async () => {
  const client = new QueryClient();
  const moving: PaneMoving = { thread: "Pool", refusing: "/messages" };
  await mounted(
    viewportDeskEm,
    movingServed(
      moving,
      threadServed([
        threadEntry({ session: openedSession, owner: "geoff", mine: true }),
      ]),
    ),
    client,
  );
  moving.thread = "InCluster";
  await helloSent();
  expect(heldBox().readOnly).toBe(true);
  expect(
    within(conversationRegion()).getByText("Needs hosted runs"),
  ).toBeTruthy();
  expect(
    client.getQueryData(
      projectResourceKey(atlas, "Project", hostedRunsResource),
    ),
  ).toStrictEqual({ granted: false });
  moving.thread = "Pool";
  moving.refusing = undefined;
  await placementReread(client);
  expect(heldBox().readOnly).toBe(false);
  expect(heldBox().value).toBe("hello");
  styleless();
});

/** The open refused for the grant is newer than the read that said runners,
 * so the box holds the message rather than taking it back at once. */
test("a first message the hosted grant refuses where the read said runners stays held", async () => {
  const moving: PaneMoving = { thread: "Pool", refusing: "/threads" };
  await mounted(
    viewportDeskEm,
    movingServed(moving, grantReadServed(false, [])),
  );
  moving.thread = "InCluster";
  await helloSent();
  expect(heldBox().value).toBe("hello");
  expect(heldBox().readOnly).toBe(true);
  expect(
    within(conversationRegion()).getByText("Needs hosted runs"),
  ).toBeTruthy();
  styleless();
});

/** A refusal is newer than the read it met, and a read that fails after it
 * says nothing newer, so the box holds until a read answers runners. */
test.each([
  ["a message", "/messages", true],
  ["a first message", "/threads", false],
] as const)(
  "%s the hosted grant refuses while the placement reads fail stays held",
  async (_said, refusing, held) => {
    const client = new QueryClient();
    const moving: PaneMoving = { thread: "Pool", refusing };
    await mounted(
      viewportDeskEm,
      movingServed(moving, grantReadServed(false, ownThread(held))),
      client,
    );
    moving.thread = undefined;
    await helloSent();
    await placementReread(client);
    expect(heldBox().value).toBe("hello");
    expect(heldBox().readOnly).toBe(true);
    moving.thread = "Pool";
    moving.refusing = undefined;
    await placementReread(client);
    expect(heldBox().readOnly).toBe(false);
    expect(heldBox().value).toBe("hello");
    styleless();
  },
);

/** The reader's own thread where `held`, and none otherwise. */
function ownThread(held: boolean): readonly unknown[] {
  return held
    ? [threadEntry({ session: openedSession, owner: "geoff", mine: true })]
    : [];
}

/** A pane over `moving` for a reader the grant is read as not given, with
 * their own thread where `held`, and "hello" typed into its box. */
async function typedUnhosted(
  held: boolean,
  moving: PaneMoving,
): Promise<QueryClient> {
  const client = new QueryClient();
  await mounted(
    viewportDeskEm,
    movingServed(moving, grantReadServed(false, ownThread(held))),
    client,
  );
  fireEvent.change(composerDrawn(), { target: { value: "hello" } });
  return client;
}

/** A poll is asked on a clock, so one that fails says nothing of the route:
 * a reader on runners without the grant keeps the box and what is in it. */
test.each([
  ["with a thread", true],
  ["before a thread", false],
] as const)(
  "a placement poll that fails keeps the composer on runners without the grant (%s)",
  async (_said, held) => {
    const moving: PaneMoving = { thread: "Pool", refusing: undefined };
    const client = await typedUnhosted(held, moving);
    moving.thread = undefined;
    await placementReread(client);
    expect(screen.queryByText("Needs hosted runs")).toBeNull();
    expect(heldBox().readOnly).toBe(false);
    expect(heldBox().value).toBe("hello");
    styleless();
  },
);

/** A route moved to hosted under a reader without the grant holds what they
 * typed, read-only, whether or not they have a thread yet. */
test.each([
  ["with a thread", true],
  ["before a thread", false],
] as const)(
  "a route read as hosted under typed text holds it read-only (%s)",
  async (_said, held) => {
    const moving: PaneMoving = { thread: "Pool", refusing: undefined };
    const client = await typedUnhosted(held, moving);
    moving.thread = "InCluster";
    await placementReread(client);
    expect(heldBox().value).toBe("hello");
    expect(heldBox().readOnly).toBe(true);
    expect(
      within(conversationRegion()).getByText("Needs hosted runs"),
    ).toBeTruthy();
    styleless();
  },
);

/** A poll that lands while a press is out is older than the refusal the press
 * meets, so a re-read that fails after it does not clear that refusal. */
test.each([
  ["a message", "/messages", true],
  ["a first message", "/threads", false],
] as const)(
  "%s the hosted grant refuses after a poll landed mid-send stays held",
  async (_said, refusing, held) => {
    const client = new QueryClient();
    let refuses = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      refuses = resolve;
    });
    const moving: PaneMoving = { thread: "Pool", refusing };
    const served = movingServed(
      moving,
      grantReadServed(false, ownThread(held)),
    );
    await mounted(
      viewportDeskEm,
      ((url: string, init?: { readonly method?: string }) =>
        init?.method === "POST" && url.endsWith(refusing)
          ? gate.then(() => served(url, init))
          : served(url, init)) as unknown as typeof fetch,
      client,
    );
    fireEvent.change(composerDrawn(), { target: { value: "hello" } });
    await turned(() => {
      screen.getByRole("button", { name: "Send" }).click();
    });
    await placementReread(client);
    moving.thread = undefined;
    await turned(refuses);
    await settled();
    await placementReread(client);
    expect(heldBox().value).toBe("hello");
    expect(heldBox().readOnly).toBe(true);
    styleless();
  },
);

/** The re-read a refusal asks is after it, so where that read says runners
 * the box takes the message back at once. */
test.each([
  ["a message", "/messages", true],
  ["a first message", "/threads", false],
] as const)(
  "%s the hosted grant refuses gives way to its re-read saying runners",
  async (_said, refusing, held) => {
    const moving: PaneMoving = { thread: "Pool", refusing };
    await mounted(
      viewportDeskEm,
      movingServed(moving, grantReadServed(false, ownThread(held))),
    );
    await helloSent();
    expect(heldBox().value).toBe("hello");
    expect(heldBox().readOnly).toBe(false);
    styleless();
  },
);

/** The open's refusal is the newest word on the grant, wherever its read
 * stands. */
test("a first message the hosted grant refuses has every screen read the grant as withheld", async () => {
  const client = new QueryClient();
  const moving: PaneMoving = { thread: "Pool", refusing: "/threads" };
  await mounted(viewportDeskEm, movingServed(moving, threadServed([])), client);
  await helloSent();
  expect(
    client.getQueryData(
      projectResourceKey(atlas, "Project", hostedRunsResource),
    ),
  ).toStrictEqual({ granted: false });
  styleless();
});

/** New's refusal is newer than every read, so while the reads fail the pane
 * says the grant it met, with or without a thread drawn. */
test.each([
  ["with a thread", true],
  ["before a thread", false],
] as const)(
  "New the hosted grant refuses while the placement reads fail says so (%s)",
  async (_said, held) => {
    const client = new QueryClient();
    const moving: PaneMoving = { thread: "Pool", refusing: "/threads" };
    await mounted(
      viewportDeskEm,
      movingServed(moving, grantReadServed(false, ownThread(held))),
      client,
    );
    moving.thread = undefined;
    await pressed("New");
    expect(screen.getAllByText("Needs hosted runs")).toHaveLength(1);
    moving.thread = "Pool";
    moving.refusing = undefined;
    await placementReread(client);
    expect(screen.queryByText("Needs hosted runs")).toBeNull();
    styleless();
  },
);

/** A New that opens is newer than the refusal an earlier one met, so the pane
 * stops saying the grant even while the reads still fail. */
test("New that opens after one refused for the grant drops what that one met", async () => {
  const moving: PaneMoving = { thread: "Pool", refusing: "/threads" };
  await mounted(
    viewportDeskEm,
    movingServed(moving, grantReadServed(false, [])),
  );
  moving.thread = undefined;
  await pressed("New");
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  moving.refusing = undefined;
  await pressed("New");
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  styleless();
});

/** A box emptied again holds nothing, so the pane says the grant where the
 * box would be, as it does before typing. */
test("a route read as hosted under an emptied box draws the grant in its place", async () => {
  const moving: PaneMoving = { thread: "Pool", refusing: undefined };
  const client = await typedUnhosted(false, moving);
  fireEvent.change(composerDrawn(), { target: { value: "" } });
  moving.thread = "InCluster";
  await placementReread(client);
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(
    within(conversationRegion()).getByText("Needs hosted runs"),
  ).toBeTruthy();
  styleless();
});

/** New refused for the grant is newer than the read that said runners, so the
 * placement is read again rather than at the next poll. */
test("New the hosted grant refuses where the read said runners reads the placement again", async () => {
  let thread: "Pool" | "InCluster" = "Pool";
  const served = heldThreadServed([], () =>
    Promise.resolve(answer({ error: { code: "HostedRunsNotGranted" } }, 403)),
  );
  await mounted(viewportDeskEm, ((
    url: string,
    init?: { readonly method?: string },
  ) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: false }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(answer(sessionPlacementBody({ thread })));
    return served(url, init);
  }) as unknown as typeof fetch);
  expect(heldBox().readOnly).toBe(false);
  thread = "InCluster";
  await pressed("New");
  expect(heldBox().readOnly).toBe(true);
  expect(screen.getAllByText("Needs hosted runs")).toHaveLength(1);
  styleless();
});

/** The word under the last answer of the conversation. */
function lastWord(): string | undefined {
  return Array.from(
    conversationRegion().querySelectorAll(
      '.conversation-meta p [role="status"]',
    ),
    (status) => status.textContent,
  ).at(-1);
}

/** The word a waiting turn says once the wait has outlasted a glance. The
 * clock is driven so the case does not wait it out. */
async function waitedWord(): Promise<string | undefined> {
  await act(() => vi.advanceTimersByTimeAsync(conversationWaitWordAfterMs));
  return lastWord();
}

/** The reader's own queued turn on runners their runner cannot take now says
 * it is waiting rather than queued, and says so at once; a turn that is only
 * queued says so once that has lasted. The train runs in its answer's place. */
test.each([
  ["Offline", "Pool", "Waiting", "Waiting"],
  ["Unregistered", "Pool", "Waiting", "Waiting"],
  ["Live", "Pool", "", "Queued"],
  ["Offline", "InCluster", "", "Queued"],
] as const)(
  "a queued turn with the reader's runner %s on %s reads %j at once and %s once it has lasted",
  async (mine, thread, atOnce, lasted) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mounted(
      viewportDeskEm,
      placedServed(answeringThreadServed(), { thread, mine }),
    );
    expect(lastWord()).toBe(atOnce);
    expect(
      conversationRegion().querySelectorAll(".conversation-waiting-engine"),
    ).toHaveLength(1);
    expect(await waitedWord()).toBe(lasted);
    styleless();
  },
);

/** No read says how another member's runner stands, so their queued turn is
 * queued whatever the reader's own runner is doing. */
test("another member's queued turn reads Queued whatever the reader's runner", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await mounted(
    viewportDeskEm,
    placedServed(
      ((url: string) => {
        if (url.includes(`/threads/${threadOtherSession}/transcript`))
          return Promise.resolve(answer(threadTranscriptPage(0)));
        if (url.includes(`/threads/${threadOtherSession}`))
          return Promise.resolve(
            answer(
              threadBody({
                session: threadOtherSession,
                mine: false,
                owner: "ada",
                turns: [threadTurn({ turn: "thread-turn-1", state: "Queued" })],
              }),
            ),
          );
        if (url.includes("/threads"))
          return Promise.resolve(
            answer({
              threads: [threadEntry({ session: threadOtherSession })],
            }),
          );
        return Promise.resolve(shellRoute(url));
      }) as unknown as typeof fetch,
      { thread: "Pool", mine: "Offline" },
    ),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  const row = (await screen.findAllByRole("menuitemradio"))[0];
  if (row === undefined) throw new Error("no thread in the history");
  await turned(() => {
    fireEvent.click(row);
  });
  await settled();
  expect(await waitedWord()).toBe("Queued");
  expect(screen.queryByText("Waiting")).toBeNull();
  styleless();
});

/** The first press opens the thread, and an open refused for no runner keeps
 * the message in a box that still takes text. */
test("a first message whose open the door refuses for no runner stays in the box, which says so", async () => {
  await sentRefusedNoRunner("/threads");
  expect(heldBox().value).toBe("hello");
  expect(heldBox().readOnly).toBe(false);
  expect(within(conversationRegion()).getByText("No runner")).toBeTruthy();
  expect(screen.queryByText(/^Refused/u)).toBeNull();
  styleless();
});

/** The refusal answered the message as it was, so a corrected one is a press
 * of its own and the word goes with the text it was about. */
test("editing a message the door refused for no runner takes the refusal away", async () => {
  await sentRefusedNoRunner("/messages");
  expect(within(conversationRegion()).getByText("No runner")).toBeTruthy();
  await turned(() => {
    fireEvent.change(composerDrawn(), { target: { value: "hello again" } });
  });
  expect(screen.queryByText("No runner")).toBeNull();
  styleless();
});

/** An open the door took says the grant only where the route was read as
 * hosted: on runners, or before the route is read, it asked none, so a refusal
 * learnt before it still stands once the route is read as hosted. The grant's
 * own read is still in flight here, so what the doors said is all the pane
 * knows. */
test.each([
  ["on runners", "Pool"],
  ["before the route is read", undefined],
] as const)(
  "a thread opened %s does not take the grant as given",
  async (_said, opened) => {
    const moving: PaneMoving = {
      thread: opened === undefined ? undefined : "InCluster",
      refusing: "/threads",
    };
    const served = movingServed(moving, threadServed([]));
    const client = new QueryClient();
    await mounted(
      viewportDeskEm,
      ((url: string, init?: { readonly method?: string }) =>
        url.endsWith("/hosted-runs")
          ? new Promise(() => undefined)
          : served(url, init)) as unknown as typeof fetch,
      client,
    );
    await pressed("New");
    expect(screen.getByText("Needs hosted runs")).toBeTruthy();
    moving.thread = opened;
    moving.refusing = undefined;
    await placementReread(client);
    await pressed("New");
    moving.thread = "InCluster";
    await placementReread(client);
    expect(heldBox().readOnly).toBe(true);
    expect(
      within(conversationRegion()).getByText("Needs hosted runs"),
    ).toBeTruthy();
    styleless();
  },
);

test("a page's own bar content is drawn in a row of its own", async () => {
  pageDrawn = () => (
    <TopBarSlot>
      <span>ticket 44</span>
    </TopBarSlot>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("ticket 44")).toBeDefined();
  styleless();
});

test("a page that hands the shell no details gets no toggle", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  styleless();
});

/** A page's own middle row pins a composer to its foot with `flex-1` and
 * gives up the wrapper's reading measure and padding to its own scroller —
 * both only when the page marks a region `data-fills-page`, so a plain listing
 * keeps its own height and inset, and so does a page whose disclosures are
 * regions of their own. jsdom draws no boxes; this reads the declaration, not
 * the effect. */
test("the page column only stretches its wrapper for a page that fills it", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  const wrapper = screen.getByText("page").parentElement;
  expect(wrapper?.className).toContain("self-start");
  expect(wrapper?.className).toContain("has-[[data-fills-page]]:self-stretch");
  expect(wrapper?.className).toContain("has-[[data-fills-page]]:max-w-none");
  expect(wrapper?.className).toContain("has-[[data-fills-page]]:p-0");
  expect(wrapper?.className).toContain("has-[[data-fills-page]]:w-full");
  styleless();
});

test("the details are a container, so a sheet in them lays out at the aside's width", async () => {
  pageDrawn = () => (
    <DetailsSlot openFirst>
      <p>aside</p>
    </DetailsSlot>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("aside").parentElement?.className).toContain(
    "@container",
  );
  styleless();
});

test("at the desk width the details open beside the page", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot openFirst>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm);
  expect(screen.getByText("page")).toBeDefined();
  expect(screen.getByText("aside")).toBeDefined();
  await pressed("Details");
  expect(screen.queryByText("aside")).toBeNull();
  expect(screen.getByText("page")).toBeDefined();
  styleless();
});

test("under the desk width the details take the middle from the page", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm - 1);
  expect(screen.getByText("page")).toBeDefined();
  await pressed("Details");
  expect(screen.getByText("aside")).toBeDefined();
  const hiddenScroller = screen.getByText("page").closest("[hidden]");
  expect(hiddenScroller).not.toBeNull();
  expect(hiddenScroller?.className ?? "").not.toContain("grid");
  styleless();
});

const heldOwn = threadEntry({
  session: openedSession,
  owner: "geoff",
  mine: true,
  title: "held",
});

/** What the frame offers a reader to change: the bar's way to a new ticket,
 * the pane's New, what is done to a held thread, and the box. */
function offeredToChange(): Record<string, boolean> {
  const named = (role: string, name: string): boolean =>
    screen.queryByRole(role, { name }) !== null;
  return {
    newTicket: named("link", "New ticket"),
    new: named("button", "New"),
    rename: named("button", "Rename"),
    close: named("button", "Close"),
    box: named("textbox", "Message"),
  };
}

function viewOnlySaid(within_: HTMLElement | null): number {
  return within(within_ ?? document.body).queryAllByText("View only").length;
}

test("a reader who may not mutate is told View only once in the bar and once where the first message would be typed", async () => {
  await mounted(
    viewportDeskEm,
    abilitiesFetch({ ...abilitiesNone, dispatch: true }, threadServed([])),
  );
  expect(offeredToChange()).toStrictEqual({
    newTicket: false,
    new: false,
    rename: false,
    close: false,
    box: false,
  });
  expect(viewOnlySaid(navDrawn())).toBe(1);
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  expect(viewOnlySaid(null)).toBe(2);
  styleless();
});

test("a reader who may not mutate keeps a held thread's title and transcript, with View only where its box would be", async () => {
  await mounted(
    viewportDeskEm,
    abilitiesFetch(abilitiesNone, threadServed([heldOwn])),
  );
  expect(screen.getByRole("heading", { name: "held" })).toBeDefined();
  expect(offeredToChange()).toStrictEqual({
    newTicket: false,
    new: false,
    rename: false,
    close: false,
    box: false,
  });
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  for (const kept of ["History", "Full screen", "Collapse"])
    expect(screen.getByRole("button", { name: kept })).toBeDefined();
  styleless();
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered everything that changes a thread, and is told nothing",
  async (_said, abilities) => {
    await mounted(
      viewportDeskEm,
      abilitiesFetch(abilities, threadServed([heldOwn])),
    );
    expect(offeredToChange()).toStrictEqual({
      newTicket: true,
      new: true,
      rename: true,
      close: true,
      box: true,
    });
    expect(viewOnlySaid(null)).toBe(0);
    styleless();
  },
);

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered the first message's box",
  async (_said, abilities) => {
    await mounted(viewportDeskEm, abilitiesFetch(abilities, threadServed([])));
    expect(offeredToChange()).toMatchObject({ new: true, box: true });
    expect(viewOnlySaid(null)).toBe(0);
    styleless();
  },
);

/** One line where the box would be: a reader who could not send with the
 * grant is not told about the grant. */
test("View only stands in place of the hosted grant's line, not beside it", async () => {
  await mounted(
    viewportDeskEm,
    abilitiesFetch(abilitiesNone, grantReadServed(false, [])),
  );
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  cleanup();
  await mounted(
    viewportDeskEm,
    abilitiesFetch(abilitiesNone, grantReadServed(false, [heldOwn])),
  );
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  styleless();
});
