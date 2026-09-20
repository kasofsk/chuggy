/**
 * The coded values the wire sends a person, as the short labels a table draws
 * them in.
 *
 * A code is the API's word to another program, and a screen that prints one
 * makes its reader look it up with nowhere to look. The switch is total over
 * the roster it speaks for, so a state the wire gains stops compiling here
 * rather than reaching a reader as an unexplained word.
 *
 * ONLY THE ADOPTED ROSTER IS SPOKEN FOR. A label for a state this roster does
 * not hold is a label for a state that cannot arrive: nothing reaches it, no
 * case covers it, and it reads to the next author as vocabulary the console
 * still has a use for.
 *
 * WHY THIS IS NOT `codeSentences.ts`. This is the word a cell carries, where
 * the room is one or two words and the reader is scanning a column; that is
 * the explanation the same word expands to when a reader stops on it. They
 * speak for the same roster on purpose, and a label that has to be a sentence
 * to be understood belongs there instead.
 */

import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";

/** A ticket's number as the console writes it, so a row, a chip and a
 * dependency all name the same ticket the same way. */
export function adoptedTicketWord(ticket: number): string {
  return `#${String(ticket)}`;
}

/**
 * Where the ticket is, in the reader's own tense. The machine names a state
 * for the thing it holds — a work execution, an evaluation instance — and a
 * reader scanning a column is asking what the ticket is doing, so the three
 * states named after their contents are drawn as what is happening in them.
 */
export function adoptedTicketStateLabel(state: AdoptedTicket["state"]): string {
  switch (state) {
    case "Work":
      return "Working";
    case "Evaluation":
      return "Evaluating";
    case "Finalization":
      return "Finalizing";
    case "Pending":
    case "Escalated":
    case "Done":
    case "Revoked":
      return state;
  }
}
