/**
 * Every wire outcome turned into a state the console can draw.
 *
 * One function reads a response body, and it is the only one: a parse throws
 * on anything the server sends that this console cannot read, and a caller
 * that let that escape would leave its panel reading forever. So the throw is
 * caught here, beside the reasons, rather than at each of the places that
 * would have to remember to.
 */

import { parseOperation } from "./resources.js";

/** @typedef {import("./protocol.js").ApiOutcome} ApiOutcome */

/**
 * @typedef {{ result: "Value", value: T }
 *   | { result: "Deferred", code: string, retryAfterSeconds: number }
 *   | { result: "Unavailable", reason: string }} ReadResult
 * @template T
 */

export const unreadableReason =
  "The server sent a resource this console cannot read.";

/**
 * Absent and inaccessible share a sentence because the server makes them one.
 *
 * The parameter excludes the three outcomes that are not failures, so a caller
 * that reached here with one would not compile rather than render a sentence
 * about an undefined code.
 *
 * @param {Exclude<ApiOutcome, { outcome: "Ok" | "Accepted" | "Retryable" }>} outcome
 */
export function unavailableReason(outcome) {
  if (outcome.outcome === "Absent")
    return "The resource is absent, or this account cannot see it.";
  if (outcome.outcome === "Unauthenticated")
    return "The session is no longer accepted.";
  if (outcome.outcome === "Conflict")
    return `The server answered ${outcome.code}.`;
  return `The read failed: ${outcome.code}.`;
}

/**
 * @template T
 * @param {ApiOutcome} outcome
 * @param {(body: unknown) => T} parse
 * @returns {ReadResult<T>}
 */
export function readResult(outcome, parse) {
  if (outcome.outcome === "Ok" || outcome.outcome === "Accepted") {
    try {
      return { result: "Value", value: parse(outcome.body) };
    } catch {
      return { result: "Unavailable", reason: unreadableReason };
    }
  }
  if (outcome.outcome === "Retryable")
    return {
      result: "Deferred",
      code: outcome.code,
      retryAfterSeconds: outcome.retryAfterSeconds,
    };
  return { result: "Unavailable", reason: unavailableReason(outcome) };
}

/**
 * What a submission's answer and an operation read's answer have in common:
 * gone, deferred, or a body this console cannot read. Only the success arm
 * differs between them, so only that arm is written twice.
 *
 * @param {ApiOutcome} outcome
 * @returns {{ read: "Event", event: import("./operation.js").OperationEvent }
 *   | { read: "Resource", resource: ReturnType<typeof parseOperation> }}
 */
function operationRead(outcome) {
  if (outcome.outcome === "Absent")
    return { read: "Event", event: { event: "Absent" } };
  const read = readResult(outcome, parseOperation);
  if (read.result === "Deferred")
    return {
      read: "Event",
      event: {
        event: "Deferred",
        code: read.code,
        retryAfterSeconds: read.retryAfterSeconds,
      },
    };
  if (read.result === "Unavailable")
    return { read: "Event", event: { event: "Faulted", reason: read.reason } };
  return { read: "Resource", resource: read.value };
}

/**
 * A backlogged submission is deferred rather than failed: the same key resent
 * after the delay is the same command, and the server answers the original.
 *
 * @param {ApiOutcome} outcome
 * @returns {import("./operation.js").OperationEvent}
 */
export function submissionEvent(outcome) {
  const read = operationRead(outcome);
  return read.read === "Event"
    ? read.event
    : {
        event: "Accepted",
        operation: read.resource.operation,
        state: read.resource.state,
      };
}

/**
 * @param {ApiOutcome} outcome
 * @returns {import("./operation.js").OperationEvent}
 */
export function operationEvent(outcome) {
  const read = operationRead(outcome);
  return read.read === "Event"
    ? read.event
    : {
        event: "Polled",
        state: read.resource.state,
        refusalCode: read.resource.refusalCode,
      };
}
