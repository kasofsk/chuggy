/**
 * What the lead page draws of the lead itself, derived: the note it left its
 * successor, and the one line a decision or a refusal is read as. The
 * transcript it shares with every session is `sessionTranscript.ts`'s.
 */

import type {
  OperationState,
  SelectorAttention,
  SessionState,
  SessionTurnFailure,
  SessionTurnInputKind,
  SessionTurnState,
} from "../../../../src/contract/rosters.ts";
import type {
  AgenticRefusalResponse,
  LeadResponse,
  SelectorDecisionResponse,
} from "../../../../src/contract/responses.ts";
import type { Copy, CopyText } from "./copy.ts";

/** As much of the note the lead left its successor as the lead read carries. */
export type LeadHandoffNote = LeadResponse["handoffNote"];

/**
 * The page a decision panel draws, highest ordinal first. The order is derived
 * from the ordinals rather than taken from the page's own arrangement, so a
 * route answering the log's other end cannot put a months-old decision at the
 * top of the panel and have it drawn as the one that just ran.
 */
export function leadDecisionsNewestFirst(
  decisions: readonly SelectorDecisionResponse[],
): readonly SelectorDecisionResponse[] {
  return [...decisions].sort((left, right) => right.ordinal - left.ordinal);
}

/** One of a decision's dispatches, as the log's own answer carries it. */
export type LeadDispatch = SelectorDecisionResponse["dispatches"][number];

/**
 * The one word a settled dispatch's outcome can carry that says the writer took
 * it. It is the operation state a journaled command reaches, named from the
 * wire's own roster so a rename of it stops compiling here.
 */
const leadDispatchAccepted: OperationState = "Succeeded";

/**
 * Whether the record says this dispatch reached the journal. A delivery still
 * moving has not, and neither has one that settled on anything else — a refusal
 * code, a cancellation, a command the door would not read — so the acceptance
 * is the closed set and everything else is a dispatch that did not land.
 */
export function leadDispatchLanded(dispatch: LeadDispatch): boolean {
  return (
    dispatch.state === "Terminal" && dispatch.outcome === leadDispatchAccepted
  );
}

/** Whether the lead's session still takes turns, as the top bar draws it. */
export function leadSessionStateLabel(state: SessionState): Copy {
  switch (state) {
    case "Open":
      return { id: "lead-session-open" };
    case "Closed":
      return { id: "lead-session-closed" };
  }
}

/** How closely the lead says a project needs watching, as the decision log and
 * the top bar both draw it. */
export function selectorAttentionLabel(attention: SelectorAttention): Copy {
  switch (attention) {
    case "Monitoring":
      return { id: "lead-attention-monitoring" };
    case "Attention":
      return { id: "lead-attention-attention" };
    case "Stopped":
      return { id: "lead-attention-stopped" };
  }
}

/**
 * What one decision did, as the one line the log is scanned down. The
 * dispatches are counted twice over — what landed, of what was named — because
 * a decision that named three and landed one did not dispatch three, and the
 * retained result cannot tell the two apart.
 */
export function leadDecisionSummary(
  decision: SelectorDecisionResponse,
  text: CopyText,
): string {
  const named = decision.dispatches.length;
  const landed = decision.dispatches.filter(leadDispatchLanded).length;
  const counts: readonly { readonly count: number; readonly word: Copy }[] = [
    {
      count: decision.refused.length,
      word: { id: "lead-decision-refused-count" },
    },
    {
      count: decision.lifted.length,
      word: { id: "lead-decision-lifted-count" },
    },
  ];
  const countsSaid = counts.flatMap((part) =>
    part.count === 0 ? [] : [`${String(part.count)} ${text(part.word)}`],
  );
  const said = [
    ...(decision.attention === undefined
      ? []
      : [text(selectorAttentionLabel(decision.attention))]),
    ...(named === 0
      ? []
      : [
          text({
            id: "lead-decision-summary-dispatched",
            args: { landed, named },
          }),
        ]),
    ...countsSaid,
  ];
  return said.length === 0
    ? text({ id: "lead-decision-none" })
    : said.join(" · ");
}

/** Whether a refusal still binds, or the ticket has moved past it. */
export const agenticRefusalStandings = ["Standing", "Superseded"] as const;

export type AgenticRefusalStanding = (typeof agenticRefusalStandings)[number];

/** The word a refusal's standing is drawn as. */
export function agenticRefusalStandingLabel(
  standing: AgenticRefusalStanding,
): Copy {
  switch (standing) {
    case "Standing":
      return { id: "lead-refusal-standing" };
    case "Superseded":
      return { id: "lead-refusal-superseded" };
  }
}

/** The word a turn's input kind is drawn as. */
export function leadTurnInputKindLabel(kind: SessionTurnInputKind): Copy {
  switch (kind) {
    case "Observation":
      return { id: "lead-turn-input-observation" };
    case "UserMessage":
      return { id: "lead-turn-input-message" };
    case "Wake":
      return { id: "lead-turn-input-wake" };
    case "Inquiry":
      return { id: "lead-turn-input-question" };
    case "OfferReply":
      return { id: "lead-turn-input-offer-reply" };
  }
}

/** The word one turn's state is drawn as. */
export function leadTurnStateLabel(state: SessionTurnState): Copy {
  switch (state) {
    case "Queued":
      return { id: "lead-turn-state-queued" };
    case "Claimed":
      return { id: "lead-turn-state-claimed" };
    case "Answered":
      return { id: "lead-turn-state-answered" };
    case "Failed":
      return { id: "lead-turn-state-failed" };
    case "Abandoned":
      return { id: "lead-turn-state-abandoned" };
  }
}

/** The word a turn's failure is drawn as. */
export function leadTurnFailureLabel(failure: SessionTurnFailure): Copy {
  switch (failure) {
    case "AgentFailed":
      return { id: "lead-turn-failure-agent-failed" };
    case "AgentRateLimited":
      return { id: "lead-turn-failure-rate-limited" };
    case "AgentTurnsExhausted":
      return { id: "lead-turn-failure-turns-exhausted" };
    case "AgentBudgetExhausted":
      return { id: "lead-turn-failure-budget-exhausted" };
    case "StoreRefused":
      return { id: "lead-turn-failure-store-refused" };
    case "AttemptLost":
      return { id: "lead-turn-failure-attempt-lost" };
    case "SessionClosed":
      return { id: "lead-turn-failure-session-closed" };
    case "TurnWithdrawn":
      return { id: "lead-turn-failure-withdrawn" };
    case "TurnStopped":
      return { id: "lead-turn-failure-stopped" };
    case "TurnStoppedQueued":
      return { id: "lead-turn-failure-stopped-queued" };
  }
}

export function agenticRefusalStanding(
  refusal: AgenticRefusalResponse,
): AgenticRefusalStanding {
  return refusal.superseded ? "Superseded" : "Standing";
}
