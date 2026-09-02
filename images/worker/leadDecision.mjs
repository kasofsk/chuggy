/**
 * The decision tools, which write nothing. They stage into a buffer the turn
 * owns, and the buffer becomes the turn's answer — the same document the
 * selector runtime's own parser already reads, so the runtime remains the single
 * writer of a dispatch and of the refusal ledger, still under its own fence.
 *
 * COMPOSING THE DOCUMENT IS WHY THEY EXIST. The pod cuts a long answer before it
 * posts it, and a truncated JSON document is exactly what a lenient parser would
 * half-accept; a document composed from typed calls is well-formed by
 * construction, and a staging that would outgrow the mailbox row is refused
 * where the lead can still see the refusal rather than at settling time.
 *
 * THE DOCUMENT'S BOUND IS THE ONLY SIZE BOUND, and it is the tighter one by
 * construction: `selectorHandoffNoteBytesMax` weighs one field and
 * `leadDecisionBytesMax` weighs that field inside the whole document, so a note
 * its own column would refuse has already been refused here. A second check
 * against the wider bound could never fire, and a control that cannot fire is
 * worse than none. `leadDecision.test.mjs` asserts the ordering that makes this
 * true, so a future bound that inverted it would be caught rather than assumed.
 *
 * A BOUND REFUSED IS AN ERROR THE MODEL SEES. A lead that believes it refused
 * two tickets and refused one is a lead whose record is wrong, so nothing here
 * drops a call silently: past a bound, outside the observed view, or naming one
 * ticket twice, the call raises and the model reads the reason.
 *
 * THE BUFFER IS KEYED ON THE TURN. `reset` is called as a turn is claimed, so
 * one turn's staging cannot leak into the next; a suite drives two turns and
 * asserts the second carries nothing of the first.
 *
 * WHAT IS NOT SET IS NOT INVENTED. A turn that stages a choice and says nothing
 * about the handoff note keeps the note it was shown, because the note is a
 * successor's only context and a decision that silently cleared it would be a
 * lead erasing its own memory.
 *
 * ATTENTION IS THE SAME, AND HARDER, BECAUSE THE OBSERVATION DOES NOT CARRY IT.
 * The runtime writes a decision's attention onto the project, so a turn that
 * refuses one ticket and says nothing would move a project from `Attention` to
 * `Monitoring` — a lead quietly clearing the flag a human is watching. So the
 * standing value outlives the turn: it is seeded from the most recent seeded
 * decision where the observation carries one, moved only by `set_attention`,
 * and carried across every turn this pod takes. `Monitoring` is used only where
 * this pod has never been told an attention at all, which is a resumed session
 * whose observation carried no seeding — the residual, and the reason to put
 * the standing attention in the observation document itself.
 */

import { Buffer } from "node:buffer";

/** The bounds this module writes a second time; `test/contract/imageTools.test.mjs` holds them to the contract's. */
export const leadDispatchesMax = 1;
export const leadRefusalsPerDecisionMax = 16;
export const agenticRefusalReasonCharsMax = 1_024;
export const selectorHandoffNoteBytesMax = 65_536;
export const leadDecisionBytesMax = 65_536;

/** The one document version this tree writes and the only one the runtime accepts. */
export const leadTurnDocumentVersion = 1;

/** The attentions a decision may name, which the runtime writes onto the project. */
export const leadAttentions = ["Monitoring", "Attention", "Stopped"];

/** The decision tools, in the order a roster is read in. */
export const leadDecisionToolNames = [
  "dispatch",
  "refuse",
  "lift",
  "set_attention",
  "set_handoff_note",
  "set_planning_intent",
];

function seededState(observation) {
  return {
    dispatches: [],
    refusals: [],
    lifts: [],
    attention: undefined,
    handoffNote: observation.handoffNote,
    planningIntent: undefined,
    candidates: observation.candidates,
    standing: observation.standing,
    touched: false,
  };
}

/**
 * What one turn's input offers a decision: the candidates it may name, the
 * refusals it may lift, and the note it keeps by saying nothing. A turn whose
 * input is not an observation offers none of it, and dispatch and refusal are
 * then refused for naming a ticket outside the view — which is the honest answer
 * to a decision tool called on a user's message.
 */
export function leadObservationOffered(input) {
  const empty = {
    candidates: [],
    standing: [],
    handoffNote: null,
    seededAttention: undefined,
  };
  if (typeof input !== "string") return empty;
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return empty;
  if (!Array.isArray(parsed.candidates)) return empty;
  return {
    candidates: parsed.candidates
      .filter((candidate) => Number.isSafeInteger(candidate?.ticket))
      .map(({ ticket, ticketVersion }) => ({ ticket, ticketVersion })),
    standing: (Array.isArray(parsed.refusals) ? parsed.refusals : [])
      .filter((refusal) => Number.isSafeInteger(refusal?.ticket))
      .map(({ ticket }) => ticket),
    handoffNote: "handoffNote" in parsed ? parsed.handoffNote : null,
    // The seeded tail goes oldest first, so the newest decision that named an
    // attention is the one the project settled on.
    seededAttention: (Array.isArray(parsed.seeding?.decisions)
      ? parsed.seeding.decisions
      : []
    )
      .map((decision) => decision?.attention)
      .filter((attention) => leadAttentions.includes(attention))
      .at(-1),
  };
}

function documentOf(state, standingAttention) {
  return {
    version: leadTurnDocumentVersion,
    dispatches: state.dispatches,
    refusals: state.refusals,
    lifts: state.lifts,
    attention: state.attention ?? standingAttention ?? "Monitoring",
    handoffNote: state.handoffNote,
    ...(state.planningIntent === undefined
      ? {}
      : { planningIntent: state.planningIntent }),
  };
}

/**
 * Applies one change and keeps it only where the document it makes still fits
 * the mailbox row. Reverting rather than posting a document the row refuses is
 * what makes the answer well-formed by construction.
 */
function stage(state, change, standingAttention) {
  const kept = {
    dispatches: state.dispatches,
    refusals: state.refusals,
    lifts: state.lifts,
    attention: state.attention,
    handoffNote: state.handoffNote,
    planningIntent: state.planningIntent,
  };
  Object.assign(state, change);
  const bytes = Buffer.byteLength(
    JSON.stringify(documentOf(state, standingAttention)),
  );
  if (bytes > leadDecisionBytesMax) {
    Object.assign(state, kept);
    throw new RangeError(
      `this decision would weigh ${String(bytes)} bytes and the turn's answer holds ${String(leadDecisionBytesMax)}`,
    );
  }
  state.touched = true;
}

function offeredCandidate(state, ticket, what) {
  const candidate = state.candidates.find((member) => member.ticket === ticket);
  if (candidate === undefined)
    throw new RangeError(
      `${what} names ticket ${String(ticket)}, which this turn's observation did not offer`,
    );
  return candidate;
}

function notAlreadyEntered(state, ticket) {
  const entered = [
    ...state.refusals.map((refusal) => refusal.ticket),
    ...state.lifts.map((lift) => lift.ticket),
  ];
  if (entered.includes(ticket))
    throw new RangeError(
      `ticket ${String(ticket)} is already in this decision's refusal ledger, which holds one row per ticket`,
    );
}

/**
 * The six decision tools, each written over the staging buffer its turn owns. It
 * is a value rather than a closure because it is a roster, and one read twice
 * must read the same both times.
 */
const decisionTools = [
  {
    name: "dispatch",
    description:
      "Stages the one ticket this decision dispatches, fenced on the version the observation showed. Writes nothing: the selector runtime delivers it.",
    shape: (z) => ({
      ticket: z.number().int().min(1),
      expectedTicketVersion: z.number().int().min(0),
    }),
    call: (state, { ticket, expectedTicketVersion }, standingAttention) => {
      const candidate = offeredCandidate(state, ticket, "dispatch");
      if (candidate.ticketVersion !== expectedTicketVersion)
        throw new RangeError(
          `dispatch fences ticket ${String(ticket)} on version ${String(expectedTicketVersion)} and the observation showed ${String(candidate.ticketVersion)}`,
        );
      if (state.dispatches.length >= leadDispatchesMax)
        throw new RangeError(
          `one decision dispatches at most ${String(leadDispatchesMax)} ticket(s)`,
        );
      if (state.refusals.some((refusal) => refusal.ticket === ticket))
        throw new RangeError(
          `ticket ${String(ticket)} is already refused by this decision`,
        );
      stage(
        state,
        {
          dispatches: [...state.dispatches, { ticket, expectedTicketVersion }],
        },
        standingAttention,
      );
      return `dispatch staged for ticket ${String(ticket)}`;
    },
  },
  {
    name: "refuse",
    description:
      "Stages a stated reason for not dispatching one observed ticket, against the version observed. The reason enters the project's refusal ledger.",
    shape: (z) => ({
      ticket: z.number().int().min(1),
      ticketVersion: z.number().int().min(0),
      reason: z.string().min(1).max(agenticRefusalReasonCharsMax),
    }),
    call: (state, { ticket, ticketVersion, reason }, standingAttention) => {
      const candidate = offeredCandidate(state, ticket, "refuse");
      if (candidate.ticketVersion !== ticketVersion)
        throw new RangeError(
          `refusal names ticket ${String(ticket)} at version ${String(ticketVersion)} and the observation showed ${String(candidate.ticketVersion)}`,
        );
      notAlreadyEntered(state, ticket);
      if (state.dispatches.some((dispatch) => dispatch.ticket === ticket))
        throw new RangeError(
          `ticket ${String(ticket)} is already dispatched by this decision`,
        );
      if (state.refusals.length >= leadRefusalsPerDecisionMax)
        throw new RangeError(
          `one decision refuses at most ${String(leadRefusalsPerDecisionMax)} tickets`,
        );
      stage(
        state,
        {
          refusals: [...state.refusals, { ticket, ticketVersion, reason }],
        },
        standingAttention,
      );
      return `refusal staged for ticket ${String(ticket)}`;
    },
  },
  {
    name: "lift",
    description:
      "Stages the clearing of a standing refusal on one ticket, which returns it to the candidates a later decision sees.",
    shape: (z) => ({ ticket: z.number().int().min(1) }),
    call: (state, { ticket }, standingAttention) => {
      if (!state.standing.includes(ticket))
        throw new RangeError(
          `ticket ${String(ticket)} carries no standing refusal in this turn's observation`,
        );
      notAlreadyEntered(state, ticket);
      if (state.lifts.length >= leadRefusalsPerDecisionMax)
        throw new RangeError(
          `one decision lifts at most ${String(leadRefusalsPerDecisionMax)} refusals`,
        );
      stage(state, { lifts: [...state.lifts, { ticket }] }, standingAttention);
      return `lift staged for ticket ${String(ticket)}`;
    },
  },
  {
    name: "set_attention",
    description:
      "Sets what this project's state says to a human: monitoring, wanting attention, or stopped. Last call wins.",
    shape: (z) => ({ attention: z.enum(leadAttentions) }),
    call: (state, { attention }, standingAttention) => {
      stage(state, { attention }, standingAttention);
      return `attention set to ${attention}`;
    },
  },
  {
    name: "set_handoff_note",
    description:
      "Sets the note a successor lead with no transcript reads. Last call wins; omitting it keeps the note this turn was shown.",
    shape: (z) => ({ note: z.looseObject({}) }),
    call: (state, { note }, standingAttention) => {
      stage(state, { handoffNote: note }, standingAttention);
      return "handoff note set";
    },
  },
  {
    name: "set_planning_intent",
    description:
      "Sets this project's standing planning intent, which outlives one decision. Last call wins.",
    shape: (z) => ({ intent: z.looseObject({}) }),
    call: (state, { intent }, standingAttention) => {
      stage(state, { planningIntent: intent }, standingAttention);
      return "planning intent set";
    },
  },
];

/**
 * One turn's staging buffer and the tools bound to it. Nothing here reaches the
 * network: `document()` is the whole of what the decision tools produce.
 */
export function leadDecisionStaging() {
  const held = {
    state: seededState(leadObservationOffered(undefined)),
    /** The attention this pod last knew the project to be in, across every turn. */
    attention: undefined,
  };
  return {
    definitions: decisionTools.map((definition) => ({
      ...definition,
      call: (args) => {
        const answer = definition.call(held.state, args, held.attention);
        if (held.state.attention !== undefined)
          held.attention = held.state.attention;
        return answer;
      },
    })),

    /**
     * Called as a turn is claimed, seeding what that turn's input offers. The
     * standing attention is not reset with the rest: it is the project's, not
     * the turn's, and a turn that names none must not clear it.
     */
    reset(input) {
      const observation = leadObservationOffered(input);
      held.state = seededState(observation);
      held.attention ??= observation.seededAttention;
    },

    /** Whether this turn called a decision tool at all. */
    staged() {
      return held.state.touched;
    },

    /** The document this turn's calls compose, or nothing where it called none. */
    document() {
      return held.state.touched
        ? documentOf(held.state, held.attention)
        : undefined;
    },
  };
}
