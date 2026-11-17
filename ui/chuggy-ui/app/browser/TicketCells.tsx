/**
 * The pieces every screen of tickets draws the same way.
 *
 * The title and the number are a link pair defined once — `TicketTitleWords`
 * and `TicketTitleNumber` — both linking to that ticket's page wherever they
 * are drawn, so a screen that built its own `Link` would be a second place the
 * path has to change. The execution chip and the activity piece are the same
 * arrangement: whether a row's execution draws as a chip, and how long ago a
 * ticket last moved, are read in one place rather than drawn on two screens as
 * two answers that happen to agree today.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { agoFigure } from "../core/figures.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { verdictTone } from "../core/tones.ts";
import { Figure } from "./ui/Figure.tsx";
import { StatusBadge } from "./ui/StatusBadge.tsx";

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

/** A row's execution drawn as its own chip where the row carries one, in the
 * word and hue the ticket's ledger draws it in, and as the dim dash where it
 * carries none. */
export function TicketRowExecutionCell(props: {
  readonly row: ProjectTableRow;
}): ReactNode {
  const verdict = props.row.executionVerdict;
  if (verdict === undefined)
    return <span className="text-ink-3">{cellAbsent}</span>;
  return (
    <StatusBadge tone={verdictTone(verdict)} size="small">
      {verdict}
    </StatusBadge>
  );
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
