/**
 * What a panel knows, and how old it is.
 *
 * There is no state here that a renderer could draw as an empty healthy panel:
 * a panel that has never read says so, and one whose last read failed keeps the
 * value it has and the reason it is not newer.
 */

import { pollIntervalMsBase } from "./polling.js";

export const freshnessAgingMsAfter = pollIntervalMsBase * 2;
export const freshnessStaleMsAfter = pollIntervalMsBase * 6;

/**
 * @typedef {{ state: "Unknown" }
 *   | { state: "Loading", held: Held | undefined }
 *   | { state: "Ready", value: unknown, observedAtMs: number }
 *   | { state: "Deferred", code: string, retryAfterSeconds: number, held: Held | undefined }
 *   | { state: "Unavailable", reason: string, held: Held | undefined }} Panel
 */

/** @typedef {{ value: unknown, observedAtMs: number }} Held */

/** @type {Panel} */
export const panelUnknown = { state: "Unknown" };

/**
 * @param {Panel} panel
 * @returns {Held | undefined}
 */
function held(panel) {
  if (panel.state === "Ready")
    return { value: panel.value, observedAtMs: panel.observedAtMs };
  return panel.state === "Unknown" ? undefined : panel.held;
}

/** @param {Panel} panel */
export function panelLoading(panel) {
  return { state: /** @type {const} */ ("Loading"), held: held(panel) };
}

/**
 * @param {unknown} value
 * @param {number} observedAtMs
 */
export function panelReady(value, observedAtMs) {
  return { state: /** @type {const} */ ("Ready"), value, observedAtMs };
}

/**
 * A backlog or a busy server is a state the console shows, not an error it
 * throws away.
 *
 * @param {Panel} panel
 * @param {string} code
 * @param {number} retryAfterSeconds
 */
export function panelDeferred(panel, code, retryAfterSeconds) {
  return {
    state: /** @type {const} */ ("Deferred"),
    code,
    retryAfterSeconds,
    held: held(panel),
  };
}

/**
 * @param {Panel} panel
 * @param {string} reason
 */
export function panelUnavailable(panel, reason) {
  return {
    state: /** @type {const} */ ("Unavailable"),
    reason,
    held: held(panel),
  };
}

/**
 * The value a panel can still show, whatever its current state.
 *
 * @param {Panel} panel
 */
export function panelHeld(panel) {
  return held(panel);
}

/**
 * @param {Panel} panel
 * @param {number} nowMs
 * @returns {{ verdict: "NoEvidence" }
 *   | { verdict: "Fresh" | "Aging" | "Stale", ageMs: number }}
 */
export function freshness(panel, nowMs) {
  const evidence = held(panel);
  if (evidence === undefined) return { verdict: "NoEvidence" };
  const ageMs = Math.max(nowMs - evidence.observedAtMs, 0);
  if (ageMs >= freshnessStaleMsAfter) return { verdict: "Stale", ageMs };
  if (ageMs >= freshnessAgingMsAfter) return { verdict: "Aging", ageMs };
  return { verdict: "Fresh", ageMs };
}

/**
 * How far a panel has aged toward its next scheduled read, clamped to the bar.
 *
 * @param {number} ageMs
 * @param {number} dueMs
 */
export function freshnessFraction(ageMs, dueMs) {
  if (dueMs <= 0) return 1;
  return Math.min(Math.max(ageMs / dueMs, 0), 1);
}

/**
 * The sentence a panel header carries. A panel with no evidence names what it
 * is missing; one with evidence names how old that evidence is.
 *
 * @param {Panel} panel
 * @param {number} nowMs
 * @param {string} asOf
 */
export function freshnessCaption(panel, nowMs, asOf) {
  const verdict = freshness(panel, nowMs);
  if (verdict.verdict === "NoEvidence")
    return panel.state === "Loading" ? "Reading…" : "Not read yet";
  return `${asOf} ${elapsedCaption(verdict.ageMs)} ago`;
}

/**
 * Elapsed time in the largest unit that still reads as a number.
 *
 * @param {number} ageMs
 */
export function elapsedCaption(ageMs) {
  const seconds = Math.floor(ageMs / 1_000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h`;
}
