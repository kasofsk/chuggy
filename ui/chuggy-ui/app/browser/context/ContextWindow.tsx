/**
 * The Window section of a Context view: how much of the window the latest
 * reading held, the bar of what holds it with the compaction threshold marked
 * and the autocompact buffer hatched at its far end, and the legend table.
 *
 * It draws the `ContextWindowView` it is handed and reads nothing, so a run's
 * tab and a session's panel draw the same section.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import type {
  ContextCategoryRow,
  ContextName,
  ContextSegment,
  ContextWindowView,
} from "../../core/contextView.ts";
import { contextAtLabel } from "../../core/contextView.ts";
import {
  groupedDigits,
  sharePartFigure,
  tokenCountText,
} from "../../core/figures.ts";
import { Figure } from "../ui/Figure.tsx";
import { Table } from "../ui/Table.tsx";

/** A name the catalog words, or the runtime's own as it arrived. */
export function contextNameText(text: CopyText, name: ContextName): string {
  return typeof name === "string" ? name : text(name);
}

function contextPercent(fraction: number): string {
  return `${String(Math.round(fraction * 10_000) / 100)}%`;
}

function ContextWindowAt(props: {
  readonly view: ContextWindowView;
}): ReactNode {
  const text = useCopyText();
  const { view } = props;
  if (view.at === undefined) return null;
  const at = contextAtLabel(view.unit, view.at);
  return (
    <span className="context-meta">
      {view.reading
        ? text(at)
        : text({ id: "context-at-unread", args: { at } })}
    </span>
  );
}

function ContextUsed(props: { readonly view: ContextWindowView }): ReactNode {
  const text = useCopyText();
  const { view } = props;
  return (
    <p className="context-used">
      <span className="context-used-figure">{groupedDigits(view.used)}</span>
      {view.window === undefined ? (
        <span>{text({ id: "context-used-alone" })}</span>
      ) : (
        <>
          <span>
            {text({
              id: "context-used-of",
              args: { window: groupedDigits(view.window) },
            })}
          </span>
          <span className="context-used-share">
            <Figure figure={sharePartFigure(view.used / view.window)} />
          </span>
        </>
      )}
    </p>
  );
}

function ContextBarSegment(props: {
  readonly segment: ContextSegment;
  readonly hatch: string;
}): ReactNode {
  const text = useCopyText();
  const { segment } = props;
  const x = contextPercent(segment.start);
  const width = contextPercent(segment.width);
  return (
    <g>
      <rect
        className={
          segment.kind === "Buffer" ? "context-seg-hatch" : "context-seg"
        }
        data-kind={segment.kind}
        data-slot={segment.slot}
        x={x}
        y="0"
        width={width}
        height="100%"
      />
      {segment.kind === "Buffer" ? (
        <rect
          x={x}
          y="0"
          width={width}
          height="100%"
          fill={`url(#${props.hatch})`}
        />
      ) : null}
      {segment.labelled && segment.kind !== "Buffer" ? (
        <text
          className="context-seg-label"
          data-kind={segment.kind}
          x={contextPercent(segment.start + 0.008)}
          y="50%"
        >
          {`${contextNameText(text, segment.name)} ${tokenCountText(segment.tokens)}`}
        </text>
      ) : null}
    </g>
  );
}

/** The bar, with the threshold's label over it where a reading named one. */
function ContextBar(props: { readonly view: ContextWindowView }): ReactNode {
  const text = useCopyText();
  const hatch = `context-hatch-${useId().replace(/[^a-zA-Z0-9-]/gu, "")}`;
  const { view } = props;
  const at =
    view.threshold === undefined || view.window === undefined
      ? undefined
      : contextPercent(view.threshold / view.window);
  return (
    <div className="context-bar">
      {at === undefined || view.threshold === undefined ? null : (
        <svg className="context-bar-marks" aria-hidden="true">
          <text
            className="context-bar-mark-label"
            x={at}
            y="80%"
            textAnchor="end"
          >
            {text({
              id: "context-compacts-at",
              args: { tokens: groupedDigits(view.threshold) },
            })}
          </text>
        </svg>
      )}
      <svg
        className="context-bar-strip"
        role="img"
        aria-label={text({ id: "context-bar-label" })}
      >
        <defs>
          <pattern
            id={hatch}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line className="context-hatch-line" x1="0" y1="0" x2="0" y2="6" />
          </pattern>
        </defs>
        {view.segments.map((segment) => (
          <ContextBarSegment
            key={`${segment.kind}-${String(segment.start)}`}
            segment={segment}
            hatch={hatch}
          />
        ))}
        {at === undefined ? null : (
          <line
            className="context-threshold-rule"
            x1={at}
            x2={at}
            y1="0"
            y2="100%"
          />
        )}
      </svg>
    </div>
  );
}

function ContextLegendTokens(props: {
  readonly row: ContextCategoryRow;
}): ReactNode {
  const text = useCopyText();
  const { row } = props;
  if (row.tokens === undefined) return text({ id: "context-not-recorded" });
  return groupedDigits(row.tokens);
}

function ContextLegendShare(props: {
  readonly row: ContextCategoryRow;
}): ReactNode {
  const text = useCopyText();
  const { row } = props;
  if (row.kind === "Deferred") return text({ id: "context-unloaded" });
  return row.share === undefined ? null : <Figure figure={row.share} />;
}

function ContextLegend(props: { readonly view: ContextWindowView }): ReactNode {
  const text = useCopyText();
  return (
    <div className="context-legend">
      <Table caption={text({ id: "context-window-title" })}>
        <thead>
          <tr>
            <th scope="col">{text({ id: "context-col-category" })}</th>
            <th scope="col" className="num">
              {text({ id: "context-col-tokens" })}
            </th>
            <th scope="col" className="num">
              {text({ id: "context-col-share" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.view.rows.map((row, index) => (
            <tr key={index} data-kind={row.kind}>
              <td>
                <span className="context-legend-name">
                  <span
                    className="context-swatch"
                    data-kind={row.kind}
                    data-slot={row.slot}
                    aria-hidden="true"
                  />
                  {contextNameText(text, row.name)}
                </span>
              </td>
              <td className="num">
                <ContextLegendTokens row={row} />
              </td>
              <td className="num">
                <ContextLegendShare row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function ContextWindowSection(props: {
  readonly view: ContextWindowView;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  return (
    <section className="context-section" aria-labelledby={titleId}>
      <header className="context-head">
        <h3 className="context-title" id={titleId}>
          {text({ id: "context-window-title" })}
        </h3>
        <ContextWindowAt view={props.view} />
      </header>
      <ContextUsed view={props.view} />
      {props.view.segments.length === 0 ? null : (
        <ContextBar view={props.view} />
      )}
      <ContextLegend view={props.view} />
    </section>
  );
}
