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
import type { ComponentProps, ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { Shell } from "../app/browser/Shell.tsx";
import { conversationWaitWordAfterMs } from "../app/browser/conversation/ConversationLines.tsx";
import { DetailsSlot, TopBarSlot } from "../app/browser/shell/slots.tsx";
import shellSheet from "../app/browser/shell/shell.css?raw";
import {
  viewportColumnAsideEm,
  viewportNarrowEm,
  viewportTwoColumnEm,
} from "../app/browser/shell/viewport.ts";
import { sessionPlacementResource } from "../app/browser/sessionPlacement.tsx";
import { hostedRunsResource } from "../app/browser/thread/threadSend.tsx";
import {
  chatPanePanels,
  chatPanePlacements,
  chatPaneShareText,
  chatPaneSizes,
  chatPaneSizeStrip,
  chatPaneStoreKey,
  chatPaneTrailDrawn,
  chatPaneTrailAxisEm,
  chatPaneTrailHeld,
  chatPaneTrailMoved,
  chatPaneTrailOffered,
  chatPaneTrailStarted,
} from "../app/core/chatPane.ts";
import type {
  ChatPaneMove,
  ChatPaneOrientation,
  ChatPaneTrail,
  ChatPaneTrailFrame,
} from "../app/core/chatPane.ts";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { seededRandom } from "./seededRandom.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { leadBody } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesFetch,
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
import { sheetConditioned, sheetDeclared, sheetRules } from "./sheet.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import type { ViewportFrame } from "./viewport.ts";
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
import type * as ChatPaneModule from "../app/browser/shell/ChatPane.tsx";
import type * as RouterModule from "@tanstack/react-router";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

let pageDrawn: () => ReactNode = () => null;

/** Called each time the chat pane is drawn, so a case can count its draws. */
let paneDrawn: () => void = () => undefined;

/** The route's parameters, which name a session only on a thread's own page. */
let routeParams: PartitionIdentity & { readonly session?: string } = atlas;

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("../app/browser/shell/ChatPane.tsx", async (importOriginal) => {
  const original = await importOriginal<typeof ChatPaneModule>();
  return {
    ...original,
    ChatPane: (props: ComponentProps<typeof original.ChatPane>) => {
      paneDrawn();
      return <original.ChatPane {...props} />;
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  /** A menu item draws its link through `asChild`, so the double keeps the
   * role, focus and handlers the item hands it, and only the route is
   * dropped. */
  Link: (
    props: ComponentProps<"a"> & {
      readonly to?: unknown;
      readonly params?: unknown;
      readonly activeOptions?: unknown;
    },
  ) => (
    <a
      {...Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => !["to", "params", "activeOptions"].includes(key),
        ),
      )}
      href="/"
    />
  ),
  Outlet: () => pageDrawn(),
  useNavigate: () => () => undefined,
  useParams: () => routeParams,
  /** Copy link asks the router for the address, which these cases do not read. */
  useRouter: () => ({ buildLocation: () => ({ href: "/" }) }),
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
  paneDrawn = () => undefined;
  routeParams = atlas;
  localStorage.clear();
  document.documentElement.style.fontSize = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** The frame mounted, and drawn again where a case has moved the route. */
async function mounted(
  em: number,
  served?: typeof fetch,
  client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  frame: ViewportFrame = {},
): Promise<{ readonly redrawn: () => Promise<void> }> {
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: shellRoute,
  });
  viewportAtEm(em, frame);
  vi.stubGlobal("fetch", served ?? api.fetch);
  const server = openedStream();
  const drawn = (): ReactNode => (
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={server.ports.fetch}
    >
      <Shell partition={atlas} />
    </ScreenHarness>
  );
  const view = render(drawn());
  await settled();
  return {
    redrawn: async () => {
      view.rerender(drawn());
      await settled();
    },
  };
}

function chatDrawn(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Chat" });
}

function navDrawn(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "Console" });
}

/** How the body under the bar is divided: across or down, and its panels and
 * the edge between them in the order they are drawn. */
function frameDivided(): string {
  const group = document.querySelector("[data-group]");
  if (!(group instanceof HTMLElement)) return "";
  const parts = Array.from(group.children, (child) =>
    child.getAttribute("role") === "separator" ? "|" : child.id,
  );
  const axis = group.style.flexDirection === "column" ? "down" : "across";
  return `${axis} ${parts.join(" ")}`;
}

/** The edge between the pages and the pane, which is what the reader drags. */
function edgeDrawn(): HTMLElement {
  return screen.getByRole("separator");
}

/** What the edge says of the pane's share, which a screen reader reads in
 * place of the library's share of the panel before it. */
function edgeText(): string | null {
  return edgeDrawn().getAttribute("aria-valuetext");
}

/** The share of the body the panel before the edge takes, as the edge says. */
function edgeShare(): number {
  return Number(edgeDrawn().getAttribute("aria-valuenow"));
}

/** A size the pane states in `rem`, in the root `em` the frame is stated in. */
function emOf(size: string): number {
  expect(size).toMatch(/rem$/u);
  return Number.parseFloat(size);
}

/** A size the pane states as a share. */
function shareOf(size: string): number {
  expect(size).toMatch(/%$/u);
  return Number.parseFloat(size);
}

/** The share of the body a collapsed pane's strip takes beside the pages. */
function stripShare(em: number): number {
  return (emOf(chatPaneSizeStrip) / em) * 100;
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

/** At the two-column width its default share is narrower than a pane is ever
 * drawn, so it starts at its narrowest instead. */
test("the chat pane sits beside the pages at the two-column width, no narrower than its least", async () => {
  await mounted(viewportTwoColumnEm);
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeDrawn().getAttribute("aria-orientation")).toBe("vertical");
  expect(edgeShare()).toBeCloseTo(
    100 - (emOf(chatPaneSizes.horizontal.chatMin) / viewportTwoColumnEm) * 100,
  );
  styleless();
});

test("at the desk width the pane starts at its default share", async () => {
  await mounted(viewportDeskEm);
  expect(edgeShare()).toBeCloseTo(
    100 - shareOf(chatPaneSizes.horizontal.chatDefault),
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

/** A docked pane under the pages takes a share of every page's height, so a
 * narrow viewport draws the chat over the body under the bar or as the strip,
 * and never stores either. */
test("under that width it starts over the whole body with no full-screen control, and collapsing leaves the strip under the pages", async () => {
  await mounted(viewportTwoColumnEm - 1);
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameDivided()).toBe("across chat-right");
  expect(document.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe(
    "full",
  );
  expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
  styleless();
  await pressed("Collapse");
  expect(chatDrawn()).toBeNull();
  expect(frameDivided()).toBe("down pages | chat-bottom");
  expect(edgeDrawn().getAttribute("aria-orientation")).toBe("horizontal");
  await pressed("Expand chat");
  expect(frameDivided()).toBe("across chat-right");
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
  styleless();
});

/** What a desk stored is kept for the desk: a narrow viewport opens the pane
 * whole however it was left, writes nothing over it, and a desk draws it as
 * stored again. */
test("under that width a pane stored docked or full opens over the whole body, and widened is drawn as stored", async () => {
  for (const presentation of ["Docked", "Full"]) {
    const stored = JSON.stringify({ placement: "Left", presentation });
    localStorage.setItem(chatPaneStoreKey, stored);
    const frame = await mounted(viewportTwoColumnEm - 1);
    expect(frameDivided(), presentation).toBe("across chat-right");
    await pressed("Collapse");
    await pressed("Expand chat");
    expect(localStorage.getItem(chatPaneStoreKey), presentation).toBe(stored);
    viewportAtEm(viewportDeskEm);
    await frame.redrawn();
    expect(frameDivided(), presentation).toBe(
      presentation === "Docked"
        ? "across chat-left | pages"
        : "across chat-left",
    );
    cleanup();
  }
  styleless();
});

/** The strip under the pages is put away for the page's life only, so a
 * reload opens the pane whole again. */
test("under that width a reload after a collapse opens the pane over the whole body", async () => {
  await mounted(viewportTwoColumnEm - 1);
  await pressed("Collapse");
  expect(frameDivided()).toBe("down pages | chat-bottom");
  cleanup();
  await mounted(viewportTwoColumnEm - 1);
  expect(frameDivided()).toBe("across chat-right");
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
  styleless();
});

/** The strip's glyph follows where it is drawn, which on a narrow viewport is
 * under the pages whatever placement the reader stored. */
test("under that width the strip draws a vertical glyph, and is named Chat", async () => {
  await mounted(viewportTwoColumnEm - 1);
  await pressed("Collapse");
  const glyph = Array.from(
    screen
      .getByRole("button", { name: "Expand chat" })
      .querySelectorAll("path"),
    (path) => path.getAttribute("d"),
  ).join(" ");
  expect(glyph).toContain("M3 15h18M9 10l3-3 3 3");
  expect(
    screen.getByRole("button", { name: "Expand chat" }).textContent,
  ).toContain("Chat");
  styleless();
});

/** Each icon control's hidden name is also what a pointer or a keyboard focus
 * reveals, so a reader who does not use a screen reader learns what New, Full
 * screen, Exit full screen and Collapse do before pressing them. */
test("the pane's icon controls name themselves again on focus", async () => {
  await mounted(viewportDeskEm);
  await tooltipNamed("New");
  await tooltipNamed("Full screen");
  await tooltipNamed("Collapse");
  await pressed("Full screen");
  await tooltipNamed("Exit full screen");
  styleless();
});

test("collapsing leaves a strip whose own control expands it again", async () => {
  await mounted(viewportDeskEm);
  await pressed("Collapse");
  expect(chatDrawn()).toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  styleless();
  await pressed("Expand chat");
  expect(chatDrawn()).not.toBeNull();
  expect(edgeShare()).toBeCloseTo(75);
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
  expect(frameDivided()).toBe("across chat-right");
  styleless();
  await pressed("Exit full screen");
  expect(navDrawn()).not.toBeNull();
  expect(frameDivided()).toBe("across pages | chat-right");
  styleless();
});

test("a collapsed pane goes straight to full screen and back to its column", async () => {
  await mounted(viewportDeskEm);
  await pressed("Collapse");
  await pressed("Expand chat");
  await pressed("Full screen");
  expect(frameDivided()).toBe("across chat-right");
  await pressed("Exit full screen");
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeShare()).toBeCloseTo(75);
  styleless();
});

/** A pointer event this many pixels from where the edge was pressed, along
 * the axis the frame divides. */
function edgePointer(
  type: string,
  byPx: number,
  options: {
    readonly at: DOMRect;
    readonly vertical: boolean;
    readonly buttons: number;
  },
): PointerEvent {
  const { at } = options;
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: options.buttons,
    clientX: at.left + at.width / 2 + (options.vertical ? 0 : byPx),
    clientY: at.top + at.height / 2 + (options.vertical ? byPx : 0),
    pointerId: 1,
    pointerType: "mouse",
  });
}

/** The edge dragged by a pointer this many pixels: pressed where the edge is
 * drawn, moved, and let go. */
async function edgePulled(byPx: number, vertical: boolean): Promise<void> {
  const edge = edgeDrawn();
  const along = { at: edge.getBoundingClientRect(), vertical };
  const held = edgePointer("pointerdown", 0, { ...along, buttons: 1 });
  const moved = edgePointer("pointermove", byPx, { ...along, buttons: 1 });
  const released = edgePointer("pointerup", byPx, { ...along, buttons: 0 });
  await turned(() => {
    edge.dispatchEvent(held);
    document.dispatchEvent(moved);
    document.dispatchEvent(released);
  });
  await settled();
}

/** The edge across the frame dragged this far, in the root `em` the frame is
 * stated in. */
async function edgeDragged(byEm: number): Promise<void> {
  await edgePulled(byEm * 16, false);
}

async function edgeKeyed(key: string): Promise<void> {
  await turned(() => {
    edgeDrawn().focus();
    fireEvent.keyDown(edgeDrawn(), { key });
  });
  await settled();
}

test("the edge is a separator a keyboard moves, and a reload draws it where the reader left it", async () => {
  await mounted(viewportDeskEm);
  expect(edgeDrawn().tabIndex).toBe(0);
  const before = edgeShare();
  await edgeKeyed("ArrowLeft");
  const moved = edgeShare();
  expect(moved).toBeLessThan(before);
  expect(chatDrawn()).not.toBeNull();
  cleanup();
  await mounted(viewportDeskEm);
  expect(edgeShare()).toBeCloseTo(moved);
  styleless();
});

/** The library says whether the edge is hovered or held, and the sheet says
 * it to the reader. */
test("the edge is a hairline in the edge's colour, and the stronger one while hovered or held", async () => {
  await mounted(viewportDeskEm);
  const rules = sheetRules(shellSheet, []);
  const edge = edgeDrawn();
  expect(sheetDeclared(rules, edge, "width")).toBe("var(--hairline)");
  expect(sheetDeclared(rules, edge, "background")).toBe("var(--edge)");
  for (const state of ["hover", "active"]) {
    edge.setAttribute("data-separator", state);
    expect(sheetDeclared(rules, edge, "background")).toBe("var(--edge-strong)");
  }
  styleless();
});

test("the edge under the pages is a hairline across the frame", async () => {
  await mounted(viewportTwoColumnEm - 1);
  await pressed("Collapse");
  const edge = edgeDrawn();
  expect(edge.getAttribute("aria-orientation")).toBe("horizontal");
  expect(sheetDeclared(sheetRules(shellSheet, []), edge, "height")).toBe(
    "var(--hairline)",
  );
  styleless();
});

/** The edge is drawn over both panels, so the ring a keyboard's focus gives it
 * is cut by neither. Whether jsdom counts a focus as a keyboard's depends on
 * what an earlier case pressed, so the ring is read from its own rule. */
test("the edge is drawn over both panels, and a keyboard's focus rings it", async () => {
  await mounted(viewportDeskEm);
  const rules = sheetRules(shellSheet, []);
  const edge = edgeDrawn();
  expect(sheetDeclared(rules, edge, "position")).toBe("relative");
  expect(sheetDeclared(rules, edge, "z-index")).toBe("1");
  expect(sheetDeclared(rules, edge, "box-shadow")).toBe("");
  const ring = rules.find(
    (rule) => rule.selectorText === ".chat-separator:focus-visible",
  );
  expect(ring?.style.getPropertyValue("box-shadow")).toBe("var(--ring-focus)");
  expect(ring?.style.getPropertyValue("border-radius")).toBe("0px");
  styleless();
});

/** What the sheet gives each part of the open pane for its visibility while
 * the panel is under the pane's least width, at the least's own number and in
 * any container query. */
function paneUnderLeast(): readonly (readonly string[])[] {
  const least = Number.parseFloat(chatPaneSizes.horizontal.chatMin);
  const queried = sheetRules(shellSheet, [`(max-width: ${least}em)`]);
  const contained = sheetConditioned(shellSheet, CSSContainerRule);
  return Array.from(chatDrawn()?.children ?? [], (part) =>
    [queried, contained].map((rules) =>
      sheetDeclared(rules, part, "visibility"),
    ),
  );
}

/** Beside the pages the panel is under the pane's least only while a drag
 * into the strip is held; over the whole body no edge is drawn to hold. */
test("beside the pages a panel under the pane's least draws none of it, and over the whole body it does", async () => {
  paneDocked();
  const frame = await mounted(viewportDeskEm);
  const hidden = ["hidden", "hidden"];
  expect(paneUnderLeast()).toEqual([hidden, hidden]);
  const media = sheetConditioned(shellSheet, CSSMediaRule);
  for (const part of chatDrawn()?.children ?? [])
    for (const rules of [sheetRules(shellSheet, []), media])
      expect(sheetDeclared(rules, part, "visibility")).toBe("");
  viewportAtEm(viewportTwoColumnEm - 1, {});
  await frame.redrawn();
  expect(frameDivided()).toBe("across chat-right");
  expect(paneUnderLeast()).toEqual([
    ["", ""],
    ["", ""],
  ]);
  styleless();
});

/** The pane's sheets read its width rather than the screen's: the rule above
 * and the composer's inset both ask the panel the pane is drawn in. */
test("the pane is drawn in a container, so its sheets lay out at the pane's width", async () => {
  await mounted(viewportDeskEm);
  expect(chatDrawn()?.parentElement?.classList.contains("@container")).toBe(
    true,
  );
  styleless();
});

/** The edge is named for the pane it sizes, as the gear names where it sits,
 * and says the pane's own share wherever the pane sits. */
test("the edge is named for the pane it sizes, and says the pane's share", async () => {
  await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameTallEm,
  });
  const edge = screen.getByRole("separator", { name: "Chat size" });
  expect(edge).toBe(edgeDrawn());
  expect(edgeShare()).toBeCloseTo(
    100 - shareOf(chatPaneSizes.horizontal.chatDefault),
  );
  expect(edgeText()).toBe(chatPaneSizes.horizontal.chatDefault);
  await panePlaced("Bottom");
  expect(edgeShare()).toBeCloseTo(pagesOverDefaultShare());
  expect(edgeText()).toBe(
    `${String(Math.round(100 - pagesOverDefaultShare()))}%`,
  );
  await panePlaced("Left");
  expect(edgeText()).toBe(chatPaneSizes.horizontal.chatDefault);
  styleless();
});

test("a drag widens the pane, and the edge says how far it went", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(-10);
  const pane =
    shareOf(chatPaneSizes.horizontal.chatDefault) + (10 / viewportDeskEm) * 100;
  expect(edgeShare()).toBeCloseTo(100 - pane);
  expect(edgeText()).toBe(`${String(Math.round(pane))}%`);
  expect(localStorage.getItem(chatPaneStoreKey)).toBeNull();
  styleless();
});

/** The group tells the shell each layout as it lays it, so the edge says the
 * pane's share while the pointer still holds it and not only once let go. */
test("the edge says the pane's share while a drag is held", async () => {
  await mounted(viewportDeskEm);
  const edge = edgeDrawn();
  const across = {
    at: edge.getBoundingClientRect(),
    vertical: false,
    buttons: 1,
  };
  await turned(() => {
    edge.dispatchEvent(edgePointer("pointerdown", 0, across));
    document.dispatchEvent(edgePointer("pointermove", -8 * 16, across));
  });
  await settled();
  expect(edgeText()).toBe("35%");
  await turned(() => {
    document.dispatchEvent(edgePointer("pointermove", -16 * 16, across));
  });
  await settled();
  expect(edgeText()).toBe("45%");
  await turned(() => {
    document.dispatchEvent(
      edgePointer("pointerup", -16 * 16, { ...across, buttons: 0 }),
    );
  });
  await settled();
  expect(edgeText()).toBe("45%");
  styleless();
});

/** A drag moves the presentation when it is let go, so a drag held into the
 * strip leaves the pane there, still docked, and nothing puts it back open
 * while the pointer holds it. */
test("a drag held into the strip leaves the pane there, docked, until it is let go", async () => {
  paneDocked();
  await mounted(viewportDeskEm);
  const edge = edgeDrawn();
  const across = {
    at: edge.getBoundingClientRect(),
    vertical: false,
    buttons: 1,
  };
  const toStrip = viewportDeskEm * 16;
  await turned(() => {
    edge.dispatchEvent(edgePointer("pointerdown", 0, across));
    document.dispatchEvent(edgePointer("pointermove", toStrip, across));
  });
  await settled();
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  expect(chatDrawn()).not.toBeNull();
  expect(localStorage.getItem(chatPaneStoreKey)).toContain('"Docked"');
  await turned(() => {
    document.dispatchEvent(
      edgePointer("pointerup", toStrip, { ...across, buttons: 0 }),
    );
  });
  await settled();
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  expect(localStorage.getItem(chatPaneStoreKey)).toContain('"Collapsed"');
  styleless();
});

/** The library would size the pane back to its default on a double click,
 * and store nothing of it; the reader's width is what the edge holds. */
test("a double click on the edge leaves the pane at the width the reader dragged it to", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(-8);
  const dragged = edgeShare();
  const at = edgeDrawn().getBoundingClientRect();
  await turned(() => {
    fireEvent.doubleClick(edgeDrawn(), {
      clientX: at.left,
      clientY: at.top + at.height / 2,
    });
  });
  await settled();
  expect(edgeShare()).toBeCloseTo(dragged);
  styleless();
});

/** What the reader dragged is kept for the page's life even where the browser
 * keeps nothing, so the control collapsing the pane and expanding it again
 * gives back their width after a move to the other side and back. */
test("a store the browser refuses still expands the pane to the width dragged on the page", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("refused");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("refused");
  });
  await mounted(viewportDeskEm);
  await edgeDragged(-8);
  const dragged = edgeShare();
  await pressed("Collapse");
  await panePlaced("Left");
  await panePlaced("Right");
  await pressed("Expand chat");
  expect(edgeShare()).toBeCloseTo(dragged);
  styleless();
});

/** A width stored on a wide window can be under the threshold the library
 * collapses at on a narrow one, and a docked pane is never left at the strip. */
test("a stored width the window has grown too narrow for expands the pane to its least", async () => {
  const wide = 200;
  const frame = await mounted(wide);
  await edgeDragged(30);
  expect(edgeShare()).toBeCloseTo(
    100 - (emOf(chatPaneSizes.horizontal.chatMin) / wide) * 100,
  );
  await pressed("Collapse");
  viewportAtEm(viewportTwoColumnEm, {});
  await frame.redrawn();
  await pressed("Expand chat");
  expect(chatDrawn()).not.toBeNull();
  expect(edgeShare()).toBeCloseTo(
    100 - (emOf(chatPaneSizes.horizontal.chatMin) / viewportTwoColumnEm) * 100,
  );
  styleless();
});

/** The library refuses a layout for panels it is not dividing, so one stored
 * under these panels' name that divides others is read as none stored. */
test("a layout stored for other panels expands the pane to its default", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(-8);
  const written = Array.from({ length: localStorage.length }, (_each, at) =>
    localStorage.key(at),
  ).filter((key) => key !== null && key !== chatPaneStoreKey);
  expect(written).toHaveLength(1);
  localStorage.setItem(
    written[0] ?? "",
    JSON.stringify({ pages: 60, chat: 40 }),
  );
  await pressed("Collapse");
  await pressed("Expand chat");
  expect(edgeShare()).toBeCloseTo(
    100 - shareOf(chatPaneSizes.horizontal.chatDefault),
  );
  styleless();
});

/** Neither panel is handed anything a drag changes, so neither the page nor
 * the conversation is drawn again while the edge moves; the column left stays
 * wide enough that the details have no reason to redraw the page either. */
test("a drag draws neither the page nor the conversation again", async () => {
  const drawn = { page: 0, pane: 0 };
  pageDrawn = () => {
    drawn.page += 1;
    return null;
  };
  paneDrawn = () => {
    drawn.pane += 1;
  };
  await mounted(viewportDeskEm + 40);
  const before = { ...drawn };
  await edgeDragged(-6);
  await edgeDragged(-6);
  expect(edgeText()).toBe("35%");
  expect(drawn).toStrictEqual(before);
  styleless();
});

/** The library holds a default narrower than the least at the least, and the
 * pane's own control expands it there too. */
test("a pane whose default is narrower than its least opens and expands at its least", async () => {
  const viewportEm = 64;
  await mounted(viewportEm);
  const least =
    100 - (emOf(chatPaneSizes.horizontal.chatMin) / viewportEm) * 100;
  expect(shareOf(chatPaneSizes.horizontal.chatDefault)).toBeLessThan(
    100 - least,
  );
  expect(edgeShare()).toBeCloseTo(least);
  await pressed("Collapse");
  await pressed("Expand chat");
  expect(edgeShare()).toBeCloseTo(least);
  styleless();
});

/** The strip is what the pane's own control leaves, so a drag that leaves the
 * same is the same move, and the stored presentation says so. */
test("a drag past the pane's narrowest collapses it to the strip, and dragging the strip out expands it", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(15);
  expect(chatDrawn()).toBeNull();
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeDefined();
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Collapsed");
  await edgeDragged(-25);
  expect(chatDrawn()).not.toBeNull();
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Docked");
  styleless();
});

test("the keyboard collapses the pane at the edge's end and expands it from the other", async () => {
  await mounted(viewportDeskEm);
  await edgeKeyed("End");
  expect(chatDrawn()).toBeNull();
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Collapsed");
  await edgeKeyed("Home");
  expect(chatDrawn()).not.toBeNull();
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Docked");
  styleless();
});

/** The pane takes the frame only by Full screen, so the edge moved as far as
 * it goes toward the pages leaves them their least. */
test("the edge moved all the way toward the pages leaves them their least", async () => {
  await mounted(viewportDeskEm);
  await edgeKeyed("Home");
  expect(edgeShare()).toBeCloseTo(
    (emOf(chatPaneSizes.horizontal.pagesMin) / viewportDeskEm) * 100,
  );
  expect(chatDrawn()).not.toBeNull();
  styleless();
});

/** A layout is stored only when the reader makes it, so collapsing by the
 * control leaves the width they dragged to be expanded to after a reload. */
test("after a reload Expand restores the width the reader dragged before collapsing by the control", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(-10);
  const dragged = edgeShare();
  await pressed("Collapse");
  cleanup();
  await mounted(viewportDeskEm);
  expect(chatDrawn()).toBeNull();
  await pressed("Expand chat");
  expect(edgeShare()).toBeCloseTo(dragged);
  styleless();
});

/** The pane is as wide as the reader left it, so a window made wider gives
 * the pages the difference. */
test("a window resized leaves the pane its width and gives the pages the difference", async () => {
  await mounted(viewportDeskEm);
  const pane =
    (shareOf(chatPaneSizes.horizontal.chatDefault) / 100) * viewportDeskEm;
  const wider = viewportDeskEm + 20;
  viewportAtEm(wider, {});
  await settled();
  expect(edgeShare()).toBeCloseTo(100 - (pane / wider) * 100);
  styleless();
});

/** A reload draws what was stored, and a stored strip is the strip whatever
 * width the layout was last left at. */
test("a pane stored collapsed is drawn as the strip, and expanding it restores a share", async () => {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Collapsed" }),
  );
  await mounted(viewportDeskEm);
  expect(chatDrawn()).toBeNull();
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  await pressed("Expand chat");
  expect(chatDrawn()).not.toBeNull();
  expect(edgeShare()).toBeCloseTo(75);
  styleless();
});

/** A browser that refuses the store is drawn the default, as a reader who
 * never moved the edge is. */
test("a store the browser refuses still draws the pane at its default share", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("refused");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("refused");
  });
  await mounted(viewportDeskEm);
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeShare()).toBeCloseTo(75);
  await edgeKeyed("ArrowLeft");
  expect(edgeShare()).toBeLessThan(75);
  styleless();
});

/** The page under the pane is not drawn again when the pane is put away and
 * brought back, so what the reader typed into it is still there. */
test("collapsing and expanding the pane, by its control or a drag, leaves the page as the reader left it", async () => {
  pageDrawn = () => <input aria-label="Draft" />;
  await mounted(viewportDeskEm);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  draft.value = "half a thought";
  await pressed("Collapse");
  await pressed("Expand chat");
  await edgeDragged(15);
  await edgeDragged(-25);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft.value).toBe("half a thought");
  styleless();
});

/** The pane outlives the pages leaving and returning, so what the reader was
 * writing in it outlives a full screen. */
test("filling the frame and leaving it keeps the pane and what is typed in it", async () => {
  await mounted(viewportDeskEm);
  const pane = chatDrawn();
  fireEvent.change(composerDrawn(), { target: { value: "half a thought" } });
  await pressed("Full screen");
  expect(chatDrawn()).toBe(pane);
  await pressed("Exit full screen");
  expect(chatDrawn()).toBe(pane);
  expect(composerDrawn().value).toBe("half a thought");
  styleless();
});

/** The pane is keyed by what it is, not by where it sits, so moving it to the
 * other side and under the pages leaves it mounted, holding what was typed. */
test("moving the pane to the other side and under the pages keeps it and what is typed in it", async () => {
  await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameTallEm,
  });
  const pane = chatDrawn();
  fireEvent.change(composerDrawn(), { target: { value: "half a thought" } });
  for (const placement of ["Left", "Bottom", "Right"]) {
    await panePlaced(placement);
    expect(chatDrawn(), placement).toBe(pane);
  }
  expect(composerDrawn().value).toBe("half a thought");
  styleless();
});

/** The column the pane leaves is what the details ask, so the same viewport
 * draws them as the middle beside a docked pane and as an aside once the pane
 * is put away. */
test("the details read the column the pane leaves, not the viewport", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm);
  await pressed("Details");
  expect(screen.getByText("page").closest("[hidden]")).not.toBeNull();
  await pressed("Collapse");
  expect(screen.getByText("aside")).toBeDefined();
  expect(screen.getByText("page").closest("[hidden]")).toBeNull();
  styleless();
});

/** A reader pressing for a screen is asking to see it, and a pane still over
 * the whole body would answer by drawing the chat again. */
test("pressing a screen puts a filled pane back beside the pages", async () => {
  await mounted(viewportDeskEm);
  await pressed("Full screen");
  expect(frameDivided()).toBe("across chat-right");
  await turned(() => {
    screen.getByRole("link", { name: /Inbox/u }).click();
  });
  await settled();
  expect(frameDivided()).toBe("across pages | chat-right");
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
  expect(chatDrawn()).toBeNull();
  expect(edgeShare()).toBeCloseTo(100 - stripShare(viewportDeskEm));
  styleless();
});

function paneDocked(): void {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Docked" }),
  );
}

/** On a phone the chat starts over the whole body, and the bar stays over
 * it, so every screen is still one press away. */
test("on a phone a full screen keeps the banner and the bar, and pressing a screen draws it", async () => {
  pageDrawn = () => <p>the screen</p>;
  paneDocked();
  await mounted(viewportNarrowEm - 1);
  expect(frameDivided()).toBe("across chat-right");
  expect(chatDrawn()).not.toBeNull();
  expect(navDrawn()).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Settings" })).not.toBeNull();
  expect(document.querySelector(".shell-banner")).not.toBeNull();
  expect(screen.queryByText("the screen")).toBeNull();
  await turned(() => {
    screen.getByRole("link", { name: /Inbox/u }).click();
  });
  await settled();
  expect(frameDivided()).toBe("down pages | chat-bottom");
  expect(chatDrawn()).toBeNull();
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeDefined();
  expect(screen.getByText("the screen")).toBeDefined();
  expect(navDrawn()).not.toBeNull();
  expect(localStorage.getItem(chatPaneStoreKey)).toBe(
    JSON.stringify({ placement: "Right", presentation: "Docked" }),
  );
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
  expect(frameDivided()).toBe("across chat-left | pages");
  expect(edgeShare()).toBeCloseTo(25);
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Left");
  styleless();
});

/** Where the pane sits is a choice of side, not of whether it is put away. */
test("repositioning a collapsed pane keeps it the strip", async () => {
  localStorage.setItem(
    chatPaneStoreKey,
    JSON.stringify({ placement: "Right", presentation: "Collapsed" }),
  );
  await mounted(viewportDeskEm);
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeDefined();
  await panePlaced("Left");
  expect(frameDivided()).toBe("across chat-left | pages");
  expect(edgeShare()).toBeCloseTo(stripShare(viewportDeskEm));
  expect(localStorage.getItem(chatPaneStoreKey)).toContain("Collapsed");
  expect(screen.getByRole("button", { name: "Expand chat" })).toBeDefined();
  styleless();
});

/** The pane's panel is named for the side it sits on, so each side keeps the
 * width the reader left it at there. */
test("each side the pane sits on keeps its own width", async () => {
  await mounted(viewportDeskEm);
  await edgeDragged(-10);
  const right = edgeShare();
  await panePlaced("Left");
  expect(edgeShare()).toBeCloseTo(
    shareOf(chatPaneSizes.horizontal.chatDefault),
  );
  await panePlaced("Right");
  expect(edgeShare()).toBeCloseTo(right);
  styleless();
});

/** The pages are keyed by what they are, not where they sit, so the pane moving
 * to the other side of them leaves the page drawn once. */
test("a page outlives the pane moving to the other side of it and back", async () => {
  pageDrawn = () => <input aria-label="Draft" />;
  await mounted(viewportDeskEm);
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  draft.value = "half a thought";
  await panePlaced("Left");
  expect(frameDivided()).toBe("across chat-left | pages");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  await panePlaced("Right");
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft.value).toBe("half a thought");
  styleless();
});

/** The frame's height in these cases, which a pane under the pages divides,
 * and one a fifth as tall. */
const frameTallEm = 50;
const frameShortEm = frameTallEm / 5;

/** The share of the frame's height the pages keep above a pane at its
 * default height. */
function pagesOverDefaultShare(): number {
  return 100 - (emOf(chatPaneSizes.vertical.chatDefault) / frameTallEm) * 100;
}

/** A share of the width says nothing about a share of the height, so a pane
 * moved under the pages takes its own height there, and back beside them its
 * own width; the page between is drawn once through both. */
test("a pane moved under the pages takes its own height there, and its own width back beside them", async () => {
  pageDrawn = () => <input aria-label="Draft" />;
  await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameTallEm,
  });
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  draft.value = "half a thought";
  await panePlaced("Bottom");
  expect(frameDivided()).toBe("down pages | chat-bottom");
  expect(edgeShare()).toBeCloseTo(pagesOverDefaultShare());
  await panePlaced("Right");
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeShare()).toBeCloseTo(
    100 - shareOf(chatPaneSizes.horizontal.chatDefault),
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft.value).toBe("half a thought");
  styleless();
});

test("a pane moved back under the pages takes the height the reader left it at there", async () => {
  await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameTallEm,
  });
  await panePlaced("Bottom");
  await edgeKeyed("ArrowUp");
  const under = edgeShare();
  expect(under).toBeLessThan(pagesOverDefaultShare());
  await panePlaced("Right");
  await panePlaced("Bottom");
  expect(edgeShare()).toBeCloseTo(under);
  styleless();
});

/** Under the pages the pane's bounds are shares, so it keeps its share as the
 * frame's height changes: a frame grown taller does not carry a pane near its
 * least under it into the strip, and one grown shorter does not crowd the
 * pages. */
test("a pane under the pages keeps its share, open, as the frame grows taller and shorter again", async () => {
  const frame = await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameShortEm,
  });
  await panePlaced("Bottom");
  const least = shareOf(chatPaneSizes.vertical.chatMin) + 2;
  await edgePulled(
    ((100 - edgeShare() - least) / 100) * frameShortEm * 16,
    true,
  );
  expect(edgeShare()).toBeCloseTo(100 - least);
  for (const heightEm of [frameTallEm, frameShortEm]) {
    viewportAtEm(viewportDeskEm, { heightEm });
    await frame.redrawn();
    expect(edgeShare(), `at ${String(heightEm)}em`).toBeCloseTo(100 - least);
    expect(chatDrawn(), `at ${String(heightEm)}em`).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Expand chat" })).toBeNull();
    expect(localStorage.getItem(chatPaneStoreKey)).toContain('"Docked"');
  }
  styleless();
});

/** A pane on the right and one under the pages draw their panels in the same
 * order, and the pane's is named for where it sits, so what the group keeps
 * for the one is not laid for the other. */
test("a pane moved under the pages, then left, then back right keeps its right width", async () => {
  await mounted(viewportDeskEm, undefined, undefined, {
    heightEm: frameTallEm,
  });
  await edgeDragged(-10);
  const right = edgeShare();
  await panePlaced("Bottom");
  const bottom = edgeShare();
  await panePlaced("Left");
  const left = edgeShare();
  await panePlaced("Right");
  expect(frameDivided()).toBe("across pages | chat-right");
  expect({ right, bottom, left, back: edgeShare() }).toEqual({
    right,
    bottom,
    left,
    back: right,
  });
  styleless();
});

/** Each place the pane sits stores its own layout, so a height dragged under
 * the pages is not what a reload draws beside them. */
test("a width dragged beside the pages and a height dragged under them are each drawn again after a reload", async () => {
  const frame = { heightEm: frameTallEm };
  await mounted(viewportDeskEm, undefined, undefined, frame);
  await edgeDragged(-10);
  const right = edgeShare();
  await panePlaced("Bottom");
  await edgeKeyed("ArrowUp");
  const under = edgeShare();
  await panePlaced("Right");
  cleanup();
  await mounted(viewportDeskEm, undefined, undefined, frame);
  expect(edgeShare()).toBeCloseTo(right);
  await panePlaced("Bottom");
  expect(edgeShare()).toBeCloseTo(under);
  styleless();
});

/** A viewport narrowing past the two-column width stacks the strip the reader
 * left there under the pages, and draws the page once through it. */
test("a page outlives the viewport narrowing past the two-column width", async () => {
  paneDocked();
  pageDrawn = () => <input aria-label="Draft" />;
  const frame = await mounted(viewportTwoColumnEm - 1, undefined, undefined, {
    heightEm: frameTallEm,
  });
  await pressed("Collapse");
  viewportAtEm(viewportDeskEm, { heightEm: frameTallEm });
  await frame.redrawn();
  expect(frameDivided()).toBe("across pages | chat-right");
  const draft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Draft",
  });
  draft.value = "half a thought";
  viewportAtEm(viewportTwoColumnEm - 1, { heightEm: frameTallEm });
  await frame.redrawn();
  expect(frameDivided()).toBe("down pages | chat-bottom");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft.value).toBe("half a thought");
  styleless();
});

/** The pages drawn alone on a thread's own page divide nothing, so a viewport
 * widened there leaves the strip under the pages to be laid beside them on the
 * way back. */
test("a viewport widened on a thread's own page lays the pane beside the pages on the way back", async () => {
  paneDocked();
  const frame = await mounted(viewportTwoColumnEm - 1, undefined, undefined, {
    heightEm: frameTallEm,
  });
  await pressed("Collapse");
  expect(frameDivided()).toBe("down pages | chat-bottom");
  routeParams = { ...atlas, session: threadMineSession };
  await frame.redrawn();
  expect(frameDivided()).toBe("across pages");
  viewportAtEm(viewportDeskEm, { heightEm: frameTallEm });
  await frame.redrawn();
  routeParams = atlas;
  await frame.redrawn();
  expect(frameDivided()).toBe("across pages | chat-right");
  expect(edgeShare()).toBeCloseTo(
    100 - shareOf(chatPaneSizes.horizontal.chatDefault),
  );
  styleless();
});

/** The frame a walk starts in: a desk's width, one too narrow to divide that
 * still keeps the bar, and a desk's height. */
const walkFrame: ChatPaneTrailFrame = {
  wideEm: viewportDeskEm,
  narrowEm: viewportTwoColumnEm - 10,
  heightEm: frameTallEm,
};

/** The shares a walk drags the pane to along each axis: open ones, one past
 * the most, and none, which is the strip; under the pages, one just over the
 * least. */
const walkShares: Readonly<Record<ChatPaneOrientation, readonly number[]>> = {
  horizontal: [30, 40, 50, 60, 70, 95, 0],
  vertical: [35, 40, 55, 60, 70, 80, 96, 0],
};

/** How short and how tall a walk draws the frame: short enough that the strip
 * under the pages is over the pane's least, and taller than a desk. */
const walkHeightLeastEm = 5;
const walkHeightMostEm = 90;
const walkHeightSteps = 48;

/** The heights a walk draws the frame at, as many in each doubling and on
 * quarters of an `em`, so a frame a few strips tall is drawn as often as a
 * desk's. It leaves out a height at which the strip is as tall as a share the
 * walk drags the pane open to, since the library tells the strip by its size
 * alone and a reader never lands an edge on it to the pixel. */
const walkHeightsEm: readonly number[] = [
  ...new Set(
    Array.from({ length: walkHeightSteps + 1 }, (_, step) => {
      const ratio = walkHeightMostEm / walkHeightLeastEm;
      const heightEm = walkHeightLeastEm * ratio ** (step / walkHeightSteps);
      return Math.round(heightEm * 4) / 4;
    }),
  ),
].filter((heightEm) =>
  walkShares.vertical.every(
    (share) => Math.abs(stripShare(heightEm) - share) > 0.001,
  ),
);

type WalkMounted = Awaited<ReturnType<typeof mounted>>;

/** The viewport a trail's frame is drawn in. */
function walkViewport(trail: ChatPaneTrail): readonly [number, ViewportFrame] {
  return [
    chatPaneTrailAxisEm(trail, "horizontal"),
    { heightEm: chatPaneTrailAxisEm(trail, "vertical") },
  ];
}

function walkMounted(trail: ChatPaneTrail): Promise<WalkMounted> {
  const [em, frame] = walkViewport(trail);
  return mounted(em, undefined, undefined, frame);
}

function walkPicked<T>(among: readonly T[], random: () => number): T {
  const picked = among[Math.floor(random() * among.length)];
  if (picked === undefined) throw new Error("a walk picked among nothing");
  return picked;
}

/** The move a walk makes next, among those the frame offers. */
function walkMove(trail: ChatPaneTrail, random: () => number): ChatPaneMove {
  const drawn = chatPaneTrailDrawn(trail);
  const move = walkPicked(chatPaneTrailOffered(trail), random);
  if (move === "Placed") {
    const held = chatPaneTrailHeld(trail).placement;
    const others = chatPanePlacements.filter((placement) => placement !== held);
    return { move, placement: walkPicked(others, random) };
  }
  if (move === "Dragged") {
    const shares = walkShares[drawn.orientation].filter(
      (share) => share !== drawn.share,
    );
    return { move, share: walkPicked(shares, random) };
  }
  if (move === "Resized") {
    const heights = walkHeightsEm.filter(
      (heightEm) => heightEm !== trail.heightEm,
    );
    return { move, heightEm: walkPicked(heights, random) };
  }
  return { move };
}

/** The edge dragged until the pane takes this share of the frame along its
 * axis, from the share the trail says it takes now. */
async function walkDragged(trail: ChatPaneTrail, share: number): Promise<void> {
  const drawn = chatPaneTrailDrawn(trail);
  const vertical = drawn.orientation === "vertical";
  const axisEm = chatPaneTrailAxisEm(trail, drawn.orientation);
  const toward = drawn.panels[0] === chatPanePanels.pages ? -1 : 1;
  const by = ((share - (drawn.share ?? 0)) / 100) * axisEm * 16;
  await edgePulled(by * toward, vertical);
}

/** A trip to a thread's own page and back. */
async function walkVisited(frame: WalkMounted): Promise<void> {
  routeParams = { ...atlas, session: threadMineSession };
  await frame.redrawn();
  routeParams = atlas;
  await frame.redrawn();
}

/** The window resized to the frame a trail is drawn in. */
async function walkResized(
  trail: ChatPaneTrail,
  frame: WalkMounted,
): Promise<WalkMounted> {
  viewportAtEm(...walkViewport(trail));
  await frame.redrawn();
  return frame;
}

/** The move made on the mounted frame, by the control a reader would use. */
async function walkApplied(
  move: ChatPaneMove,
  trail: ChatPaneTrail,
  frame: WalkMounted,
): Promise<WalkMounted> {
  switch (move.move) {
    case "Placed":
      await panePlaced(move.placement);
      return frame;
    case "Collapsed":
      await pressed("Collapse");
      return frame;
    case "Expanded":
      await pressed("Expand chat");
      return frame;
    case "Filled":
      await pressed("Full screen");
      return frame;
    case "Restored":
      await pressed("Exit full screen");
      return frame;
    case "Narrowed":
    case "Widened":
    case "Resized":
      return walkResized(chatPaneTrailMoved(trail, move), frame);
    case "Visited":
      await walkVisited(frame);
      return frame;
    case "Reloaded":
      cleanup();
      return walkMounted(trail);
    case "Dragged":
      await walkDragged(trail, move.share);
      return frame;
  }
}

/** The frame as the trail says it is drawn: its panels and axis, the pane's
 * presentation and stored state, and the pane's share as the edge's value and
 * its text say it. */
function walkChecked(trail: ChatPaneTrail, where: string): void {
  const drawn = chatPaneTrailDrawn(trail);
  const axis = drawn.orientation === "vertical" ? "down" : "across";
  expect(frameDivided(), where).toBe(`${axis} ${drawn.panels.join(" | ")}`);
  const strip = drawn.state.presentation === "Collapsed";
  expect(chatDrawn() === null, where).toBe(strip);
  expect(
    screen.queryByRole("button", { name: "Expand chat" }) !== null,
    where,
  ).toBe(strip);
  expect(localStorage.getItem(chatPaneStoreKey), where).toBe(
    trail.hold.stored === undefined ? null : JSON.stringify(trail.hold.stored),
  );
  if (drawn.share === undefined) {
    expect(screen.queryByRole("separator"), where).toBeNull();
    return;
  }
  const before = edgeShare();
  const seen = drawn.panels[0] === chatPanePanels.pages ? 100 - before : before;
  expect(seen, where).toBeCloseTo(drawn.share, 2);
  expect(edgeText(), where).toBe(chatPaneShareText(drawn.share));
}

/** The moves made one after another from a fresh frame, the frame checked
 * against the trail after each. */
async function walkReplayed(
  moves: readonly ChatPaneMove[],
  where: string,
): Promise<void> {
  let trail = chatPaneTrailStarted(walkFrame);
  let frame = await walkMounted(trail);
  walkChecked(trail, `${where}, at the start`);
  for (const [step, move] of moves.entries()) {
    frame = await walkApplied(move, trail, frame);
    trail = chatPaneTrailMoved(trail, move);
    walkChecked(
      trail,
      `${where}, step ${String(step)}: ${JSON.stringify(move)}`,
    );
  }
}

/** How many walks are taken, how far each goes, and how long one may take. */
const walkSeeds = [1, 2, 3, 4];
const walkStepsMax = 300;
const walkTimeoutMs = 120_000;

/** The moves a seed draws, which are the whole of what its walk does, so a
 * walk that fails is taken again from its seed alone. */
function walkDrawn(seed: number): readonly ChatPaneMove[] {
  const random = seededRandom(seed);
  let trail = chatPaneTrailStarted(walkFrame);
  const moves: ChatPaneMove[] = [];
  for (let step = 0; step < walkStepsMax; step += 1) {
    const move = walkMove(trail, random);
    moves.push(move);
    trail = chatPaneTrailMoved(trail, move);
  }
  return moves;
}

/**
 * NAMED CASES PIN PATHS AND THIS PINS EVERY PATH BETWEEN THEM. The reader's
 * moves are drawn at random from those the frame offers, made by the controls
 * a reader uses, and after each one the frame is held to the trail: which
 * panels it draws, the pane's presentation and stored state, and its share as
 * the edge says it.
 */
test.each(walkSeeds)(
  "the frame is drawn as the trail says after every move of a walk, seed %i",
  async (seed) => {
    await walkReplayed(walkDrawn(seed), `seed ${String(seed)}`);
    styleless();
  },
  walkTimeoutMs,
);

const draggedAcross: ChatPaneMove = { move: "Dragged", share: 46.875 };
const shortened: ChatPaneMove = { move: "Resized", heightEm: frameShortEm };
const heightened: ChatPaneMove = { move: "Resized", heightEm: frameTallEm };

/** A frame short enough that the strip under the pages is over the pane's
 * least. */
const shortenedPastLeast: ChatPaneMove = { move: "Resized", heightEm: 7 };

/** Paths that once drew the pane other than the trail says, each named for
 * what it does. */
test.each([
  [
    "placed under the pages, on the left and back on the right, then filled and restored",
    [
      { move: "Placed", placement: "Bottom" },
      { move: "Placed", placement: "Left" },
      { move: "Placed", placement: "Right" },
      { move: "Filled" },
      { move: "Restored" },
    ],
  ],
  [
    "dragged, collapsed, a thread visited, and expanded",
    [
      draggedAcross,
      { move: "Collapsed" },
      { move: "Visited" },
      { move: "Expanded" },
    ],
  ],
  [
    "dragged, collapsed, placed on the left and back, and expanded",
    [
      draggedAcross,
      { move: "Collapsed" },
      { move: "Placed", placement: "Left" },
      { move: "Placed", placement: "Right" },
      { move: "Expanded" },
    ],
  ],
  [
    "dragged, collapsed, reloaded, and expanded",
    [
      draggedAcross,
      { move: "Collapsed" },
      { move: "Reloaded" },
      { move: "Expanded" },
    ],
  ],
  [
    "collapsed and placed on the left",
    [{ move: "Collapsed" }, { move: "Placed", placement: "Left" }],
  ],
  [
    "dragged, placed under the pages, on the left and back on the right",
    [
      draggedAcross,
      { move: "Placed", placement: "Bottom" },
      { move: "Placed", placement: "Left" },
      { move: "Placed", placement: "Right" },
    ],
  ],
  [
    "placed under the pages on a short frame, dragged near its least, and the frame heightened",
    [
      { move: "Placed", placement: "Bottom" },
      shortened,
      { move: "Dragged", share: 35 },
      heightened,
      shortened,
    ],
  ],
  [
    "placed under the pages on a short frame, dragged into the strip, the frame heightened, and expanded",
    [
      { move: "Placed", placement: "Bottom" },
      shortened,
      { move: "Dragged", share: 0 },
      heightened,
      { move: "Expanded" },
    ],
  ],
  [
    "narrowed on a short frame, collapsed to the strip under the pages, the frame heightened, and expanded",
    [
      shortened,
      { move: "Narrowed" },
      { move: "Collapsed" },
      heightened,
      { move: "Expanded" },
    ],
  ],
  [
    "placed under the pages, the frame shortened, placed right and back, and collapsed and expanded",
    [
      { move: "Placed", placement: "Bottom" },
      shortened,
      { move: "Placed", placement: "Right" },
      { move: "Placed", placement: "Bottom" },
      { move: "Collapsed" },
      { move: "Expanded" },
    ],
  ],
  [
    "placed under the pages where the strip is over its least, collapsed, the frame grown, and expanded",
    [
      { move: "Placed", placement: "Bottom" },
      shortenedPastLeast,
      { move: "Collapsed" },
      heightened,
      { move: "Expanded" },
    ],
  ],
  [
    "collapsed under the pages, reloaded where the strip is over its least, and the frame grown",
    [
      { move: "Placed", placement: "Bottom" },
      { move: "Collapsed" },
      shortenedPastLeast,
      { move: "Reloaded" },
      heightened,
    ],
  ],
  [
    "placed under the pages where the strip is over its least, dragged into it, the frame grown, and expanded",
    [
      { move: "Placed", placement: "Bottom" },
      shortenedPastLeast,
      { move: "Dragged", share: 0 },
      heightened,
      { move: "Expanded" },
    ],
  ],
  [
    "placed under the pages on a frame so tall its default is under its least, shortened until the strip is over it, collapsed and expanded",
    [
      { move: "Resized", heightEm: walkHeightMostEm },
      { move: "Placed", placement: "Bottom" },
      shortenedPastLeast,
      { move: "Collapsed" },
      { move: "Expanded" },
    ],
  ],
  [
    "placed under the pages on a frame so tall its default is under its least, placed right, collapsed and expanded, and placed back under where the strip is over its least",
    [
      { move: "Resized", heightEm: walkHeightMostEm },
      { move: "Placed", placement: "Bottom" },
      { move: "Resized", heightEm: 84.75 },
      { move: "Placed", placement: "Right" },
      { move: "Collapsed" },
      { move: "Expanded" },
      shortenedPastLeast,
      { move: "Placed", placement: "Bottom" },
    ],
  ],
  [
    "dragged into the strip under the pages, the frame shortened, and expanded",
    [
      { move: "Placed", placement: "Bottom" },
      { move: "Dragged", share: 0 },
      { move: "Resized", heightEm: 30.5 },
      { move: "Expanded" },
    ],
  ],
  [
    "dragged, narrowed past the two-column width, collapsed, expanded, and widened",
    [
      draggedAcross,
      { move: "Narrowed" },
      { move: "Collapsed" },
      { move: "Expanded" },
      { move: "Widened" },
    ],
  ],
] satisfies readonly (readonly [string, readonly ChatPaneMove[]])[])(
  "the frame is drawn as the trail says when %s",
  async (named, moves) => {
    await walkReplayed(moves, named);
    styleless();
  },
);

/** The bar carries the project's screens and one gear; the setup pages, the
 * theme and signing out are rarer moves, so they sit behind it. */
test("the bar draws the screens and a gear, and the gear holds setup, the theme and signing out", async () => {
  await mounted(viewportDeskEm);
  const nav = navDrawn();
  expect(
    [...(nav?.querySelectorAll("a") ?? [])].map((link) => link.textContent),
  ).not.toContain("Runners");
  expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
  expect(screen.queryByRole("link", { name: "chuggy" })).toBeNull();
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
      key: "ArrowDown",
    });
  });
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toStrictEqual(["Project settings", "Repositories", "Runners", "Sign out"]);
  expect(
    within(menu).getByRole("menuitemradio", { name: "Dark" }),
  ).toBeDefined();
  styleless();
});

/** The gear's menu, opened. */
async function settingsOpened(): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
      key: "ArrowDown",
    });
  });
  return screen.findByRole("menu");
}

/** The pane placed from the gear. */
async function panePlaced(placement: string): Promise<void> {
  const menu = await settingsOpened();
  await turned(() => {
    within(menu).getByRole("menuitemradio", { name: placement }).click();
  });
  await settled();
}

/** The thread is the page at its own address, so however the reader left the
 * pane it is not drawn there, nor its strip. */
test.each(["Docked", "Collapsed", "Full"] as const)(
  "on a thread's own page the pages are drawn alone under the bar, with the pane left %s",
  async (presentation) => {
    localStorage.setItem(
      chatPaneStoreKey,
      JSON.stringify({ placement: "Right", presentation }),
    );
    routeParams = { ...atlas, session: threadMineSession };
    pageDrawn = () => <p>the thread's page</p>;
    await mounted(viewportNarrowEm - 1);
    expect(chatDrawn()).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand chat" })).toBeNull();
    expect(navDrawn()).not.toBeNull();
    expect(screen.getByText("the thread's page")).toBeDefined();
    expect(frameDivided()).toBe("across pages");
    expect(screen.queryByRole("separator")).toBeNull();
    expect(localStorage.getItem(chatPaneStoreKey)).toContain(presentation);
    styleless();
  },
);

/** Where the pane sits is a choice about a pane, and the page has none. */
test("the gear offers where the pane sits on every page but a thread's own", async () => {
  await mounted(viewportDeskEm);
  expect(
    within(await settingsOpened()).getByText("Chat position"),
  ).toBeDefined();
  cleanup();
  routeParams = { ...atlas, session: threadMineSession };
  await mounted(viewportDeskEm);
  const menu = await settingsOpened();
  expect(within(menu).getByText("Theme")).toBeDefined();
  expect(within(menu).queryByText("Chat position")).toBeNull();
  expect(
    within(menu).queryByRole("menuitemradio", { name: "Left" }),
  ).toBeNull();
  styleless();
});

/** Below two columns the pane is the whole body or the strip under the pages
 * wherever it sits, so the gear offers no placement there. */
test("below two columns the gear offers no placement", async () => {
  await mounted(viewportNarrowEm - 1);
  const menu = await settingsOpened();
  expect(within(menu).getByText("Theme")).toBeDefined();
  expect(within(menu).queryByText("Chat position")).toBeNull();
  expect(
    within(menu).queryByRole("menuitemradio", { name: "Left" }),
  ).toBeNull();
  styleless();
});

/** The reader's own thread and another member's, each read as itself. */
function twoThreadsServed(): typeof fetch {
  return ((url: string) => {
    for (const session of [threadMineSession, threadOtherSession]) {
      if (url.includes(`/threads/${session}/transcript`))
        return Promise.resolve(answer(threadTranscriptPage(0)));
      if (url.includes(`/threads/${session}`))
        return Promise.resolve(
          answer(
            threadBody({
              session,
              mine: session === threadMineSession,
              owner: session === threadMineSession ? "geoff" : "ada",
            }),
          ),
        );
    }
    if (url.includes("/threads"))
      return Promise.resolve(
        answer({
          threads: [
            threadEntry({
              session: threadMineSession,
              owner: "geoff",
              mine: true,
              title: "mine",
            }),
            threadEntry({ session: threadOtherSession, title: "theirs" }),
          ],
        }),
      );
    return Promise.resolve(shellRoute(url));
  }) as unknown as typeof fetch;
}

/** No pane is drawn on a thread's own page, so the pick is the frame's to
 * hold: coming back draws the pane holding what the reader left it holding,
 * rather than their own thread again. */
test("a thread picked in History is held again after a trip to a thread's own page", async () => {
  const frame = await mounted(viewportDeskEm, twoThreadsServed());
  const held = (): string | undefined =>
    chatDrawn()?.querySelector("header h2")?.textContent ?? undefined;
  expect(held()).toBe("mine");
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  const theirs = await screen.findByRole("menuitemradio", { name: /^theirs,/ });
  await turned(() => {
    fireEvent.click(theirs);
  });
  await settled();
  expect(held()).toBe("theirs");
  routeParams = { ...atlas, session: threadOtherSession };
  await frame.redrawn();
  expect(chatDrawn()).toBeNull();
  routeParams = atlas;
  await frame.redrawn();
  expect(held()).toBe("theirs");
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  expect(
    (
      await screen.findByRole("menuitemradio", { name: /^theirs,/ })
    ).getAttribute("aria-checked"),
  ).toBe("true");
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
 * settled. */
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

/** New closes nothing, so a thread still answering is no reason to withhold
 * it. */
test("New is offered beside a thread of the reader's own that is still answering", async () => {
  await mounted(viewportDeskEm, answeringThreadServed());
  const button = screen.getByRole("button", { name: "New" });
  expect(button.hasAttribute("disabled")).toBe(false);
  await tooltipNamed("New");
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
  expect(named("Thread actions")).toBe(title);
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
 * and the key each open was asked under, and answering an open as `open`
 * names. */
function heldThreadServed(
  posts: string[],
  open: () => Promise<unknown>,
  keys: string[] = [],
): typeof fetch {
  const served = threadServed([
    threadEntry({ session: openedSession, owner: "geoff", mine: true }),
  ]);
  return ((
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ) => {
    if (init?.method !== "POST") return served(url, init);
    posts.push(url);
    if (!url.endsWith("/threads")) return served(url, init);
    const asked = JSON.parse(init.body ?? "null") as { readonly key: string };
    keys.push(asked.key);
    return open();
  }) as unknown as typeof fetch;
}

/** An open the door answers with another thread of the reader's own. */
function anotherOpened(): Promise<unknown> {
  return Promise.resolve(
    answer(threadEntry({ session: openedSession, owner: "geoff", mine: true })),
  );
}

test("New beside a thread of the reader's own opens another and closes none", async () => {
  const posts: string[] = [];
  await mounted(viewportDeskEm, heldThreadServed(posts, anotherOpened));
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open"]);
  styleless();
});

/** A press after one the door did not answer may be reaching the thread that
 * one opened, so it asks under the same key; one after an open that answered
 * is a thread of its own. */
test("New pressed again after a failed open asks under the same key, and after an opened one under another", async () => {
  const posts: string[] = [];
  const keys: string[] = [];
  const answers = [
    () => Promise.resolve(answer({ error: { code: "Unavailable" } }, 500)),
    anotherOpened,
    anotherOpened,
  ];
  await mounted(
    viewportDeskEm,
    heldThreadServed(
      posts,
      () => (answers[keys.length - 1] ?? anotherOpened)(),
      keys,
    ),
  );
  await pressed("New");
  await pressed("New");
  await pressed("New");
  expect(keys).toHaveLength(3);
  expect(keys[1], "a retried open minted a fresh key").toBe(keys[0]);
  expect(keys[2], "a start after an opened one reused its key").not.toBe(
    keys[1],
  );
  styleless();
});

/** The limit is the reader's to act on, by closing a thread, so it is said in
 * words of its own rather than as the conflict it arrives as. */
test("New the door refuses at the reader's thread limit says so", async () => {
  const posts: string[] = [];
  await mounted(
    viewportDeskEm,
    heldThreadServed(posts, () =>
      Promise.resolve(
        answer({ error: { code: "ThreadLimitReached" }, threadsMax: 2 }, 409),
      ),
    ),
  );
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open"]);
  expect(screen.getByText("Refused · Thread limit reached")).toBeTruthy();
  styleless();
});

/** A reader the hosted grant refuses keeps the thread they hold, and is told
 * what New met. */
test("New the hosted grant refuses closes nothing, and the refusal is drawn", async () => {
  const posts: string[] = [];
  await mounted(
    viewportDeskEm,
    heldThreadServed(posts, () =>
      Promise.resolve(answer({ error: { code: "HostedRunsNotGranted" } }, 403)),
    ),
  );
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open"]);
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
  expect(
    unled.querySelector("i[aria-hidden]"),
    "a dot with no lead",
  ).toBeNull();
  cleanup();
  await mounted(viewportDeskEm, leadServed(leadBody(1, 1)));
  const led = within(bar()).getByRole("link", { name: "OpenLead" });
  expect(led.querySelector("i[aria-hidden]")).not.toBeNull();
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
  ["Unregistered", "No chat host"],
  ["Offline", "Chat host offline"],
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

/** A thread runs only on its member's chat host, so it is added on their own page rather than as a project's pool. */
test("a reader with no chat host is pointed at their own runners' page", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(true, []), {
      thread: "Pool",
      mine: "Unregistered",
    }),
  );
  expect(
    within(conversationRegion()).getByRole("link", { name: "My runners" }),
  ).toBeTruthy();
  styleless();
});

/** Beside New too, where a held thread takes no messages, the way to a runner is the reader's own page. */
test("a held thread that takes no messages points a reader with no runner at their own runner's page", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(
      grantReadServed(
        true,
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
      { thread: "Pool", mine: "Unregistered" },
    ),
  );
  const conversation = within(conversationRegion());
  expect(conversation.getByText("Closed")).toBeTruthy();
  expect(conversation.queryByText("No chat host")).toBeNull();
  expect(screen.getByRole("link", { name: "My runners" })).toBeTruthy();
  styleless();
});

test("a reader whose runner is live is told nothing about it", async () => {
  await mounted(
    viewportDeskEm,
    placedServed(grantReadServed(false, []), { thread: "Pool", mine: "Live" }),
  );
  expect(screen.queryByText("No chat host")).toBeNull();
  expect(screen.queryByText("Chat host offline")).toBeNull();
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
  expect(within(conversationRegion()).getByText("No chat host")).toBeTruthy();
  styleless();
});

/** A reader whose runner went since the pane read it keeps the thread they
 * hold, and the box under it says what New met. */
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
  expect(screen.queryByText("No chat host")).toBeNull();
  mine = "Unregistered";
  await pressed("New");
  expect(postsNamed(posts)).toStrictEqual(["open"]);
  expect(within(conversationRegion()).getByText("No chat host")).toBeTruthy();
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
  expect(within(conversationRegion()).getByText("No chat host")).toBeTruthy();
  expect(screen.queryByText(/^Refused/u)).toBeNull();
  styleless();
});

/** The refusal answered the message as it was, so a corrected one is a press
 * of its own and the word goes with the text it was about. */
test("editing a message the door refused for no runner takes the refusal away", async () => {
  await sentRefusedNoRunner("/messages");
  expect(within(conversationRegion()).getByText("No chat host")).toBeTruthy();
  await turned(() => {
    fireEvent.change(composerDrawn(), { target: { value: "hello again" } });
  });
  expect(screen.queryByText("No chat host")).toBeNull();
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
  await mounted(viewportDeskEm, undefined, undefined, {
    columnEm: viewportColumnAsideEm,
  });
  expect(screen.getByText("aside").parentElement?.className).toContain(
    "@container",
  );
  styleless();
});

/** What decides is the column the pane leaves the pages, so a viewport under
 * the desk width with the column wide enough still opens them beside it. */
test("where the pages' column holds the details beside the page they open there", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot openFirst>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm - 1, undefined, undefined, {
    columnEm: viewportColumnAsideEm,
  });
  expect(screen.getByText("page")).toBeDefined();
  expect(screen.getByText("aside")).toBeDefined();
  await pressed("Details");
  expect(screen.queryByText("aside")).toBeNull();
  expect(screen.getByText("page")).toBeDefined();
  styleless();
});

test("where the pages' column cannot hold them the details take the middle from the page, however wide the viewport", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot openFirst>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm * 2, undefined, undefined, {
    columnEm: viewportColumnAsideEm - 1,
  });
  expect(screen.queryByText("aside")).toBeNull();
  expect(screen.getByText("page")).toBeDefined();
  await pressed("Details");
  expect(screen.getByText("aside")).toBeDefined();
  const hiddenScroller = screen.getByText("page").closest("[hidden]");
  expect(hiddenScroller).not.toBeNull();
  expect(hiddenScroller?.className ?? "").not.toContain("grid");
  styleless();
});

/** The details open first once, where the column first holds them; after that
 * they are the reader's, whatever the edge does to the column. */
test("details the reader closed stay closed through a drag that narrows the column and widens it again", async () => {
  pageDrawn = () => (
    <>
      <p>page</p>
      <DetailsSlot openFirst>
        <p>aside</p>
      </DetailsSlot>
    </>
  );
  await mounted(viewportDeskEm + 20);
  expect(screen.getByText("aside")).toBeDefined();
  await pressed("Details");
  expect(screen.queryByText("aside")).toBeNull();
  await edgeDragged(-20);
  await edgeDragged(20);
  expect(screen.queryByText("aside")).toBeNull();
  expect(screen.getByText("page")).toBeDefined();
  styleless();
});

const heldOwn = threadEntry({
  session: openedSession,
  owner: "geoff",
  mine: true,
  title: "held",
});

/** What the frame offers a reader to change: the bar's way to a new ticket,
 * the pane's New, what a held thread's menu offers to do to it, and the box. */
async function offeredToChange(): Promise<Record<string, boolean>> {
  const named = (role: string, name: string): boolean =>
    screen.queryByRole(role, { name }) !== null;
  const offered = {
    newTicket: named("link", "New ticket"),
    new: named("button", "New"),
    box: named("textbox", "Message"),
  };
  const menu = screen.queryByRole("button", { name: "Thread actions" });
  if (menu === null) return { ...offered, rename: false, close: false };
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  const items = within(await screen.findByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  return {
    ...offered,
    rename: items.includes("Rename"),
    close: items.includes("Close"),
  };
}

function viewOnlySaid(within_: HTMLElement | null): number {
  return within(within_ ?? document.body).queryAllByText("View only").length;
}

test("a reader who may not mutate is told View only once in the bar and once where the first message would be typed", async () => {
  await mounted(
    viewportDeskEm,
    abilitiesFetch({ ...abilitiesEvery, mutate: false }, threadServed([])),
  );
  expect(await offeredToChange()).toStrictEqual({
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
    abilitiesFetch(
      { ...abilitiesEvery, mutate: false },
      threadServed([heldOwn]),
    ),
  );
  expect(screen.getByRole("heading", { name: "held" })).toBeDefined();
  expect(await offeredToChange()).toStrictEqual({
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
    expect(await offeredToChange()).toStrictEqual({
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
    expect(await offeredToChange()).toMatchObject({ new: true, box: true });
    expect(viewOnlySaid(null)).toBe(0);
    styleless();
  },
);

/** One line where the box would be: a reader who could not send with the
 * grant is not told about the grant. */
test("View only stands in place of the hosted grant's line, not beside it", async () => {
  await mounted(
    viewportDeskEm,
    abilitiesFetch(
      { ...abilitiesEvery, mutate: false },
      grantReadServed(false, []),
    ),
  );
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  cleanup();
  await mounted(
    viewportDeskEm,
    abilitiesFetch(
      { ...abilitiesEvery, mutate: false },
      grantReadServed(false, [heldOwn]),
    ),
  );
  expect(viewOnlySaid(conversationRegion())).toBe(1);
  expect(screen.queryByText("Needs hosted runs")).toBeNull();
  styleless();
});
