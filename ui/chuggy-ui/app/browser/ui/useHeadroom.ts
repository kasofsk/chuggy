/**
 * Whether a bar that sticks to the top of a scrolling page should be out of the
 * way: it stays while the reader is near the top, and for a while scrolling
 * down, goes once they have scrolled a long way down, and comes back at the
 * first scroll up. And whether what heads a page should be gone: once it has
 * scrolled wholly out of view, until the page is at its top again.
 */

import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** How far down, in all, a reader scrolls before the bar goes. */
const downBeforeHidden = 240;
/** How far up brings it back. */
const upBeforeShown = 24;
/** Within this of the top it is always shown. */
const nearTop = 120;

function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (
    let parent = element.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return undefined;
}

/** The scroller `element` scrolls in, how far down it is, and where its
 * view's top edge is drawn: the window's where no element between scrolls. */
function scrolledOf(element: HTMLElement): {
  readonly target: HTMLElement | Window;
  readonly top: () => number;
  readonly edge: () => number;
} {
  const scroller = scrollerOf(element);
  return scroller === undefined
    ? { target: window, top: () => window.scrollY, edge: () => 0 }
    : {
        target: scroller,
        top: () => scroller.scrollTop,
        edge: () => scroller.getBoundingClientRect().top,
      };
}

/**
 * Whether the element is gone: from when the page has scrolled past its end
 * until the page is at its top again. It goes only once it is out of view, so
 * the browser's scroll anchoring keeps what is under it where it was, and the
 * page is never at its top just because it went.
 */
export function useHeadroomGone(ref: RefObject<HTMLElement | null>): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const { target, top, edge } = scrolledOf(element);
    const onScroll = (): void => {
      if (top() <= 0) setGone(false);
      else if (element.getBoundingClientRect().bottom <= edge()) setGone(true);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
    };
  }, [ref]);
  return gone;
}

export function useHeadroom(ref: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const { target, top } = scrolledOf(element);
    let last = top();
    let down = 0;
    let up = 0;
    const onScroll = (): void => {
      const at = top();
      const moved = at - last;
      last = at;
      if (at < nearTop) {
        down = 0;
        up = 0;
        setHidden(false);
        return;
      }
      if (moved > 0) {
        up = 0;
        down += moved;
        if (down > downBeforeHidden) setHidden(true);
      } else {
        down = 0;
        up -= moved;
        if (up > upBeforeShown) setHidden(false);
      }
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
    };
  }, [ref]);
  return hidden;
}
