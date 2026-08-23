/**
 * How far from settled a ticket's lifecycle position is.
 *
 * The phases themselves come from the model. What lives here is the rank
 * ladder, built rung by rung from the one below exactly as `model/measure.qnt`
 * builds it: the ladder IS the derivation, so no rank numeral is written twice
 * and a rung inserted in the middle moves everything above it without an edit.
 * `rankCeiling` is what the measure's top multiplier reads, which is why it is
 * named rather than left as the value of `rankPending`.
 */

import { assertNever } from "./assertNever.ts";
import { phaseTags, type Phase } from "./generated/modelTypes.ts";

/** Nothing is below settled: Done, Escalated and Revoked all rank here. */
export const rankSettled = 0;
/** The point of no return sits directly above settled; its result settles or reworks in one step. */
export const rankFinalizing = rankSettled + 1;
export const rankEvaluating = rankFinalizing + 1;
export const rankWorking = rankEvaluating + 1;
/** The released waiting room, from which Ready and Blocked re-derive, and the ladder's top. */
export const rankPending = rankWorking + 1;
/** The highest rank any phase takes, which the measure's top multiplier reads. */
export const rankCeiling = rankPending;

/** How far from settled a phase is; the settled tier shares one rank. */
export function phaseRank(phase: Phase): number {
  switch (phase) {
    case "Pending":
      return rankPending;
    case "Working":
      return rankWorking;
    case "Evaluating":
      return rankEvaluating;
    case "Finalizing":
      return rankFinalizing;
    case "Done":
    case "Escalated":
    case "Revoked":
      return rankSettled;
    default:
      return assertNever(phase);
  }
}

/** The two absorbing terminals plus the author's settled choice. */
export function isSettled(phase: Phase): boolean {
  return phaseRank(phase) === rankSettled;
}

/** The absorbing lifecycle endpoints; Escalated remains resumable. */
export function isTerminalPhase(phase: Phase): boolean {
  return phase === "Done" || phase === "Revoked";
}

/** The domain-owned meaning of the public non-terminal ticket selection. */
export const nonTerminalPhaseTags: readonly Phase[] = phaseTags.filter(
  (phase) => !isTerminalPhase(phase),
);
