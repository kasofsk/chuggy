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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import {
  threadBody,
  threadEntry,
  threadTranscriptPage,
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
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
});

beforeEach(resizeObserverStubbed);

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

test("under that width it stacks under the pages rather than dividing them", async () => {
  await mounted(viewportTwoColumnEm - 1);
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameTracks()).toContain(
    "grid-rows-[minmax(0,1fr)_var(--height-chat)]",
  );
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

/**
 * A thread just opened is not in the listing yet: the `Session` frame that
 * stales it has not arrived. So the pane holds what the open answered rather
 * than waiting to be told, which is the difference between a reader typing
 * straight away and a reader looking at `No thread`.
 */
test("starting a thread holds it at once, and the box takes the caret", async () => {
  await mounted(viewportDeskEm, threadServed([]));
  expect(screen.getByText("No thread")).toBeDefined();
  await pressed("New");
  expect(screen.queryByText("No thread")).toBeNull();
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
 * both only when the page draws a `role="region"`, so a plain listing keeps
 * its own height and inset instead of losing them. jsdom draws no boxes;
 * this reads the declaration, not the effect. */
test("the page column only stretches its wrapper for a page that fills it", async () => {
  pageDrawn = () => <p>page</p>;
  await mounted(viewportDeskEm);
  const wrapper = screen.getByText("page").parentElement;
  expect(wrapper?.className).toContain("self-start");
  expect(wrapper?.className).toContain("has-[[role=region]]:self-stretch");
  expect(wrapper?.className).toContain("has-[[role=region]]:max-w-none");
  expect(wrapper?.className).toContain("has-[[role=region]]:p-0");
  expect(wrapper?.className).toContain("has-[[role=region]]:w-full");
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
