/**
 * Recent ticket reads expressed as state transitions.
 *
 * Loading and failed reads retain the last page so navigation does not turn a
 * populated home page into an empty one.
 */

import { readResult } from "./outcomes.js";
import { pageLimitDefault, recentTicketsRequest } from "./protocol.js";
import { parseProject } from "./resources.js";

/** @typedef {ReturnType<typeof parseProject>} Project */

/**
 * @typedef {{ project: Project, nextCursor: string | undefined }} TicketHomeData
 */

/**
 * @typedef {{ state: "Loading", held: TicketHomeData | undefined,
 *     load: "Initial" | "Refresh" | "Next" }
 *   | { state: "Error", held: TicketHomeData | undefined,
 *       error: { kind: "Deferred", code: string, retryAfterSeconds: number }
 *         | { kind: "Unavailable", reason: string } }
 *   | ({ state: "Data" } & TicketHomeData)} TicketHomeState
 */

/**
 * @typedef {{ state: Extract<TicketHomeState, { state: "Loading" }>,
 *   request: import("./protocol.js").ApiRequest }} TicketHomeRead
 */

/** @param {TicketHomeState} state */
export function ticketHomeData(state) {
  return state.state === "Data"
    ? { project: state.project, nextCursor: state.nextCursor }
    : state.held;
}

/**
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {TicketHomeRead}
 */
export function ticketHomeInitial(
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  return {
    state: { state: "Loading", held: undefined, load: "Initial" },
    request: recentTicketsRequest(accessToken, partition, { limit }),
  };
}

/**
 * @param {TicketHomeState} state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {TicketHomeRead}
 */
export function ticketHomeRefresh(
  state,
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  return {
    state: { state: "Loading", held: ticketHomeData(state), load: "Refresh" },
    request: recentTicketsRequest(accessToken, partition, { limit }),
  };
}

/**
 * @param {TicketHomeState} state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {TicketHomeRead | undefined}
 */
export function ticketHomeNext(
  state,
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  if (state.state !== "Data" || state.nextCursor === undefined)
    return undefined;
  return {
    state: { state: "Loading", held: ticketHomeData(state), load: "Next" },
    request: recentTicketsRequest(accessToken, partition, {
      cursor: state.nextCursor,
      limit,
    }),
  };
}

/**
 * @param {Extract<TicketHomeState, { state: "Loading" }>} state
 * @param {import("./protocol.js").ApiOutcome} outcome
 * @returns {TicketHomeState}
 */
export function ticketHomeReceived(state, outcome) {
  const result = readResult(outcome, parseProject);
  if (result.result === "Deferred")
    return {
      state: "Error",
      held: state.held,
      error: {
        kind: "Deferred",
        code: result.code,
        retryAfterSeconds: result.retryAfterSeconds,
      },
    };
  if (result.result === "Unavailable")
    return {
      state: "Error",
      held: state.held,
      error: { kind: "Unavailable", reason: result.reason },
    };
  const tickets =
    state.load === "Next" && state.held !== undefined
      ? [...state.held.project.tickets, ...result.value.tickets]
      : result.value.tickets;
  return {
    state: "Data",
    project: { ...result.value, tickets },
    nextCursor: result.value.nextCursor,
  };
}
