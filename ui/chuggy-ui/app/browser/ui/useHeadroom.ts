/**
 * Whether a bar that sticks to the top of a scrolling page should be out of the
 * way: it stays while the reader is near the top, and for a while scrolling
 * down, goes once they have scrolled a long way down, and comes back at the
 * first scroll up.
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

export function useHeadroom(ref: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const scroller = scrollerOf(element);
    const target: HTMLElement | Window = scroller ?? window;
    const top = (): number =>
      scroller === undefined ? window.scrollY : scroller.scrollTop;
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
