/**
 * The ticket's state on the page's action bar: the list's chip, which where a
 * dispatch is offered is the button that asks for it.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { phaseLabel } from "../../core/codeLabels.ts";
import { ticketListStandingOf } from "../../core/ticketListView.ts";
import { TicketActionConfirm } from "./TicketActionConfirm.tsx";
import { TicketStateChip } from "./TicketStateChip.tsx";

export function TicketStateAction(props: {
  readonly ticket: TicketResponse;
  /** The dispatch on offer, answered once confirmed. */
  readonly dispatch:
    | {
        readonly effect: string;
        readonly busy: boolean;
        readonly send: () => void;
      }
    | undefined;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  const { ticket, dispatch } = props;
  const standing = ticketListStandingOf(ticket);
  const unfinished =
    ticket.openDependencies.length + ticket.revokedDependencies.length;
  return (
    <>
      <TicketStateChip
        ticket={ticket.ticket}
        standing={standing}
        hint={
          standing === "Blocked"
            ? `Blocked · ${String(unfinished)} unfinished ${unfinished === 1 ? "dependency" : "dependencies"}`
            : phaseLabel(ticket.phase)
        }
        dispatch={
          dispatch === undefined
            ? undefined
            : {
                busy: dispatch.busy,
                effect: dispatch.effect,
                press: () => {
                  setAsking(true);
                },
              }
        }
      />
      {dispatch === undefined ? null : (
        <TicketActionConfirm
          title={`Dispatch ticket #${String(ticket.ticket)}?`}
          confirm="Dispatch"
          open={asking}
          onOpenChange={setAsking}
          onConfirm={dispatch.send}
        >
          {dispatch.effect}
        </TicketActionConfirm>
      )}
    </>
  );
}
