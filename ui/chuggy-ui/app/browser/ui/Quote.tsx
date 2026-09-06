/**
 * A scroll-capped block of quoted text, with an optional rail marking which
 * side of a conversation it is.
 */

import type { ReactNode } from "react";

import "./Quote.css";

export const quoteRails = ["said", "answer"] as const;

export type QuoteRail = (typeof quoteRails)[number];

export function Quote(props: {
  readonly rail?: QuoteRail;
  readonly children: ReactNode;
}): ReactNode {
  const toned =
    props.rail === undefined ? "quote" : `quote quote-${props.rail}`;
  return <pre className={toned}>{props.children}</pre>;
}
