/**
 * The tones the console draws the machine's states in, and the exhaustive maps
 * from the wire's own words onto them.
 *
 * Total over `pillTones`, and over each roster the maps below speak for. A tone
 * is chosen here rather than at a call site so that a roster the wire grows
 * stops compiling in one module instead of reaching a reader as `neutral`, and
 * so that one meaning is never drawn in two hues on two pages. Hue carries the
 * machine's own states and nothing else, which is why there is no tone for a
 * link, a button or a focus ring.
 */

import type {
  SessionState,
  SessionTurnState,
} from "../../../../src/contract/rosters.ts";
import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";
import type { AdoptedExecutionState } from "./adoptedExecutions.ts";
import type { ConversationStanding } from "./conversation.ts";
import type { ForgeAppStanding } from "./forgeInstallation.ts";

export const pillTones = [
  "pass",
  "fail",
  "live",
  "queued",
  "parked",
  "retired",
  "neutral",
] as const;

export type Tone = (typeof pillTones)[number];

/** Whether the lead's session still takes turns. */
export function sessionStateTone(state: SessionState): Tone {
  switch (state) {
    case "Open":
      return "live";
    case "Closed":
      return "retired";
  }
}

/**
 * Where one ticket stands, in the hue the table and a reference chip both draw
 * it in. The three states the machine is carrying a ticket through share one
 * hue because the reader's question is whether it is moving, not which leg of
 * the run it is on; the word beside the mark is what separates them.
 */
export function adoptedTicketStateTone(state: AdoptedTicket["state"]): Tone {
  switch (state) {
    case "Pending":
      return "queued";
    case "Work":
    case "Evaluation":
    case "Finalization":
      return "live";
    case "Escalated":
      return "parked";
    case "Done":
      return "pass";
    case "Revoked":
      return "retired";
  }
}

/** Whether one of this deployment's apps is installed on an account, or is not. */
export function forgeAppStandingTone(standing: ForgeAppStanding): Tone {
  switch (standing) {
    case "Installed":
      return "pass";
    case "Missing":
      return "parked";
  }
}

/** Where one turn of the lead's mailbox stands. */
export function sessionTurnStateTone(state: SessionTurnState): Tone {
  switch (state) {
    case "Queued":
      return "queued";
    case "Claimed":
      return "live";
    case "Answered":
      return "pass";
    case "Failed":
      return "fail";
    case "Abandoned":
      return "retired";
  }
}

/** One status word and its tone for where an exchange stands. */
export interface ConversationStandingArm {
  readonly word: string;
  readonly tone: Tone;
}

/**
 * Where one exchange stands, in the one word and hue it is drawn in: `Open` is
 * the arm the mailbox has no word for — a transcript exchange no turn speaks
 * for — and takes the live hue because what it describes is a conversation
 * still being written. `Markers` has no arm: the surface draws that exchange
 * as its markers alone and never reaches a pill for it.
 */
export function conversationStandingArm(
  standing: Exclude<ConversationStanding, { readonly standing: "Markers" }>,
): ConversationStandingArm {
  switch (standing.standing) {
    case "Answered":
      return { word: "Answered", tone: sessionTurnStateTone("Answered") };
    case "Running":
      return {
        word: standing.state,
        tone: sessionTurnStateTone(standing.state),
      };
    case "Failed":
      return { word: "Failed", tone: sessionTurnStateTone("Failed") };
    case "Abandoned":
      return { word: "Abandoned", tone: sessionTurnStateTone("Abandoned") };
    case "Open":
      return { word: "Open", tone: "live" };
  }
}

/**
 * Where one execution stands. `Terminal` takes no verdict hue: the run ended
 * and whether it passed is not on this read, so drawing it in the passing hue
 * would answer a question nothing asked.
 */
export function adoptedExecutionStateTone(state: AdoptedExecutionState): Tone {
  switch (state) {
    case "Queued":
      return "queued";
    case "Running":
      return "live";
    case "Terminal":
      return "neutral";
    case "Cancelled":
      return "retired";
  }
}
