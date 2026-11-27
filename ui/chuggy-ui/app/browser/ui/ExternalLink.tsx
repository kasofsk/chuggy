/**
 * A link to an address outside the console, opened in a tab of its own that
 * is handed no way back to this one, and drawn as `TextLink` is: the words of
 * the line it sits in, a finger's size on a narrow screen.
 *
 * It is not a router link, so a page drawn outside the router may draw it, and
 * it builds no address: it draws the `href` it is given.
 */

import type { ReactNode } from "react";

import "./TextLink.css";

export function ExternalLink(props: {
  readonly href: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link"
    >
      {props.children}
    </a>
  );
}
