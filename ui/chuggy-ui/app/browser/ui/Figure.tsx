/**
 * One formatted number with its unit and, for money, its basis: the cell every
 * cost, token count, duration, instant and span is drawn in.
 *
 * Total over `figureKinds`, and over a span that is open or closed. It formats
 * nothing — `core/figures.ts` did that — so the same quantity cannot be rounded
 * two ways on one page, and an absence is drawn as an absence with its reason
 * in a tooltip rather than as a zero.
 */

import { Fragment } from "react";
import type { ReactNode } from "react";

import type { Figure as FigureValue } from "../../core/figures.ts";
import { Tooltip } from "./Tooltip.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { copyOrDataText } from "../../core/copy.ts";
import type { Copy } from "../../core/copy.ts";

import "./Figure.css";

/** What a list price is not, said where a reader hovers the tag that says it. */
export const figureBasisTitle: Copy = { id: "figures-basis-title" };

function FigureSpan(props: {
  readonly figure: Extract<FigureValue, { kind: "Span" }>;
}): ReactNode {
  const span = props.figure;
  return (
    <Tooltip text={span.title}>
      <span
        className={span.open ? "fig fig-live" : "fig"}
        data-open={span.open ? "true" : undefined}
      >
        {span.parts.map((part, index) => (
          <Fragment key={part}>
            {index === 0 ? null : (
              <>
                <i className="fig-sep" aria-hidden="true">
                  ·
                </i>
                <wbr />
              </>
            )}
            <span className="fig-part">{part}</span>
          </Fragment>
        ))}
      </span>
    </Tooltip>
  );
}

export function Figure(props: { readonly figure: FigureValue }): ReactNode {
  const figure = props.figure;
  const text = useCopyText();
  switch (figure.kind) {
    case "Cost":
      return (
        <span className="fig">
          {figure.text}
          {figure.basis === undefined ? null : (
            <Tooltip text={text(figureBasisTitle)}>
              <i className="fig-basis">{text(figure.basis)}</i>
            </Tooltip>
          )}
        </span>
      );
    case "Tokens":
      return (
        <span className="fig">
          {figure.unit === undefined
            ? figure.text
            : `${figure.text} ${text(figure.unit)}`}
        </span>
      );
    case "Duration":
      return <span className="fig">{figure.text}</span>;
    case "Quantity":
      return (
        <span className="fig">
          {figure.text} <i className="fig-unit">{text(figure.unit)}</i>
        </span>
      );
    case "Instant":
      return (
        <Tooltip text={figure.iso}>
          <span className="fig">{copyOrDataText(text, figure.text)}</span>
        </Tooltip>
      );
    case "Ago":
      return (
        <Tooltip text={figure.full}>
          <span className="fig">{text(figure.text)}</span>
        </Tooltip>
      );
    case "Span":
      return <FigureSpan figure={figure} />;
    case "Absent":
      return (
        <Tooltip text={text(figure.why)}>
          <span className="fig fig-dim">—</span>
        </Tooltip>
      );
  }
}
