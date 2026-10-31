/**
 * The pieces every screen of tickets draws the same way, and the table cells
 * the inbox wraps them in.
 *
 * The title and the number are a link pair defined once — `TicketTitleWords`
 * and `TicketTitleNumber` — both linking to that ticket's page wherever they
 * are drawn, so a screen that built its own `Link` would be a second place the
 * path has to change. `TicketTitleCell` is the `th` the inbox's table needs
 * around them; a screen that is not a table takes the pieces directly. The
 * execution column and the activity piece are the same arrangement: whether a
 * row's execution draws as a chip, and how long ago a ticket last moved, are
 * read in one place rather than drawn on two screens as two answers that
 * happen to agree today.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { agoFigure } from "../core/figures.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { verdictTone } from "../core/tones.ts";
import { Figure } from "./ui/Figure.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

export const cellAbsent = "—";

/** What the ticket is called: the title, or the dash a brief that names none
 * still draws, linking to the ticket page. Undecorated, so a screen that does
 * not clip a long title is free not to. */
export function TicketTitleWords(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  const params = { ...props.partition, ticket: String(props.ticket) };
  return props.title === undefined ? (
    <span className="text-ink-3">{cellAbsent}</span>
  ) : (
    <Link to="/$tenant/$project/tickets/$ticket" params={params}>
      {props.title}
    </Link>
  );
}

/** The ticket's number, dim and mono, linking to the same page as its title. */
export function TicketTitleNumber(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const params = { ...props.partition, ticket: String(props.ticket) };
  return (
    <Link
      className="ticket-row-number"
      to="/$tenant/$project/tickets/$ticket"
      params={params}
    >
      {props.ticket}
    </Link>
  );
}

/** The inbox's own title column: the words clipped at `max-w-aside` with the
 * whole title on hover, the number beside them. */
export function TicketTitleCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  return (
    <th scope="row">
      {props.title === undefined ? (
        <TicketTitleWords {...props} />
      ) : (
        <Tooltip text={props.title}>
          <span className="max-w-aside inline-block truncate align-bottom">
            <TicketTitleWords {...props} />
          </span>
        </Tooltip>
      )}
      <TicketTitleNumber partition={props.partition} ticket={props.ticket} />
    </th>
  );
}

/** An execution column drawn as its own chip where an execution is joined, in
 * the word and hue the ticket's ledger draws it in, and as the dim dash where
 * nothing is joined. */
export function TicketRowExecutionCell(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const verdict = props.row.executionVerdict;
  if (verdict === undefined)
    return <span className="text-ink-3">{cellAbsent}</span>;
  return <Pill tone={verdictTone(verdict)}>{verdict}</Pill>;
}

/** A ticket's last activity, wherever it is drawn: how long ago it was,
 * carrying the full instant on hover. A row with no ticket body — an inbox
 * entry whose ticket is not read yet — has no instant of its own and keeps
 * the dash. */
export function TicketActivity(props: {
  readonly activityAt: string | undefined;
  readonly nowMs: number;
}): ReactNode {
  return props.activityAt === undefined ? (
    cellAbsent
  ) : (
    <Figure figure={agoFigure(props.activityAt, props.nowMs)} />
  );
}

/** The inbox's own activity column, dim around the piece above. */
export function TicketActivityCell(props: {
  readonly activityAt: string | undefined;
  readonly nowMs: number;
}): ReactNode {
  return (
    <td className="text-ink-3">
      <TicketActivity {...props} />
    </td>
  );
}
