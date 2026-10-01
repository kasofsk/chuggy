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
import { DetailsSlot, TopBarSlot } from "../app/browser/shell/slots.tsx";
import {
  viewportDeskEm,
  viewportTwoColumnEm,
} from "../app/browser/shell/viewport.ts";
import { chatPaneStoreKey } from "../app/core/chatPane.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { leadBody } from "./leadFixture.ts";
import {
  threadBody,
  threadEntry,
  threadMineSession,
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

async function mounted(em: number, served?: typeof fetch): Promise<void> {
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
      client={new QueryClient()}
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

function composerDrawn(): HTMLElement {
  return screen.getByRole("textbox", { name: "Message" });
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

/** A thread that opens answers the refusal New met before it, so none stands
 * once the grant is given. */
async function grantedAfterRefusal(listed: readonly unknown[]): Promise<void> {
  const server = grantedLaterServed(listed);
  await mounted(viewportDeskEm, server.served);
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
