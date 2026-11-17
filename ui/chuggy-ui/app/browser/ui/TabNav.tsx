/**
 * A page's tabs: each a link to its own address, inside a named navigation
 * landmark, the current one marked `aria-current="page"` as the router marks
 * an active link.
 *
 * A tab may carry a count beside its label, which its name reads after the
 * label. A row wider than its container scrolls inside itself and fades the
 * side the more is on, rather than widening the page.
 */

import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { useScrollSides } from "./useScrollSides.ts";

import "./ScrollSides.css";
import "./TabNav.css";

export function TabNav(props: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  const { scroller, more } = useScrollSides<HTMLElement>();
  return (
    <nav
      ref={scroller}
      aria-label={props.label}
      className="tab-nav scroll-sides"
      data-more-start={more.start ? "" : undefined}
      data-more-end={more.end ? "" : undefined}
    >
      <ul>{props.children}</ul>
    </nav>
  );
}

function TabNavAnchor(
  props: ComponentPropsWithoutRef<"a"> & {
    readonly count?: number | string | undefined;
  },
): ReactNode {
  const { count, children, ...anchor } = props;
  return (
    <li>
      <a {...anchor} className="tab-nav-tab">
        {children}
        {count === undefined ? null : (
          <>
            {" "}
            <span className="tab-nav-count">{count}</span>
          </>
        )}
      </a>
    </li>
  );
}

/** One tab: the router's own link, so the router marks it current. */
export const TabNavLink = createLink(TabNavAnchor);
