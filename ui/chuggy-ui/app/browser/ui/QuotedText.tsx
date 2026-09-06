/**
 * A scroll-capped block of a conversation's own words: what a member typed,
 * what came back, and the record a lead or an inquiry holds of either. An
 * optional rail says which side of a turn the block is, for the two callers
 * that draw both sides of one.
 */

import type { ReactNode } from "react";

import "./QuotedText.css";

export const quotedTextRails = ["said", "answer"] as const;

export type QuotedTextRail = (typeof quotedTextRails)[number];

export function QuotedText(props: {
  readonly rail?: QuotedTextRail;
  readonly children: ReactNode;
}): ReactNode {
  const rail = props.rail === undefined ? "" : ` quoted-text-${props.rail}`;
  return <pre className={`quoted-text${rail}`}>{props.children}</pre>;
}
