/**
 * One formatted number with its unit and, for money, its basis: the cell every
 * cost, token count, duration, instant and span is drawn in.
 *
 * Total over `figureKinds`, and over a span that is open or closed. It formats
 * nothing — `core/figures.ts` did that — so the same quantity cannot be rounded
 * two ways on one page, and an absence is drawn as an absence with the reason
 * on hover rather than as a zero.
 */

import type { ReactNode } from "react";

import type { Figure as FigureValue } from "../../core/figures.ts";

import "./Figure.css";

/** What a list price is not, said where a reader hovers the tag that says it. */
export const figureBasisTitle = "List price, not a bill";

function FigureSpan(props: {
  readonly figure: Extract<FigureValue, { kind: "Span" }>;
}): ReactNode {
  const span = props.figure;
  return (
    <span
      className={span.open ? "fig fig-live" : "fig"}
      title={span.title}
      data-open={span.open ? "true" : undefined}
    >
      {span.start}
      {span.end === undefined ? null : ` → ${span.end}`}
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      {span.length}
    </span>
  );
}

export function Figure(props: { readonly figure: FigureValue }): ReactNode {
  const figure = props.figure;
  switch (figure.kind) {
    case "Cost":
      return (
        <span className="fig">
          {figure.text}
          {figure.basis === undefined ? null : (
            <i className="fig-basis" title={figureBasisTitle}>
              {figure.basis}
            </i>
          )}
        </span>
      );
    case "Tokens":
    case "Duration":
      return <span className="fig">{figure.text}</span>;
    case "Instant":
      return (
        <span className="fig" title={figure.iso}>
          {figure.text}
        </span>
      );
    case "Span":
      return <FigureSpan figure={figure} />;
    case "Absent":
      return (
        <span className="fig fig-dim" title={figure.why}>
          —
        </span>
      );
  }
}
