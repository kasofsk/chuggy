/**
 * The frame mounted and read, shared by the shell's cases and the walks that
 * draw it a move at a time: what they draw, how they press on it, and what
 * every case undoes.
 *
 * Every case ends by asserting `styleless()`, because the served policy
 * refuses a `<style>` element: a primitive that appends a sheet passes every
 * other assertion here and is refused by the browser.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import type { ReactNode } from "react";

import { Shell } from "../app/browser/Shell.tsx";
import { chatPaneSizeStrip } from "../app/core/chatPane.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { atlas } from "./shellRouter.tsx";
import { viewportAtEm } from "./viewport.ts";
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

/** What every case in a file drawing the frame sets up and undoes; `reset`
 * puts back the route state the file's own doubles keep. */
export function shellFrameEachCase(reset: () => void): void {
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
    reset();
    localStorage.clear();
    document.documentElement.style.fontSize = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

export function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
}

/** The project inventory for the switcher, an empty thread listing for the
 * chat pane, and the same body for everything else — a read that cannot parse
 * it draws its own unready state, which is not what these cases are about. */
export function shellRoute(url: string): Response {
  if (url.includes("/threads")) return answer({ threads: [] });
  return answer({ projects: [atlas] });
}

/** The frame mounted, and drawn again where a case has moved the route. */
export async function mounted(
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

export function chatDrawn(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Chat" });
}

export function navDrawn(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "Console" });
}

/** How the body under the bar is divided: across or down, and its panels and
 * the edge between them in the order they are drawn. */
export function frameDivided(): string {
  const group = document.querySelector("[data-group]");
  if (!(group instanceof HTMLElement)) return "";
  const parts = Array.from(group.children, (child) =>
    child.getAttribute("role") === "separator" ? "|" : child.id,
  );
  const axis = group.style.flexDirection === "column" ? "down" : "across";
  return `${axis} ${parts.join(" ")}`;
}

/** The edge between the pages and the pane, which is what the reader drags. */
export function edgeDrawn(): HTMLElement {
  return screen.getByRole("separator");
}

/** What the edge says of the pane's share, which a screen reader reads in
 * place of the library's share of the panel before it. */
export function edgeText(): string | null {
  return edgeDrawn().getAttribute("aria-valuetext");
}

/** The share of the body the panel before the edge takes, as the edge says. */
export function edgeShare(): number {
  return Number(edgeDrawn().getAttribute("aria-valuenow"));
}

/** A size the pane states in `rem`, in the root `em` the frame is stated in. */
export function emOf(size: string): number {
  expect(size).toMatch(/rem$/u);
  return Number.parseFloat(size);
}

/** A size the pane states as a share. */
export function shareOf(size: string): number {
  expect(size).toMatch(/%$/u);
  return Number.parseFloat(size);
}

/** The share of the body a collapsed pane's strip takes beside the pages. */
export function stripShare(em: number): number {
  return (emOf(chatPaneSizeStrip) / em) * 100;
}

export async function pressed(name: string): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name }).click();
  });
  await settled();
}

/** A pointer event this many pixels from where the edge was pressed, along
 * the axis the frame divides. */
export function edgePointer(
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
export async function edgePulled(
  byPx: number,
  vertical: boolean,
): Promise<void> {
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

/** The frame's height in these cases, which a pane under the pages divides,
 * and one a fifth as tall. */
export const frameTallEm = 50;
export const frameShortEm = frameTallEm / 5;

/** The gear's menu, opened. */
export async function settingsOpened(): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Settings" }), {
      key: "ArrowDown",
    });
  });
  return screen.findByRole("menu");
}

/** The pane placed from the gear. */
export async function panePlaced(placement: string): Promise<void> {
  const menu = await settingsOpened();
  await turned(() => {
    within(menu).getByRole("menuitemradio", { name: placement }).click();
  });
  await settled();
}
