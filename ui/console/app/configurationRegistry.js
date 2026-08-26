/**
 * Configuration registry reads expressed as state transitions.
 *
 * The caller performs each returned request and gives the classified outcome
 * back to this module. Loading and failed reads retain the last data so a
 * refresh or continuation never turns a populated registry into an empty one.
 */

import { readResult } from "./outcomes.js";
import { readStateFailure } from "./readState.js";
import { configurationsRequest, pageLimitDefault } from "./protocol.js";
import { parseConfigurationsPage } from "./resources.js";

/** @typedef {ReturnType<typeof parseConfigurationsPage>} ConfigurationPage */

/**
 * @typedef {{ configurations: ConfigurationPage["configurations"],
 *   nextCursor: string | undefined }} ConfigurationRegistryData
 */

/**
 * @typedef {{ state: "Loading", held: ConfigurationRegistryData | undefined,
 *     load: "Initial" | "Refresh" | "Next" }
 *   | { state: "Error", held: ConfigurationRegistryData | undefined,
 *       error: { kind: "Deferred", code: string, retryAfterSeconds: number }
 *         | { kind: "Unavailable", reason: string } }
 *   | ({ state: "Data" } & ConfigurationRegistryData)} ConfigurationRegistryState
 */

/**
 * @typedef {{ state: Extract<ConfigurationRegistryState, { state: "Loading" }>,
 *   request: import("./protocol.js").ApiRequest }} ConfigurationRegistryRead
 */

/** @param {ConfigurationRegistryState} state */
export function configurationRegistryData(state) {
  return state.state === "Data"
    ? { configurations: state.configurations, nextCursor: state.nextCursor }
    : state.held;
}

/**
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {ConfigurationRegistryRead}
 */
export function configurationRegistryInitial(
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  return {
    state: { state: "Loading", held: undefined, load: "Initial" },
    request: configurationsRequest(accessToken, partition, undefined, limit),
  };
}

/**
 * @param {ConfigurationRegistryState} state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {ConfigurationRegistryRead}
 */
export function configurationRegistryRefresh(
  state,
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  return {
    state: {
      state: "Loading",
      held: configurationRegistryData(state),
      load: "Refresh",
    },
    request: configurationsRequest(accessToken, partition, undefined, limit),
  };
}

/**
 * @param {ConfigurationRegistryState} state
 * @param {string} accessToken
 * @param {import("./protocol.js").Partition} partition
 * @param {number} [limit]
 * @returns {ConfigurationRegistryRead | undefined}
 */
export function configurationRegistryNext(
  state,
  accessToken,
  partition,
  limit = pageLimitDefault,
) {
  if (state.state !== "Data" || state.nextCursor === undefined)
    return undefined;
  return {
    state: {
      state: "Loading",
      held: configurationRegistryData(state),
      load: "Next",
    },
    request: configurationsRequest(
      accessToken,
      partition,
      state.nextCursor,
      limit,
    ),
  };
}

/**
 * @param {Extract<ConfigurationRegistryState, { state: "Loading" }>} state
 * @param {import("./protocol.js").ApiOutcome} outcome
 * @returns {ConfigurationRegistryState}
 */
export function configurationRegistryReceived(state, outcome) {
  const result = readResult(outcome, parseConfigurationsPage);
  if (result.result !== "Value") return readStateFailure(state, result);
  const configurations =
    state.load === "Next" && state.held !== undefined
      ? [...state.held.configurations, ...result.value.configurations]
      : result.value.configurations;
  return {
    state: "Data",
    configurations,
    nextCursor: result.value.nextCursor,
  };
}
