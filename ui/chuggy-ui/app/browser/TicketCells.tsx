/**
 * The cells every table of tickets draws the same way.
 *
 * A ticket number and the title beside it are both links to that ticket's page
 * wherever they appear, so the route and the parameters they are built from are
 * written once; a table that spelled its own would be a second place the path
 * has to change. The execution columns are the same arrangement for a different
 * reason: a dash meaning "not read" and a dash meaning "never ran" are the same
 * dash, and which one a row shows is a decision two screens must not answer
 * differently.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { Tooltip } from "./ui/Tooltip.tsx";

export const cellAbsent = "—";

export const cellExecutionUnread = "not read";

export function TicketNumberCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  return (
    <th scope="row">
      <Link
        to="/$tenant/$project/tickets/$ticket"
        params={{ ...props.partition, ticket: String(props.ticket) }}
      >
        {props.ticket}
      </Link>
    </th>
  );
}

/** What the ticket is called, linking where its number does. A ticket whose
 * brief states nothing a title could be read out of has none. */
export function TicketTitleCell(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly title: string | undefined;
}): ReactNode {
  return (
    <td>
      {props.title === undefined ? (
        <span className="text-ink-3">{cellAbsent}</span>
      ) : (
        <Tooltip text={props.title}>
          <span className="max-w-aside inline-block truncate align-bottom">
            <Link
              to="/$tenant/$project/tickets/$ticket"
              params={{ ...props.partition, ticket: String(props.ticket) }}
            >
              {props.title}
            </Link>
          </span>
        </Tooltip>
      )}
    </td>
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
