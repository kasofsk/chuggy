/**
 * The edit screen, offered on a ticket that admits an update. It is a link and
 * not a submission, because what an update sends is written on that screen.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { ticketEditEffect } from "../../core/codeLabels.ts";
import { ButtonLink } from "../ui/Button.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

export function TicketEditOffer(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="act">
      <div className="act-head">
        <ButtonLink
          to="/$tenant/$project/tickets/$ticket/edit"
          params={{ ...props.partition, ticket: String(props.ticket) }}
        >
          {text({ id: "ticket-edit" })}
        </ButtonLink>
      </div>
      <p className="act-effect">{text(ticketEditEffect)}</p>
    </div>
  );
}
