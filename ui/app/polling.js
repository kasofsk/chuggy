/**
 * Every bound the console's refresh loop runs under.
 *
 * The loop stops on its own three ways — consecutive failures, elapsed ticks
 * without interaction, and an explicit pause — so no arrangement of server
 * answers leaves a browser polling forever.
 */

export const pollIntervalMsBase = 5_000;
export const pollIntervalMsMax = 120_000;
export const pollFailuresMax = 6;
export const pollTicksMax = 240;
export const pollJitterMsMax = 750;

/**
 * Doubling from the base, capped, and clamped to the failure budget.
 *
 * @param {number} failures
 */
export function backoffDelayMs(failures) {
  if (!Number.isSafeInteger(failures) || failures < 0)
    throw new RangeError("a failure count is not a non-negative integer");
  if (failures === 0) return pollIntervalMsBase;
  const doublings = Math.min(failures, pollFailuresMax) - 1;
  return Math.min(pollIntervalMsBase * 2 ** doublings, pollIntervalMsMax);
}

/**
 * A retry-after the server named wins over the schedule, because it is the
 * only party that knows when the backlog clears.
 *
 * @param {number} retryAfterSeconds
 */
export function retryDelayMs(retryAfterSeconds) {
  return Math.min(Math.max(retryAfterSeconds, 1) * 1_000, pollIntervalMsMax);
}

/**
 * A fraction of a tick, drawn by the caller, so two consoles do not align.
 *
 * @param {number} delayMs
 * @param {number} draw
 */
export function jitteredDelayMs(delayMs, draw) {
  if (draw < 0 || draw >= 1)
    throw new RangeError("a jitter draw is outside [0, 1)");
  return delayMs + Math.floor(draw * pollJitterMsMax);
}

/**
 * @typedef {object} PollState
 * @property {number} failures consecutive failures since the last good read
 * @property {number} ticks polls issued since the loop last resumed
 * @property {boolean} paused whether the operator stopped the loop
 * @property {number} retryAfterSeconds a server-named delay, or zero
 */

/**
 * A loop that has not run yet.
 *
 * @returns {PollState}
 */
export function pollStart() {
  return { failures: 0, ticks: 0, paused: false, retryAfterSeconds: 0 };
}

/**
 * @param {PollState} state
 * @param {number} sinceLastPollMs
 * @returns {{ action: "Poll" } | { action: "Wait", delayMs: number }
 *   | { action: "Stopped", reason: "Failures" | "Ticks" | "Paused" }}
 */
export function pollDecision(state, sinceLastPollMs) {
  if (state.paused) return { action: "Stopped", reason: "Paused" };
  if (state.failures >= pollFailuresMax)
    return { action: "Stopped", reason: "Failures" };
  if (state.ticks >= pollTicksMax)
    return { action: "Stopped", reason: "Ticks" };
  const dueMs =
    state.retryAfterSeconds > 0
      ? retryDelayMs(state.retryAfterSeconds)
      : backoffDelayMs(state.failures);
  return sinceLastPollMs >= dueMs
    ? { action: "Poll" }
    : { action: "Wait", delayMs: dueMs - sinceLastPollMs };
}

/**
 * A good read clears the failure budget and any server-named delay.
 *
 * @param {PollState} state
 * @returns {PollState}
 */
export function pollSucceeded(state) {
  return {
    ...state,
    failures: 0,
    ticks: state.ticks + 1,
    retryAfterSeconds: 0,
  };
}

/**
 * @param {PollState} state
 * @returns {PollState}
 */
export function pollFailed(state) {
  return {
    ...state,
    failures: state.failures + 1,
    ticks: state.ticks + 1,
    retryAfterSeconds: 0,
  };
}

/**
 * @param {PollState} state
 * @param {number} retryAfterSeconds
 * @returns {PollState}
 */
export function pollDeferred(state, retryAfterSeconds) {
  return { ...state, ticks: state.ticks + 1, retryAfterSeconds };
}

/**
 * Resuming is the operator's, and it is what clears every stop reason.
 *
 * @param {PollState} state
 * @returns {PollState}
 */
export function pollResumed(state) {
  return {
    ...state,
    failures: 0,
    ticks: 0,
    paused: false,
    retryAfterSeconds: 0,
  };
}

/**
 * @param {PollState} state
 * @returns {PollState}
 */
export function pollPaused(state) {
  return { ...state, paused: true };
}
