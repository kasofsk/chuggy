/**
 * The cells every table of tickets draws the same way.
 *
 * A ticket number is the link to that ticket's page wherever it appears, so the
 * route and the parameters it is built from are written once; a table that
 * spelled its own would be a second place the path has to change. The execution
 * columns are the same arrangement for a different reason: a dash meaning "not
 * read" and a dash meaning "never ran" are the same dash, and which one a row
 * shows is a decision two screens must not answer differently.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";

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

/** What an execution column says when there is nothing to join, which is not
 * the same thing as a dash. */
export function ticketRowExecutionCell(
  row: ProjectTableRow,
  drawn: string | undefined,
): string {
  if (row.executionRead === "IndexTruncated") return cellExecutionUnread;
  return drawn ?? cellAbsent;
}
