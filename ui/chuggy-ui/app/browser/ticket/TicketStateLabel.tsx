/**
 * A ticket's state as one status badge, in the tone and word its label is
 * given: regular where it heads the ticket or a row, small in a bar, and
 * compact where only its mark is drawn and its word is left to assistive
 * technology. Never a button.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { TicketStateStanding } from "../../core/ticketHeader.ts";
import { ticketStateLabelOf } from "../../core/ticketHeader.ts";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import type { StatusBadgeSize } from "../ui/StatusBadge.tsx";

export function TicketStateLabel(props: {
  readonly standing: TicketStateStanding;
  readonly size: StatusBadgeSize;
  readonly compact?: boolean | undefined;
}): ReactNode {
  const label = ticketStateLabelOf(props.standing);
  const text = useCopyText();
  return (
    <StatusBadge tone={label.tone} size={props.size} compact={props.compact}>
      {text(label.word)}
    </StatusBadge>
  );
}
