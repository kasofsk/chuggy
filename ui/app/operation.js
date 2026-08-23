/**
 * Following a submitted operation from its 202 to a terminal state.
 *
 * The machine is a pure step over what the last poll returned; the caller owns
 * the timer and performs the request. Every path out of `Following` is bounded
 * by the attempt budget, so a stuck operation ends as a state the console can
 * draw rather than as a loop.
 */

export const operationAttemptsMax = 40;

/** Terminal to the console: nothing it can poll will change these. */
export const operationTerminalStates = [
  "Succeeded",
  "Answered",
  "Refused",
  "Cancelled",
];

/**
 * @typedef {{ step: "Submitting", ticket: number }
 *   | { step: "Backlogged", ticket: number, code: string, retryAfterSeconds: number }
 *   | { step: "Following", ticket: number, operation: string, attempts: number }
 *   | { step: "Settled", ticket: number, operation: string, state: string,
 *        refusalCode: string | undefined }
 *   | { step: "Abandoned", ticket: number, reason: string }} OperationStep
 */

/**
 * @typedef {{ event: "Accepted", operation: string, state: string }
 *   | { event: "Deferred", code: string, retryAfterSeconds: number }
 *   | { event: "Polled", state: string, refusalCode: string | undefined }
 *   | { event: "Absent" }
 *   | { event: "Faulted", reason: string }} OperationEvent
 */

/**
 * @param {number} ticket
 * @returns {OperationStep}
 */
export function operationSubmitting(ticket) {
  return { step: /** @type {const} */ ("Submitting"), ticket };
}

/**
 * @param {OperationStep} step
 * @param {string} operation
 * @param {string} state
 * @param {string | undefined} refusalCode
 * @returns {OperationStep}
 */
function settled(step, operation, state, refusalCode) {
  return {
    step: /** @type {const} */ ("Settled"),
    ticket: step.ticket,
    operation,
    state,
    refusalCode,
  };
}

/**
 * @param {OperationStep} step
 * @param {string} reason
 * @returns {OperationStep}
 */
function abandoned(step, reason) {
  return {
    step: /** @type {const} */ ("Abandoned"),
    ticket: step.ticket,
    reason,
  };
}

/**
 * @param {OperationStep} step
 * @param {string} operation
 * @param {number} attempts
 * @returns {OperationStep}
 */
function following(step, operation, attempts) {
  return {
    step: /** @type {const} */ ("Following"),
    ticket: step.ticket,
    operation,
    attempts,
  };
}

/**
 * @param {OperationStep} step
 * @param {{ operation: string, state: string }} event
 * @returns {OperationStep}
 */
function operationAccepted(step, event) {
  return operationTerminalStates.includes(event.state)
    ? settled(step, event.operation, event.state, undefined)
    : following(step, event.operation, 0);
}

/**
 * @param {OperationStep} step
 * @param {{ state: string, refusalCode: string | undefined }} event
 * @returns {OperationStep}
 */
function operationPolled(step, event) {
  if (step.step !== "Following")
    return abandoned(step, "a poll arrived before the operation was accepted");
  if (operationTerminalStates.includes(event.state))
    return settled(step, step.operation, event.state, event.refusalCode);
  const attempts = step.attempts + 1;
  return attempts >= operationAttemptsMax
    ? abandoned(step, "the operation is still pending after the attempt budget")
    : following(step, step.operation, attempts);
}

/**
 * @param {OperationStep} step
 * @param {OperationEvent} event
 * @returns {OperationStep}
 */
export function operationAdvanced(step, event) {
  switch (event.event) {
    case "Accepted":
      return operationAccepted(step, event);
    case "Deferred":
      return {
        step: /** @type {const} */ ("Backlogged"),
        ticket: step.ticket,
        code: event.code,
        retryAfterSeconds: event.retryAfterSeconds,
      };
    case "Polled":
      return operationPolled(step, event);
    case "Absent":
      return abandoned(step, "the operation is gone or was never visible");
    case "Faulted":
      return abandoned(step, event.reason);
    default:
      return abandoned(step, "an unreadable operation event");
  }
}

/**
 * Whether the caller should schedule another poll for this step.
 *
 * @param {OperationStep} step
 */
export function operationPolls(step) {
  return step.step === "Following" || step.step === "Backlogged";
}
