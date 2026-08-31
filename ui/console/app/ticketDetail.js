/**
 * Ticket detail reads as explicit state transitions. The DOM performs the
 * returned requests and feeds their classified outcomes back here.
 */

import { readResult } from "./outcomes.js";
import { readStateFailure } from "./readState.js";
import {
  configurationRequest,
  draftRequest,
  executionsRequest,
  pageLimitDefault,
  ticketRequest,
} from "./protocol.js";
import {
  parseConfiguration,
  parseDraft,
  parseExecutionsPage,
  parseTicket,
} from "./resources.js";

/** @template T @typedef {{ state: "Loading", held: T | undefined }
 *   | { state: "Error", held: T | undefined, error: { kind: "Deferred", code: string, retryAfterSeconds: number } | { kind: "Unavailable", reason: string } }
 *   | { state: "Data", value: T }} DetailResource */

/** @typedef {ReturnType<typeof parseTicket>} TicketResource */
/** @typedef {ReturnType<typeof parseDraft>} DraftResource */
/** @typedef {ReturnType<typeof parseConfiguration>} ConfigurationResource */
/** @typedef {ReturnType<typeof parseExecutionsPage>} ExecutionsResource */
/** @typedef {{ state: "Waiting" } | { state: "Absent" } | DetailResource<ConfigurationResource>} ConfigurationState */
/** @typedef {{ ticket: number, identity: DetailResource<TicketResource>, draft: DetailResource<DraftResource | undefined>, configuration: ConfigurationState, executions: DetailResource<ExecutionsResource> }} TicketDetailState */

/** @template T @param {DetailResource<T>} state */
export function ticketDetailHeld(state) {
  return state.state === "Data" ? state.value : state.held;
}

/** @template T @param {DetailResource<T>} state */
function loading(state) {
  return {
    state: /** @type {const} */ ("Loading"),
    held: ticketDetailHeld(state),
  };
}

/** @template T @param {Extract<DetailResource<T>, { state: "Loading" }>} state @param {import("./protocol.js").ApiOutcome} outcome @param {(body: unknown) => T} parse */
function received(state, outcome, parse) {
  const result = readResult(outcome, parse);
  if (result.result === "Value")
    return { state: /** @type {const} */ ("Data"), value: result.value };
  return readStateFailure(state, result);
}

/** @param {import("./protocol.js").ApiOutcome} outcome */
function draftReceived(outcome) {
  if (outcome.outcome === "Absent")
    return { state: /** @type {const} */ ("Data"), value: undefined };
  return received({ state: "Loading", held: undefined }, outcome, parseDraft);
}

/** @param {string} accessToken @param {import("./protocol.js").Partition} partition @param {number} ticket @param {number} [limit] @returns {{ state: TicketDetailState, requests: { identity: import("./protocol.js").ApiRequest, draft: import("./protocol.js").ApiRequest, executions: import("./protocol.js").ApiRequest } }} */
export function ticketDetailInitial(
  accessToken,
  partition,
  ticket,
  limit = pageLimitDefault,
) {
  return {
    state: {
      ticket,
      identity: { state: /** @type {const} */ ("Loading"), held: undefined },
      draft: { state: /** @type {const} */ ("Loading"), held: undefined },
      configuration: { state: /** @type {const} */ ("Waiting") },
      executions: { state: /** @type {const} */ ("Loading"), held: undefined },
    },
    requests: {
      identity: ticketRequest(accessToken, partition, ticket),
      draft: draftRequest(accessToken, partition, ticket),
      executions: executionsRequest(accessToken, partition, {
        limit,
        ticket,
      }),
    },
  };
}

/** @param {TicketDetailState} state @param {import("./protocol.js").ApiOutcome} outcome @returns {TicketDetailState} */
export function ticketDetailIdentityReceived(state, outcome) {
  if (state.identity.state !== "Loading") return state;
  return { ...state, identity: received(state.identity, outcome, parseTicket) };
}

/** @param {TicketDetailState} state @param {import("./protocol.js").ApiOutcome} outcome @param {string} accessToken @param {import("./protocol.js").Partition} partition */
export function ticketDetailDraftReceived(
  state,
  outcome,
  accessToken,
  partition,
) {
  const draft = draftReceived(outcome);
  const value = ticketDetailHeld(draft);
  if (value === undefined)
    return {
      state: {
        ...state,
        draft,
        configuration: { state: /** @type {const} */ ("Absent") },
      },
      request: undefined,
    };
  return {
    state: {
      ...state,
      draft,
      configuration: {
        state: /** @type {const} */ ("Loading"),
        held: undefined,
      },
    },
    request: configurationRequest(
      accessToken,
      partition,
      value.configurationRevision,
    ),
  };
}

/** @param {TicketDetailState} state @param {import("./protocol.js").ApiOutcome} outcome @returns {TicketDetailState} */
export function ticketDetailConfigurationReceived(state, outcome) {
  if (state.configuration.state !== "Loading") return state;
  return {
    ...state,
    configuration: received(state.configuration, outcome, parseConfiguration),
  };
}

/** @param {TicketDetailState} state @param {import("./protocol.js").ApiOutcome} outcome @returns {TicketDetailState} */
export function ticketDetailExecutionsReceived(state, outcome) {
  if (state.executions.state !== "Loading") return state;
  const page = received(state.executions, outcome, parseExecutionsPage);
  const prior = state.executions.held;
  if (page.state !== "Data" || prior === undefined)
    return { ...state, executions: page };
  return {
    ...state,
    executions: {
      state: /** @type {const} */ ("Data"),
      value: {
        executions: [...prior.executions, ...page.value.executions],
        nextCursor: page.value.nextCursor,
      },
    },
  };
}

/** @param {TicketDetailState} state @param {string} accessToken @param {import("./protocol.js").Partition} partition @param {number} [limit] */
export function ticketDetailExecutionsNext(
  state,
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  const page = ticketDetailHeld(state.executions);
  if (page === undefined || page.nextCursor === undefined) return undefined;
  return {
    state: { ...state, executions: loading(state.executions) },
    request: executionsRequest(accessToken, partition, {
      cursor: page.nextCursor,
      limit,
      ticket: state.ticket,
    }),
  };
}

/** @param {TicketDetailState} state */
export function ticketDetailActions(state) {
  const draft = ticketDetailHeld(state.draft);
  return draft?.state === "Draft"
    ? { edit: false, delete: false, release: true }
    : { edit: false, delete: false, release: false };
}
