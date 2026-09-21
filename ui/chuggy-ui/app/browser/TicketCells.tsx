/**
 * The cells every table of tickets draws the same way.
 *
 * The ticket's number and its title are one cell now, the row's own header,
 * both linking to that ticket's page wherever the cell appears, so a table
 * that drew its own would be a second place the path has to change. The
 * execution columns are the same arrangement for a different reason: a dash
 * meaning "not read" and a dash meaning "never ran" are the same dash, and
 * which one a row shows — and whether it draws as a chip at all — is a
 * decision two screens must not answer differently. The activity cell is the
 * same arrangement again: a ticket's last movement is one instant however it
 * is joined, so it is read as how long ago it was in one place rather than
 * drawn on two screens as two strings that happen to agree today.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { agoFigure } from "../core/figures.ts";
import { projectTableExecutionPhrase } from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { executionTone } from "../core/tones.ts";
import { Figure } from "./ui/Figure.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export const cellAbsent = "—";

export const cellExecutionUnread = "not read";

/** What the ticket is called, and its number beside it, both linking to the
 * ticket page. A ticket whose brief states nothing a title could be read out
 * of has none, but the number still links. */
export function TicketTitleCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  const params = { ...props.partition, ticket: String(props.ticket) };
  return (
    <th scope="row">
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
      <Link
        className="ticket-row-number"
        to="/$tenant/$project/tickets/$ticket"
        params={params}
      >
        {props.ticket}
      </Link>
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

/** An execution column drawn as its own chip where a status is known, and as
 * plain dim text where nothing is joined or the index did not reach this row
 * — a chip would claim a standing the row does not have. */
export function TicketRowExecutionCell(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const row = props.row;
  const phrase = projectTableExecutionPhrase(row);
  if (phrase === undefined || row.executionStatus === undefined)
    return (
      <span className="text-ink-3">
        {ticketRowExecutionCell(row, undefined)}
      </span>
    );
  return (
    <Pill tone={executionTone(row.executionStatus, row.executionOutcome)}>
      {phrase}
    </Pill>
  );
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
