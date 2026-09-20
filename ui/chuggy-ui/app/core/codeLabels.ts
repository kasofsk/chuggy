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
import { adoptedExecutionSettled } from "./adoptedExecutions.ts";
import type {
  AdoptedExecution,
  AdoptedExecutionState,
} from "./adoptedExecutions.ts";
import type { BriefFinalizationMode } from "../../../../src/contract/rosters.ts";

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

/**
 * Where one execution stands, as the column word for it. `Terminal` is the
 * machine's word for a run that reported and is drawn as `Ended`, because what
 * a reader wants from the column is whether it is still going — and whether it
 * passed is a verdict this read does not carry and this word must not imply.
 */
export function adoptedExecutionStateLabel(
  state: AdoptedExecutionState,
): string {
  switch (state) {
    case "Queued":
      return "Queued";
    case "Running":
      return "Running";
    case "Terminal":
      return "Ended";
    case "Cancelled":
      return "Cancelled";
  }
}

/**
 * How many runs a page holds, how many are still going and how many carry no
 * figures — each clause dropped where it counts nothing, so a settled and fully
 * measured ticket reads as a bare number.
 */
export function adoptedExecutionRunsLabel(
  executions: readonly AdoptedExecution[],
): string {
  const running = executions.filter(
    (row) => !adoptedExecutionSettled(row),
  ).length;
  const unmeasured = executions.filter(
    (row) => row.totals === undefined,
  ).length;
  return [
    String(executions.length),
    ...(running === 0 ? [] : [`${String(running)} running`]),
    ...(unmeasured === 0 ? [] : [`${String(unmeasured)} unmeasured`]),
  ].join(" · ");
/** How a finished ticket in a repository lands, as the choice is named. */
export function landingLabel(mode: BriefFinalizationMode): string {
  switch (mode) {
    case "Push":
      return "Push";
    case "PullRequest":
      return "Pull request";
    case "PullRequestMerge":
      return "Pull request, then merge";
  }
}

/** What choosing that landing does, which is what the choice is made on. */
export function landingEffect(mode: BriefFinalizationMode): string {
  switch (mode) {
    case "Push":
      return "Commits straight onto the target branch";
    case "PullRequest":
      return "Opens a pull request into the target branch";
    case "PullRequestMerge":
      return "Opens a pull request into the target branch, then merges it";
  }
}
