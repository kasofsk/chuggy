/**
 * The cells every table of tickets draws the same way.
 *
 * A ticket's number and its title are both links to that ticket's page
 * wherever they appear, drawn by one cell rather than two so a table that drew
 * its own would be a second place the route has to change. The execution
 * columns are the same arrangement for a different
 * reason: a dash meaning "not read" and a dash meaning "never ran" are the same
 * dash, and which one a row shows is a decision two screens must not answer
 * differently. The activity cell is the same arrangement again: a ticket's
 * last movement is one instant however it is joined, so it is read as how
 * long ago it was in one place rather than drawn on two screens as two
 * strings that happen to agree today.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { agoFigure } from "../core/figures.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { Figure } from "./ui/Figure.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export const cellAbsent = "—";

export const cellExecutionUnread = "not read";

/** The row's heading: the ticket number dim beside it, the title in the row's
 * own ink carrying the weight a heading needs. A ticket whose brief states
 * nothing a title could be read out of has none, and the number still links
 * alone. */
export function TicketTitleCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  const params = { ...props.partition, ticket: String(props.ticket) };
  return (
    <th scope="row" className="title-cell">
      <span className="inline-flex items-baseline gap-2">
        <Link
          to="/$tenant/$project/tickets/$ticket"
          params={params}
          className="text-ink-3 font-mono"
        >
          {props.ticket}
        </Link>
        {props.title === undefined ? (
          <span className="text-ink-3">{cellAbsent}</span>
        ) : (
          <Tooltip text={props.title}>
            <span className="max-w-aside inline-block truncate align-bottom">
              <Link to="/$tenant/$project/tickets/$ticket" params={params}>
                {props.title}
              </Link>
            </span>
          </Tooltip>
        )}
      </span>
    </th>
  );
}

/** What an execution column says when there is nothing to join, which is not
 * the same thing as a dash. */
export function ticketRowExecutionCell(
  row: ProjectTableRow,
  drawn: string | undefined,
): string {
  if (row.executionRead === "IndexTruncated") return cellExecutionUnread;
  return drawn ?? cellAbsent;
}

/** A ticket's last activity, wherever a table draws it: how long ago it was,
 * carrying the full instant on hover. A row with no ticket body — an inbox
 * entry a phase page never answered — has no instant of its own and keeps
 * the dash. */
export function TicketActivityCell(props: {
  readonly activityAt: string | undefined;
  readonly nowMs: number;
}): ReactNode {
  return (
    <td className="text-ink-3">
      {props.activityAt === undefined ? (
        cellAbsent
      ) : (
        <Figure figure={agoFigure(props.activityAt, props.nowMs)} />
      )}
    </td>
  );
}
