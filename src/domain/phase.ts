/**
 * A ticket's lifecycle position, and how far from settled it is.
 *
 * The rank ladder is built rung by rung from the one below it, exactly as
 * `model/measure.qnt` builds it: the ladder IS the derivation, so no rank
 * numeral is written twice and a rung inserted in the middle moves everything
 * above it without an edit. `rankCeiling` is what the measure's top multiplier
 * is derived from, which is why it is named rather than left as the value of
 * `rankDraft`.
 */

import { assertNever } from "./assertNever.ts";

/** The nine phases. `PWrapUpHolding` encodes an invalidated artifact with no stored flag. */
export type Phase =
  | "PDraft"
  | "PPending"
  | "PWorking"
  | "PEvaluating"
  | "PWrapUp"
  | "PWrapUpHolding"
  | "PDone"
  | "PEscalated"
  | "PRevoked";

/** Nothing is below settled: Done, Escalated and Revoked all rank here. */
export const rankSettled = 0;
/** A held lease sits directly above settled; every resolution settles or reworks in one step. */
export const rankHolding = rankSettled + 1;
/** Enqueued for the gate: the dequeue descends into it, the quiet path descends past it. */
export const rankWrapUp = rankHolding + 1;
export const rankEvaluating = rankWrapUp + 1;
export const rankWorking = rankEvaluating + 1;
/** The released waiting room, from which Ready and Blocked re-derive. */
export const rankPending = rankWorking + 1;
/** The only authoring phase, and the ladder's top. */
export const rankDraft = rankPending + 1;
/** The highest rank any phase takes, which the measure's top multiplier reads. */
export const rankCeiling = rankDraft;

/** How far from settled a phase is; the settled tier shares one rank. */
export function phaseRank(phase: Phase): number {
  switch (phase) {
    case "PDraft":
      return rankDraft;
    case "PPending":
      return rankPending;
    case "PWorking":
      return rankWorking;
    case "PEvaluating":
      return rankEvaluating;
    case "PWrapUp":
      return rankWrapUp;
    case "PWrapUpHolding":
      return rankHolding;
    case "PDone":
    case "PEscalated":
    case "PRevoked":
      return rankSettled;
    default:
      return assertNever(phase);
  }
}

/** The two absorbing terminals plus the author's settled choice. */
export function isSettled(phase: Phase): boolean {
  return phaseRank(phase) === rankSettled;
}
