/**
 * Which of the console's widths the viewport is at, and whether the pages'
 * column has room for the details beside a page. Each of these changes what
 * the shell draws and not only how it looks — the rail is a nav beside the
 * page or a dialog over it, the details are an aside or the whole middle — so
 * the answer is read here rather than left to a sheet.
 *
 * The details ask the column and not the viewport, since the reader drags the
 * chat pane's edge and the column is what is left. Both answers are in the
 * `em` the console's breakpoints are stated in, which is the root's.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

/** The console's breakpoints, in the `em` its sheets state them in. */
export const viewportNarrowEm = 40;
export const viewportTwoColumnEm = 60;

/** The details aside's width, which `tokens.css` states as `--width-aside`. */
export const viewportAsideEm = 22;

/** The column that holds a page at its narrow width with the details beside
 * it. */
export const viewportColumnAsideEm = viewportNarrowEm + viewportAsideEm;

export function useViewportAtLeastEm(em: number): boolean {
  const query = `(min-width: ${String(em)}em)`;
  const subscribe = useCallback(
    (changed: () => void) => {
      const held = window.matchMedia(query);
      held.addEventListener("change", changed);
      return () => {
        held.removeEventListener("change", changed);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}

/** The root's `em` in pixels, which is the one a media query's `em` is. */
function elementAtLeastEmPixels(element: Element): number {
  const root = element.ownerDocument.documentElement;
  return Number.parseFloat(getComputedStyle(root).fontSize);
}

/**
 * Whether the element the returned ref is given is at least this wide: read
 * when it is drawn, and again whenever it resizes. An element not yet drawn
 * and read has no answer, and one under a root whose size reads as none is not
 * wide enough.
 */
export function useElementAtLeastEm(
  em: number,
): readonly [(element: HTMLElement | null) => void, boolean | undefined] {
  const [element, hold] = useState<HTMLElement | null>(null);
  const [atLeast, measured] = useState<boolean>();
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const pixels = elementAtLeastEmPixels(element);
    const widthRead = (width: number): void => {
      measured(pixels > 0 && width >= em * pixels);
    };
    widthRead(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) widthRead(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, em]);
  return [hold, element === null ? undefined : atLeast];
}

const viewportColumnAsideContext = createContext<boolean | undefined>(false);

/** Where the shell says whether its column holds the details beside a page. */
export const ViewportColumnAsideProvider = viewportColumnAsideContext.Provider;

/** Whether the details sit beside the page: no answer until the shell has
 * measured its column, and false outside a shell. */
export function useViewportColumnAside(): boolean | undefined {
  return useContext(viewportColumnAsideContext);
}
