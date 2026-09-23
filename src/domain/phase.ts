/**
 * Where a ticket's lifecycle position sits: settled or still moving, and which
 * of the settled phases absorb.
 *
 * The phases themselves come from the model. Both predicates are exhaustive
 * switches over that vocabulary, so a phase added there is a compile error
 * here rather than a phase silently classified as moving.
 */

import { assertNever } from "./assertNever.ts";
import { phaseTags, type Phase } from "./generated/modelTypes.ts";

/** The settled tier: the phases no work follows from. */
export function isSettled(phase: Phase): boolean {
  switch (phase) {
    case "Done":
    case "Escalated":
    case "Revoked":
      return true;
    case "Pending":
    case "Work":
    case "Evaluation":
    case "Finalization":
      return false;
    default:
      return assertNever(phase);
  }
}

/** The absorbing lifecycle endpoints; Escalated remains resumable. */
export function isTerminalPhase(phase: Phase): boolean {
  return phase === "Done" || phase === "Revoked";
}

/** The domain-owned meaning of the public non-terminal ticket selection. */
export const nonTerminalPhaseTags: readonly Phase[] = phaseTags.filter(
  (phase) => !isTerminalPhase(phase),
);

/** Revocation stops before finalization and cannot rewrite a terminal outcome. */
export function revocationAllowed(phase: Phase): boolean {
  return phase !== "Done" && phase !== "Revoked" && phase !== "Finalization";
}
