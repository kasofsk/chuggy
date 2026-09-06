/**
 * A scroll-capped block of quoted text: a member's own line, the answer that
 * came back, an entry a lead recorded. It renders characters and nothing
 * else, never markup, whatever the text happens to contain.
 *
 * The rail is optional and total over `quoteRails`: the one caller with two
 * sides of a turn to tell apart draws one for each, and every other caller
 * draws none.
 */

import type { ReactNode } from "react";

import "./Quote.css";

export const quoteRails = ["said", "answer"] as const;

export type QuoteRail = (typeof quoteRails)[number];

export function Quote(props: {
  readonly children: string;
  readonly rail?: QuoteRail;
}): ReactNode {
  const railed = props.rail === undefined ? "" : ` quote-${props.rail}`;
  return <pre className={`quote${railed}`}>{props.children}</pre>;
}
