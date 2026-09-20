/**
 * The coded values the wire sends a person, as the sentences they read.
 *
 * The same rosters `codeLabels.ts` speaks for, at the length a reader who
 * stopped on a cell wants: what the state means, rather than the word it is
 * drawn as. Total over its roster for the same reason, and reduced to the
 * roster the adopted ticket read actually carries — a sentence explaining a
 * state that cannot arrive explains nothing to anybody.
 *
 * A SENTENCE SAYS WHAT THE MACHINE HOLDS, NOT WHY. The state is the whole of
 * what the read carries: `Escalated` is on the wire and the escalation it
 * holds is not, so these say a person is waited on and do not guess at which
 * wall was hit.
 */

import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";

/** What being in this state means for the ticket, in one line. */
export function adoptedTicketStateSentence(
  state: AdoptedTicket["state"],
): string {
  switch (state) {
    case "Pending":
      return "the ticket is authored and the machine has not started it";
    case "Work":
      return "an execution is doing this ticket's work";
    case "Evaluation":
      return "the work is being evaluated against the plan the ticket names";
    case "Finalization":
      return "the evaluated work is being landed the way the ticket asks";
    case "Escalated":
      return "the machine stopped on this ticket and is waiting for a person";
    case "Done":
      return "the ticket finished and the machine will not run it again";
    case "Revoked":
      return "the ticket was called off, so nothing further will run for it";
  }
}
