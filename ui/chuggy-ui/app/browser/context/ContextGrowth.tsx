/**
 * The Growth section of a Context view: its tiles, and the chart of the context
 * at each call or turn with the threshold dashed, each compaction a labelled
 * rule, and the subagent calls a series of their own.
 *
 * The chart is laid out by `contextChartOf` for the width its box measures, so
 * every mark is drawn in pixels the stylesheet's text sizes agree with; a hover
 * or an arrow key names the nearest point, its tokens and its move.
 */

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ContextChart } from "../../core/contextChart.ts";
import {
  contextChartAt,
  contextChartNearest,
  contextChartOf,
  contextChartTipAt,
  contextChartWidthDefault,
} from "../../core/contextChart.ts";
import type {
  ContextGrowthView,
  ContextPoint,
  ContextTile,
} from "../../core/contextView.ts";
import { contextPeakOf, contextPointSaid } from "../../core/contextView.ts";
import { groupedDigits } from "../../core/figures.ts";
import { contextNameText } from "./ContextWindow.tsx";

/** The hover's note's size before it has been measured. */
const contextTipSizeDefault = { width: 180, height: 72 };

/** The size the hover's note lays out at, measured before the browser paints
 * each point it names, as a tooltip is. */
function useContextTipSize(
  point: ContextPoint,
): [
  RefObject<HTMLDivElement | null>,
  { readonly width: number; readonly height: number },
] {
  const tip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(contextTipSizeDefault);
  useLayoutEffect(() => {
    const box = tip.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    setSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
  }, [point]);
  return [tip, size];
}

function useMeasuredWidth(): [
  (element: HTMLDivElement | null) => void,
  number,
] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(contextChartWidthDefault);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setWidth(Math.round(measured));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, [element]);
  return [setElement, width];
}

function ContextChartAxes(props: { readonly chart: ContextChart }): ReactNode {
  const text = useCopyText();
  const { chart } = props;
  const { plot } = chart;
  return (
    <g>
      {chart.yTicks.map((tick, index) => (
        <g key={`y${String(index)}`}>
          <line
            className="context-chart-grid"
            x1={plot.left}
            x2={plot.right}
            y1={tick.at}
            y2={tick.at}
          />
          <text
            className="context-chart-tick"
            x={plot.left - 6}
            y={tick.at}
            textAnchor="end"
            dominantBaseline="central"
          >
            {contextNameText(text, tick.label)}
          </text>
        </g>
      ))}
      <line
        className="context-chart-axis"
        x1={plot.left}
        x2={plot.right}
        y1={plot.bottom}
        y2={plot.bottom}
      />
      {chart.xTicks.map((tick, index) => (
        <text
          key={`x${String(index)}`}
          className="context-chart-tick"
          x={tick.at}
          y={plot.bottom + 14}
          textAnchor={index === 0 ? "start" : "middle"}
        >
          {contextNameText(text, tick.label)}
        </text>
      ))}
    </g>
  );
}

function ContextChartSeries(props: {
  readonly chart: ContextChart;
}): ReactNode {
  const { chart } = props;
  return (
    <g>
      {chart.main.map((piece, index) => (
        <g key={`m${String(index)}`}>
          {piece.area === undefined ? null : (
            <path className="context-chart-area" d={piece.area} />
          )}
          <path
            className="context-chart-line"
            data-series="Main"
            d={piece.line}
          />
        </g>
      ))}
      {chart.subagent.map((piece, index) => (
        <g key={`s${String(index)}`}>
          <path
            className="context-chart-line"
            data-series="Subagent"
            d={piece.line}
          />
          {piece.ends.map((end, at) => (
            <circle
              key={at}
              className="context-chart-dot"
              cx={end.x}
              cy={end.y}
              r="2.5"
            />
          ))}
        </g>
      ))}
    </g>
  );
}

/** The threshold and each compaction, over the series they bound. */
function ContextChartRules(props: { readonly chart: ContextChart }): ReactNode {
  const text = useCopyText();
  const { chart } = props;
  const { plot } = chart;
  return (
    <g>
      {chart.threshold === undefined ? null : (
        <g>
          <line
            className="context-chart-threshold"
            x1={plot.left}
            x2={plot.right}
            y1={chart.threshold.y}
            y2={chart.threshold.y}
          />
          <text
            className="context-chart-label"
            x={plot.left + 4}
            y={chart.threshold.labelY}
          >
            {text(chart.threshold.label)}
          </text>
        </g>
      )}
      {chart.compactions.map((mark, index) => (
        <g key={`c${String(index)}`}>
          <line
            className="context-chart-rule"
            x1={mark.x}
            x2={mark.x}
            y1={plot.top - 4}
            y2={plot.bottom}
          />
          <text
            className="context-chart-label"
            x={mark.x + 4}
            y={plot.top - 6}
            textAnchor={mark.x > (plot.left + plot.right) / 2 ? "end" : "start"}
          >
            {text(mark.label)}
          </text>
        </g>
      ))}
    </g>
  );
}

function ContextChartTip(props: {
  readonly view: ContextGrowthView;
  readonly chart: ContextChart;
  readonly point: ContextPoint;
}): ReactNode {
  const text = useCopyText();
  const { view, chart, point } = props;
  const at = contextChartAt(view, chart, point);
  const { plot } = chart;
  const [measured, size] = useContextTipSize(point);
  const tip = contextChartTipAt(chart, at, size);
  return (
    <g pointerEvents="none">
      <line
        className="context-chart-cross"
        x1={at.x}
        x2={at.x}
        y1={plot.top}
        y2={plot.bottom}
      />
      <circle
        className="context-chart-point"
        data-series={point.series}
        cx={at.x}
        cy={at.y}
        r="4"
      />
      <foreignObject
        x={tip.x}
        y={tip.y}
        width={size.width}
        height={size.height}
      >
        <div className="context-chart-tip" ref={measured}>
          {contextPointSaid(view, point).map((line, index) => (
            <span key={index}>{text(line)}</span>
          ))}
        </div>
      </foreignObject>
    </g>
  );
}

/** The point an arrow key moves to from `from`, in the order the axis runs. */
function contextPointStepped(
  points: readonly ContextPoint[],
  from: ContextPoint | undefined,
  step: number,
): ContextPoint | undefined {
  if (points.length === 0) return undefined;
  if (from === undefined) return step > 0 ? points[0] : points.at(-1);
  const index = points.indexOf(from);
  return points[Math.min(Math.max(index + step, 0), points.length - 1)];
}

function ContextChartDrawn(props: {
  readonly view: ContextGrowthView;
}): ReactNode {
  const text = useCopyText();
  const { view } = props;
  const [measure, width] = useMeasuredWidth();
  const [hovered, setHovered] = useState<ContextPoint | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const chart = contextChartOf(view, width);
  const shown =
    hovered !== undefined && view.points.includes(hovered)
      ? hovered
      : undefined;
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (box === undefined) return;
    setHovered(contextChartNearest(view, chart, event.clientX - box.left));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setHovered(contextPointStepped(view.points, shown, step));
  };
  return (
    <div className="context-chart" ref={measure}>
      <svg
        ref={svg}
        width={chart.width}
        height={chart.height}
        viewBox={`0 0 ${String(chart.width)} ${String(chart.height)}`}
        role="img"
        aria-label={text({ id: "context-chart-label" })}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setHovered(undefined);
        }}
      >
        <ContextChartAxes chart={chart} />
        <ContextChartSeries chart={chart} />
        <ContextChartRules chart={chart} />
        <rect
          className="context-chart-hit"
          x={chart.plot.left}
          y={chart.plot.top}
          width={chart.plot.right - chart.plot.left}
          height={chart.plot.bottom - chart.plot.top}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            setHovered(undefined);
          }}
        />
        {shown === undefined ? null : (
          <ContextChartTip view={view} chart={chart} point={shown} />
        )}
      </svg>
    </div>
  );
}

function ContextChartKey(props: {
  readonly view: ContextGrowthView;
}): ReactNode {
  const text = useCopyText();
  const { view } = props;
  const subagent = view.points.some((point) => point.series === "Subagent");
  return (
    <ul className="context-key">
      <li>
        <span
          className="context-key-mark"
          data-mark="Main"
          aria-hidden="true"
        />
        {text({
          id: subagent ? "context-legend-main" : "context-legend-context",
        })}
      </li>
      {subagent ? (
        <li>
          <span
            className="context-key-mark"
            data-mark="Subagent"
            aria-hidden="true"
          />
          {text({ id: "context-legend-subagent" })}
        </li>
      ) : null}
      {view.threshold === undefined ? null : (
        <li>
          <span
            className="context-key-mark"
            data-mark="Threshold"
            aria-hidden="true"
          />
          {text({ id: "context-legend-threshold" })}
        </li>
      )}
      {view.compactions.length === 0 ? null : (
        <li>
          <span
            className="context-key-mark"
            data-mark="Compaction"
            aria-hidden="true"
          />
          {text({ id: "context-legend-compaction" })}
        </li>
      )}
    </ul>
  );
}

function ContextTiles(props: {
  readonly tiles: readonly ContextTile[];
}): ReactNode {
  const text = useCopyText();
  return (
    <dl className="context-tiles">
      {props.tiles.map((tile) => (
        <div className="context-tile" key={tile.name.id}>
          <dt>{text(tile.name)}</dt>
          <dd className="context-tile-figure">
            {contextNameText(text, tile.value)}
          </dd>
          {tile.note === undefined ? null : (
            <dd className="context-tile-note">{text(tile.note)}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** The compact form's figures in one line: the peak, the count, the compactions. */
function ContextStats(props: { readonly view: ContextGrowthView }): ReactNode {
  const text = useCopyText();
  const { view } = props;
  const peak = contextPeakOf(view);
  return (
    <ul className="context-stats">
      <li>
        {text({ id: "context-peak" })}{" "}
        <strong>
          {peak === undefined
            ? text({ id: "context-none" })
            : groupedDigits(peak.tokens)}
        </strong>
      </li>
      <li>
        {text({ id: view.unit === "Turn" ? "context-turns" : "context-calls" })}{" "}
        <strong>{groupedDigits(view.count)}</strong>
      </li>
      <li>
        {text({ id: "context-compactions" })}{" "}
        <strong>
          {view.compactions.length === 0
            ? text({ id: "context-none" })
            : groupedDigits(view.compactions.length)}
        </strong>
      </li>
    </ul>
  );
}

export function ContextGrowthSection(props: {
  readonly view: ContextGrowthView;
  /** The run's tiles; the compact form has none, and says its figures in a line. */
  readonly tiles: readonly ContextTile[] | undefined;
}): ReactNode {
  const text = useCopyText();
  const titleId = useId();
  const { view } = props;
  return (
    <section className="context-section" aria-labelledby={titleId}>
      <header className="context-head">
        <h3 className="context-title" id={titleId}>
          {text({ id: "context-growth-title" })}
        </h3>
        <span className="context-meta">
          {text({
            id: view.unit === "Turn" ? "context-per-turn" : "context-per-call",
          })}
        </span>
      </header>
      {props.tiles === undefined ? (
        <ContextStats view={view} />
      ) : (
        <ContextTiles tiles={props.tiles} />
      )}
      {view.points.length === 0 ? (
        <p className="context-muted">
          {text({
            id:
              view.unit === "Turn"
                ? "context-growth-none-turns"
                : "context-growth-none",
          })}
        </p>
      ) : (
        <>
          <ContextChartDrawn view={view} />
          <ContextChartKey view={view} />
        </>
      )}
    </section>
  );
}
