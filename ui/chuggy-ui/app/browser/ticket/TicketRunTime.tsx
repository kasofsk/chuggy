/**
 * A run's time, or a set's, as the ticket's pages draw it: how long it ran,
 * with its wait beside it where that is long enough to read, or that it waits
 * and for how long.
 *
 * What is drawn is `core/figures.ts`'s reading of `core/runTotals.ts`'s sums.
 * Inline by default; a cell the stylesheet stacks puts the wait under the run.
 * A line that says its run is still going says so only once something took it.
 */

import type { ReactNode } from "react";

import { runTimeLineOf } from "../../core/figures.ts";
import { runTimeOf } from "../../core/runTotals.ts";
import type { RunTimed } from "../../core/runTotals.ts";
import { Figure } from "../ui/Figure.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

import "./ticket.css";

export function TicketRunTime(props: {
  readonly runs: readonly RunTimed[];
  readonly nowMs: number;
  readonly running?: boolean;
}): ReactNode {
  const line = runTimeLineOf(runTimeOf(props.runs, props.nowMs));
  const text = useCopyText();
  switch (line.line) {
    case "Waiting":
      return (
        <span className="ticket-run-time" data-line="waiting">
          <span className="ticket-run-time-main">
            {text({ id: "ticket-waiting" })}
          </span>
          <span className="ticket-run-time-waited">
            <Figure figure={line.waited} />
          </span>
        </span>
      );
    case "Ran":
      return (
        <span className="ticket-run-time" data-line="ran">
          <span className="ticket-run-time-main">
            {props.running === true
              ? `${text({ id: "ticket-run-time-running" })} · `
              : null}
            <Figure figure={line.ran} />
          </span>
          {line.waited === undefined ? null : (
            <span className="ticket-run-time-waited">
              {text({ id: "ticket-waited-lower" })}{" "}
              <Figure figure={line.waited} />
            </span>
          )}
        </span>
      );
  }
}
