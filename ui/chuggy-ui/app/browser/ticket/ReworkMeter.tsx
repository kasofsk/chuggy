/**
 * The ticket's work cycles against the most its release allows, as one figure
 * with a track under it.
 *
 * Total over `reworkMeterStates` — a ticket with room, one at its limit, one
 * counted past it, and one nothing bounds. The arithmetic and every word are
 * `core/ticketMeter.ts`'s, so this draws a meter and decides nothing about one.
 *
 * AN UNBOUNDED TICKET HAS NO TRACK. There is no ceiling to draw against, and a
 * full bar would say the ticket had used everything it had; the hatched band
 * says there is no end to fill instead.
 *
 * THE CELLS ARE ELEMENTS RATHER THAN A WIDTH, because the served policy admits
 * no inline style and a width computed in script is exactly that. Above a
 * dozen they stop being countable and a native `meter` is the better drawing.
 */

import type { ReactNode } from "react";

import type { ReworkMeter as ReworkMeterValue } from "../../core/ticketMeter.ts";

import "./ReworkMeter.css";

/** Above this a limit is a bar rather than a cell per cycle a reader can count. */
export const reworkMeterCellsMax = 12;

function MeterCells(props: { readonly meter: ReworkMeterValue }): ReactNode {
  const limit = props.meter.limit ?? 0;
  if (limit > reworkMeterCellsMax)
    return (
      <meter className="meter-native" value={props.meter.started} max={limit} />
    );
  return (
    <div className="meter-cells" aria-hidden="true">
      {Array.from({ length: limit }, (_cell, index) => (
        <i
          key={index}
          className={
            index < props.meter.started
              ? "meter-cell meter-cell-started"
              : "meter-cell meter-cell-left"
          }
        />
      ))}
    </div>
  );
}

/**
 * A limit of zero has no cells, which is the honest drawing of a release that
 * paid for no cycle: the figure beside it is what says so.
 */
function MeterTrack(props: { readonly meter: ReworkMeterValue }): ReactNode {
  if (props.meter.state === "Unbounded")
    return <div className="meter-bar-unbounded" aria-hidden="true" />;
  if ((props.meter.limit ?? 0) === 0) return null;
  return <MeterCells meter={props.meter} />;
}

export function ReworkMeter(props: {
  readonly name: string;
  readonly meter: ReworkMeterValue;
  readonly how?: string;
}): ReactNode {
  return (
    <div
      className={`meter meter-${props.meter.state.toLowerCase()}`}
      role="group"
      aria-label={props.meter.spoken}
    >
      <p className="meter-line">
        <span className="meter-name">{props.name}</span>
        <span className="meter-figure num">{props.meter.figure}</span>
      </p>
      <MeterTrack meter={props.meter} />
      {props.how === undefined ? null : (
        <p className="meter-how">{props.how}</p>
      )}
    </div>
  );
}
