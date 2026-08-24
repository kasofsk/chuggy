/**
 * Ticket creation as a pure state machine. The server supplies every default
 * and choice; this module only preserves the selected values and creation
 * fence while producing requests for the shell to perform.
 */

import { readResult, unavailableReason } from "./outcomes.js";
import {
  draftCreationRequest,
  draftInitializationRequest,
} from "./protocol.js";
import { parseDraft, parseDraftInitialization } from "./resources.js";

/** @typedef {ReturnType<typeof parseDraftInitialization>} Initialization */
/** @typedef {Initialization["defaults"]} Authoring */

/** @param {readonly unknown[]} values @param {unknown} value */
function includesValue(values, value) {
  return values.some(
    (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
  );
}

/** @param {Initialization} initialization @param {Authoring} authoring */
function authoringAllowed(initialization, authoring) {
  const choices = initialization.choices;
  return (
    authoring.dependencies.every((ticket) =>
      initialization.dependencyCandidates.includes(ticket),
    ) &&
    authoring.program.length > 0 &&
    authoring.program.length <= choices.programStagesMax &&
    authoring.program.every((stage) => includesValue(choices.stages, stage)) &&
    choices.workFanouts.includes(authoring.workFanout) &&
    includesValue(choices.reworkPolicies, authoring.reworkPolicy) &&
    includesValue(
      choices.finalizationPricings,
      authoring.finalizationPricing,
    ) &&
    choices.resumePricings.includes(authoring.resumePricing) &&
    choices.finalizers.includes(authoring.finalizer)
  );
}

/** @param {Initialization} initialization @param {Authoring} authoring */
function edited(initialization, authoring) {
  return authoringAllowed(initialization, authoring)
    ? { step: /** @type {const} */ ("Editing"), initialization, authoring }
    : {
        step: /** @type {const} */ ("Editing"),
        initialization,
        authoring: initialization.defaults,
        issue: "The selected value is no longer offered by the server.",
      };
}

/** @param {import("./protocol.js").ApiOutcome} outcome */
function creationFailure(outcome) {
  if (
    outcome.outcome === "Conflict" &&
    outcome.code === "DraftInitializationStale"
  )
    return "The initialization is stale. Reload it before creating the ticket.";
  if (outcome.outcome === "Retryable")
    return `${outcome.code}; retry after ${String(outcome.retryAfterSeconds)}s.`;
  if (outcome.outcome === "Ok" || outcome.outcome === "Accepted")
    return "The server sent a draft this console cannot read.";
  return unavailableReason(outcome);
}

/**
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {string} revision
 */
export function ticketCreationSelected(accessToken, partition, revision) {
  return {
    state: { step: /** @type {const} */ ("Initializing"), revision },
    request: draftInitializationRequest(accessToken, partition, revision),
  };
}

/** @param {string} revision @param {import("./protocol.js").ApiOutcome} outcome */
export function ticketCreationInitialized(revision, outcome) {
  const result = readResult(outcome, parseDraftInitialization);
  if (result.result === "Value")
    return edited(result.value, result.value.defaults);
  const reason =
    result.result === "Deferred"
      ? `${result.code}; retry after ${String(result.retryAfterSeconds)}s.`
      : result.reason;
  return {
    step: /** @type {const} */ ("InitializationFailed"),
    revision,
    reason,
  };
}

/** @param {Initialization} initialization @param {Authoring} authoring */
export function ticketCreationEdited(initialization, authoring) {
  return edited(initialization, authoring);
}

/**
 * @param {Extract<TicketCreationState, { step: "Editing" }> } state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 */
export function ticketCreationSubmitted(state, accessToken, partition) {
  if (!authoringAllowed(state.initialization, state.authoring))
    return {
      state: { ...state, issue: "Choose only values offered by the server." },
    };
  const initialization = state.initialization;
  return {
    state: {
      step: /** @type {const} */ ("Creating"),
      initialization,
      authoring: state.authoring,
    },
    request: draftCreationRequest(accessToken, partition, {
      configurationRevision: initialization.configuration.revision,
      configurationDigest: initialization.fence.configurationDigest,
      expectedProjectSequence: initialization.fence.projectSequence,
      authoring: state.authoring,
    }),
  };
}

/** @param {Initialization} initialization @param {Authoring} authoring @param {import("./protocol.js").ApiOutcome} outcome */
export function ticketCreationCreated(initialization, authoring, outcome) {
  if (outcome.outcome === "Ok" || outcome.outcome === "Accepted") {
    try {
      return {
        step: /** @type {const} */ ("DraftCreated"),
        draft: parseDraft(outcome.body),
      };
    } catch {
      // The failure below is a visible terminal state, not an escaped parser error.
    }
  }
  return {
    step: /** @type {const} */ ("Editing"),
    initialization,
    authoring,
    issue: creationFailure(outcome),
  };
}

/** @param {Extract<TicketCreationState, { step: "DraftCreated" }>["draft"]} draft */
export function ticketCreationReleaseEvent(draft) {
  return {
    event: /** @type {const} */ ("ReleaseDraft"),
    ticket: draft.ticket,
    authoringVersion: draft.authoringVersion,
    configurationRevision: draft.configurationRevision,
  };
}

/**
 * @typedef {{ step: "Choosing" }
 * | { step: "Initializing", revision: string }
 * | { step: "InitializationFailed", revision: string, reason: string }
 * | { step: "Editing", initialization: Initialization, authoring: Authoring, issue?: string }
 * | { step: "Creating", initialization: Initialization, authoring: Authoring }
 * | { step: "DraftCreated", draft: ReturnType<typeof parseDraft> }
 * | { step: "Releasing", draft: ReturnType<typeof parseDraft> }
 * | { step: "ReleaseFailed", draft: ReturnType<typeof parseDraft>, reason: string }
 * } TicketCreationState
 */
