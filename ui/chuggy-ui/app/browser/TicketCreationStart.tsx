/**
 * The screen the new-ticket address draws: a new ticket, one started from the
 * ticket the address names, or one written on the draft it names.
 *
 * Each is keyed by where it starts, because a change of search alone keeps a
 * route's component and the form it holds.
 */

import type { ReactNode } from "react";

import type { TicketCreationQuery } from "../core/ticketCreationQuery.ts";
import { TicketCreation } from "./TicketCreation.tsx";
import { TicketCreationDraft } from "./TicketCreationDraft.tsx";
import { TicketDuplicate } from "./TicketDuplicate.tsx";

export function TicketCreationFrom(props: {
  readonly from?: TicketCreationQuery["from"] | undefined;
  readonly draft?: TicketCreationQuery["draft"] | undefined;
}): ReactNode {
  if (props.draft !== undefined)
    return (
      <TicketCreationDraft
        key={`draft/${String(props.draft)}`}
        draft={props.draft}
      />
    );
  return props.from === undefined ? (
    <TicketCreation key="new" />
  ) : (
    <TicketDuplicate key={`from/${String(props.from)}`} from={props.from} />
  );
}
