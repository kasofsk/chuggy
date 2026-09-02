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
  SessionState,
  SessionTurnState,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { AgenticRefusalStanding } from "./leadTranscript.ts";
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
