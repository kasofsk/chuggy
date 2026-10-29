/**
 * The width a case is reading at. The document a suite runs against answers no
 * media query at all, and the shell asks two of them — the rail is a drawer or
 * a column, the details are the middle or an aside — so a case that mounts the
 * shell states the width instead of inheriting one.
 *
 * It lays nothing out either, and the library dividing the frame measures its
 * panels to divide it. So a case that mounts the shell also states the frame:
 * the group is as wide as the viewport, each panel takes the share the library
 * last gave it, and every observer is told the size of what it observes, as a
 * browser tells it after a layout. A case may state the pages' column instead,
 * which is then what the column measures whatever share the library gave it.
 * A case that states the frame again has resized the window, and every
 * observer already made is told the sizes it then has.
 */

import { vi } from "vitest";

const viewportAsked = /min-width:\s*([0-9.]+)em/u;

/** A desk's viewport, wider than any of the console's breakpoints. */
export const viewportDeskEm = 80;

/** The root's `em` in pixels, which the stated frame is measured in. */
const viewportEmPixels = 16;

/** The frame's height where a case does not state one. */
const viewportHeightEmDefault = 50;

export interface ViewportFrame {
  readonly columnEm?: number;
  readonly heightEm?: number;
}

export function viewportAtEm(em: number, frame?: ViewportFrame): void {
  vi.stubGlobal("matchMedia", (query: string) => {
    const asked = viewportAsked.exec(query);
    return {
      matches: asked !== null && em >= Number(asked[1]),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  if (frame !== undefined) viewportAtEmFramed(em, frame);
}

interface ViewportBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface ViewportObserved {
  readonly callback: ResizeObserverCallback;
  readonly observer: ResizeObserver;
  readonly observed: Set<Element>;
}

/** Every observer the mounted tree made, with what each observes. */
const viewportObservers = new Set<ViewportObserved>();

/** What tells the observers whenever the library restyles a panel. */
let viewportRestyled: MutationObserver | undefined;

/** A panel's share of its group, as the library last styled it. */
function viewportAtEmGrown(element: HTMLElement): number {
  const grown = Number.parseFloat(element.style.flexGrow);
  return Number.isFinite(grown) && grown > 0 ? grown : 1;
}

function viewportAtEmPanels(group: HTMLElement): readonly HTMLElement[] {
  return Array.from(group.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute("data-panel"),
  );
}

/** Where a child of the divided frame sits: each panel at its share, or the
 * pages at the column a case stated, and an edge between them at none. */
function viewportAtEmChildBox(
  element: HTMLElement,
  group: HTMLElement,
  groupBox: ViewportBox,
  frame: ViewportFrame,
): ViewportBox | undefined {
  const across = group.style.flexDirection !== "column";
  const axis = across ? groupBox.width : groupBox.height;
  const panels = viewportAtEmPanels(group);
  const total = panels.reduce(
    (sum, panel) => sum + viewportAtEmGrown(panel),
    0,
  );
  const stated =
    frame.columnEm !== undefined && across && panels.length > 1
      ? frame.columnEm * viewportEmPixels
      : undefined;
  const length = (panel: HTMLElement): number => {
    if (stated !== undefined)
      return panel.id === "pages" ? stated : axis - stated;
    return (axis * viewportAtEmGrown(panel)) / total;
  };
  let start = 0;
  for (const child of Array.from(group.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const size = child.hasAttribute("data-panel") ? length(child) : 0;
    if (child === element)
      return across
        ? { left: start, top: 0, width: size, height: groupBox.height }
        : { left: 0, top: start, width: groupBox.width, height: size };
    start += size;
  }
  return undefined;
}

/** Where jsdom puts any element, which is nowhere. */
const viewportUnplaced: ViewportBox = { left: 0, top: 0, width: 0, height: 0 };

/** Where an element of the divided frame sits, or nothing for any other. */
function viewportAtEmBox(
  element: Element,
  em: number,
  frame: ViewportFrame,
): ViewportBox | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  const groupBox = {
    left: 0,
    top: 0,
    width: em * viewportEmPixels,
    height: (frame.heightEm ?? viewportHeightEmDefault) * viewportEmPixels,
  };
  if (element.hasAttribute("data-group")) return groupBox;
  const group = element.parentElement;
  if (group === null || !group.hasAttribute("data-group")) return undefined;
  return viewportAtEmChildBox(element, group, groupBox, frame);
}

/** Every observer told the size of everything it observes, as a browser does
 * after it lays a frame out. */
function viewportFramesDelivered(): void {
  for (const held of [...viewportObservers]) {
    const entries = [...held.observed].map((target) => {
      const box = target.getBoundingClientRect();
      const size = { inlineSize: box.width, blockSize: box.height };
      return {
        target,
        contentRect: box,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      };
    });
    if (entries.length > 0) held.callback(entries, held.observer);
  }
}

/** A delivery after the turn that changed a size, since a browser tells its
 * observers after it lays out and not inside the change. */
function viewportAtEmDelivered(): void {
  setTimeout(viewportFramesDelivered, 0);
}

class ViewportResizeObserver {
  readonly held: ViewportObserved;

  constructor(callback: ResizeObserverCallback) {
    this.held = {
      callback,
      observer: this,
      observed: new Set(),
    };
    viewportObservers.add(this.held);
  }

  observe(target: Element): void {
    this.held.observed.add(target);
    viewportAtEmDelivered();
  }

  unobserve(target: Element): void {
    this.held.observed.delete(target);
  }

  disconnect(): void {
    this.held.observed.clear();
    viewportObservers.delete(this.held);
  }
}

function viewportAtEmFramed(em: number, frame: ViewportFrame): void {
  document.documentElement.style.fontSize = `${String(viewportEmPixels)}px`;
  const measured = (read: (box: ViewportBox) => number) =>
    function (this: HTMLElement): number {
      const box = viewportAtEmBox(this, em, frame);
      return box === undefined ? 0 : read(box);
    };
  const prototype = HTMLElement.prototype;
  vi.spyOn(prototype, "offsetWidth", "get").mockImplementation(
    measured((box) => box.width),
  );
  vi.spyOn(prototype, "offsetHeight", "get").mockImplementation(
    measured((box) => box.height),
  );
  vi.spyOn(prototype, "offsetLeft", "get").mockImplementation(
    measured((box) => box.left),
  );
  vi.spyOn(prototype, "offsetTop", "get").mockImplementation(
    measured((box) => box.top),
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const box = viewportAtEmBox(this, em, frame) ?? viewportUnplaced;
      return {
        ...box,
        x: box.left,
        y: box.top,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => box,
      };
    },
  );
  if (globalThis.ResizeObserver !== ViewportResizeObserver) {
    viewportObservers.clear();
    vi.stubGlobal("ResizeObserver", ViewportResizeObserver);
  }
  viewportRestyled?.disconnect();
  viewportRestyled = new MutationObserver(viewportAtEmDelivered);
  viewportRestyled.observe(document.body, {
    attributes: true,
    attributeFilter: ["style"],
    subtree: true,
  });
  viewportAtEmDelivered();
}
