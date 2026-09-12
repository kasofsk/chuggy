/**
 * What a drawn ticket reference is told about the ticket it names, and what
 * following it does.
 *
 * A REFERENCE SITS TOO DEEP TO BE HANDED ANYTHING. It is at the inline grain of
 * a report, under a card, under an exchange, under a pane, and every part
 * between them takes only the text. So what the chip cannot derive from the
 * number arrives here instead, and the primitive stays a primitive: it draws
 * what it is told and reads nothing, which is what lets a report mount in a
 * suite with no provider at all.
 *
 * IT IS OPTIONAL, AND THE ABSENT CASE IS THE CONTRACT'S OWN. With no provider —
 * a report drawn outside a shell, a surface under test — a reference draws the
 * ticket number alone, which is exactly what the agent's objectives promise a
 * reference falls back to.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { TicketPhase } from "../../../../../src/contract/rosters.ts";

/** What a reference can say beyond the number, where the project has it to
 * hand. */
export interface TicketReferenceFacts {
  readonly title: string | undefined;
  readonly phase: TicketPhase;
}

export interface TicketReferenceHeld {
  /** The ticket as the project last read it, or nothing where this reader has
   * not read it — a reference still draws, with the number alone. */
  readonly factsOf: (ticket: number) => TicketReferenceFacts | undefined;
  /** Where the ticket's own screen is, which the number alone settles: it is a
   * path under the open project and needs no read. */
  readonly hrefOf: (ticket: number) => string;
  /** Following the reference, which is a navigation the shell owns rather than
   * a page load. */
  readonly open: (ticket: number) => void;
}

const ticketReferenceContext = createContext<TicketReferenceHeld | undefined>(
  undefined,
);

export function TicketReferenceProvider(props: {
  readonly held: TicketReferenceHeld;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ticketReferenceContext.Provider value={props.held}>
      {props.children}
    </ticketReferenceContext.Provider>
  );
}

export function useTicketReferenceHeld(): TicketReferenceHeld | undefined {
  return useContext(ticketReferenceContext);
}
