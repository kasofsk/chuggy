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
  SelectorAttention,
  SelectorMode,
  SessionState,
  SessionTurnState,
  ThreadStanding,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { ConversationStanding } from "./conversation.ts";
import type { ForgeAppStanding } from "./forgeInstallation.ts";
import { leadDispatchLanded } from "./leadTranscript.ts";
import type { AgenticRefusalStanding, LeadDispatch } from "./leadTranscript.ts";
import type { CycleStanding, SetVerdict, StageRow } from "./ticketLedger.ts";

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

/** Where the ticket is, drawn as what the operator can do about it. */
export function phaseTone(phase: TicketPhase): Tone {
  switch (phase) {
    case "Pending":
      return "queued";
    case "Working":
    case "Evaluating":
    case "Finalizing":
    case "PublishingHandoff":
      return "live";
    case "HandoffBlocked":
    case "Escalated":
      return "parked";
    case "Done":
      return "pass";
    case "Abandoned":
    case "Revoked":
      return "retired";
  }
}

/** How a fan-out set settled, or that it has not. */
export function verdictTone(verdict: SetVerdict): Tone {
  switch (verdict) {
    case "Passed":
      return "pass";
    case "Failed":
      return "fail";
    case "Running":
      return "live";
    case "Cancelled":
    case "Blocked":
      return "retired";
  }
}

/** Whether the ticket's current artifact is this cycle's, or a later one's. */
export function standingTone(standing: CycleStanding): Tone {
  switch (standing) {
    case "Current":
      return "live";
    case "Superseded":
      return "retired";
  }
}

/** One status word and its tone for a stage the program did not run. */
export interface StageArm {
  readonly word: string;
  readonly tone: Tone;
}

/**
 * The three arms a stage row has without a set: short-circuited, not yet
 * started, or off the page this screen holds.
 */
export function stageArm(row: StageRow): StageArm {
  switch (row.kind) {
    case "Ran":
      return { word: row.set.verdict, tone: verdictTone(row.set.verdict) };
    case "Skipped":
      return { word: "Skipped", tone: "retired" };
    case "Queued":
      return { word: "Queued", tone: "queued" };
    case "Missing":
      return { word: "Missing", tone: "parked" };
  }
}

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
 * Where one member thread stands. `Orphaned` is drawn in the parked hue rather
 * than the retired one: a session that still takes turns as a member who is no
 * longer one is something an administrator has to act on, and retired ink says
 * the opposite.
 */
export function threadStandingTone(standing: ThreadStanding): Tone {
  switch (standing) {
    case "Open":
      return "live";
    case "Closed":
      return "retired";
    case "Orphaned":
      return "parked";
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

/** Whether the selector is deciding for this project, or has been stopped. */
export function selectorModeTone(mode: SelectorMode): Tone {
  switch (mode) {
    case "Running":
      return "live";
    case "Paused":
      return "parked";
  }
}

/** How closely the lead says the project needs watching. */
export function selectorAttentionTone(attention: SelectorAttention): Tone {
  switch (attention) {
    case "Monitoring":
      return "live";
    case "Attention":
      return "parked";
    case "Stopped":
      return "fail";
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

/** One status word and its tone for one of a decision's dispatches. */
export interface LeadDispatchArm {
  readonly word: string;
  readonly tone: Tone;
}

/** A settled dispatch whose outcome this console cannot read. The delivery
 * record says it is over and does not say how it went, and a pill saying
 * nothing would read as one that had not settled at all. */
const leadDispatchUnread = "Unknown";

/**
 * Where one dispatch of a decision got to, in the one word the log says it in.
 * `AwaitingApproval` takes the hue a ticket needing a human takes on the
 * project table, because that is what it is; a settled dispatch that did not
 * land is drawn as the code the record settled it on, which is already one word
 * and is the thing a reader came for.
 */
export function leadDispatchArm(dispatch: LeadDispatch): LeadDispatchArm {
  switch (dispatch.state) {
    case "AwaitingApproval":
      return { word: "Approval", tone: "parked" };
    case "Pending":
      return { word: "Queued", tone: "pass" };
    case "Submitted":
      return { word: "Sent", tone: "pass" };
    case "Terminal":
      if (leadDispatchLanded(dispatch))
        return { word: "Dispatched", tone: "pass" };
      return dispatch.outcome === undefined
        ? { word: leadDispatchUnread, tone: "neutral" }
        : { word: dispatch.outcome, tone: "fail" };
  }
}

/** Whether a refusal still binds, or a later authoring has overtaken it. */
export function agenticRefusalStandingTone(
  standing: AgenticRefusalStanding,
): Tone {
  switch (standing) {
    case "Standing":
      return "parked";
    case "Superseded":
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
