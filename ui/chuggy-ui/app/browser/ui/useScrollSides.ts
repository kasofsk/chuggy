/**
 * Which sides of a sideways scroller hold more than it shows, before its start
 * and past its end, measured again whenever it scrolls or it or its first
 * child changes size. That child is what it scrolls, so it is sized to its own
 * content rather than the scroller's width, or content that grows inside it
 * goes unmeasured. A scroller draws them as `data-more-start` and
 * `data-more-end`, which `ScrollSides.css` fades.
 */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function useScrollSides<Scroller extends HTMLElement>(): {
  readonly scroller: RefObject<Scroller | null>;
  readonly more: { readonly start: boolean; readonly end: boolean };
} {
  const scroller = useRef<Scroller>(null);
  const [more, setMore] = useState({ start: false, end: false });
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const before = Math.abs(element.scrollLeft);
      const start = before > 0;
      const end = before + element.clientWidth < element.scrollWidth - 1;
      setMore((held) =>
        held.start === start && held.end === end ? held : { start, end },
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild !== null)
      observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  return { scroller, more };
}
