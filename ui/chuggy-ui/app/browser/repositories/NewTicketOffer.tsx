/**
 * The next step a line about a repository offers once the project holds a
 * configuration for it: a first ticket, after the words that say so.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";

export function NewTicketOffer(props: {
  readonly partition: PartitionIdentity;
  readonly offered: boolean;
}): ReactNode {
  if (!props.offered) return null;
  return (
    <>
      {" · "}
      <Link to="/$tenant/$project/tickets/new" params={props.partition}>
        New ticket
      </Link>
    </>
  );
}
