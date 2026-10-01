/**
 * Revoke, asked before it is sent, because a revoked ticket is final. Anything
 * else submitted for the ticket closes the ask, and a revoke in flight keeps it
 * drawn, busy, until its follow finishes.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { operationFinished } from "../../core/operationFollow.ts";
import type { OperationStep } from "../../core/operationFollow.ts";
import type { TicketAction } from "../../core/ticketActions.ts";
import { Confirm } from "../ui/Confirm.tsx";

/** What was last pressed for the ticket and how far its follow has got. */
export interface TicketRevokeStanding {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

export interface TicketRevokeAsk {
  readonly open: boolean;
  readonly busy: boolean;
  readonly toggle: () => void;
  readonly cancel: () => void;
}

export function useTicketRevokeAsk(
  standing: TicketRevokeStanding | undefined,
): TicketRevokeAsk {
  const [asked, setAsked] = useState(false);
  const [standingSeen, setStandingSeen] = useState(standing);
  if (standingSeen !== standing) {
    setStandingSeen(standing);
    setAsked(false);
  }
  const busy =
    standing !== undefined &&
    standing.action.action === "Revoke" &&
    !operationFinished(standing.step);
  return {
    open: busy || asked,
    busy,
    toggle: () => {
      setAsked(!asked);
    },
    cancel: () => {
      setAsked(false);
    },
  };
}

export function TicketRevokeConfirm(props: {
  readonly ask: TicketRevokeAsk;
  readonly onRevoke: () => void;
}): ReactNode {
  return (
    <Confirm
      question="Revoke this ticket?"
      confirm="Revoke ticket"
      busy={props.ask.busy}
      onConfirm={props.onRevoke}
      onCancel={props.ask.cancel}
    >
      Ends this ticket and parks its dependents. Can't be undone.
    </Confirm>
  );
}
