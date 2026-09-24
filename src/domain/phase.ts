/**
 * The ticket's lifecycle position by name: the tag of its `TicketState`, what
 * the projection, the wire and the console call a phase.
 *
 * The model carries no phase of its own — the state's constructor is the
 * phase — so the vocabulary here is the state's tags, in the order the
 * projection has always listed them. `phaseOf` is total over the state and
 * every predicate below is an exhaustive switch, so a state added in the model
 * is a compile error here rather than a phase silently classified.
 */

import { assertNever } from "./assertNever.ts";
import type { TicketState } from "./generated/modelTypes.ts";

/** A state's tag. */
export type Phase = TicketState extends infer State
  ? State extends string
    ? State
    : State extends { readonly type: infer Tag }
      ? Tag
      : never
  : never;

/** Every phase, in the projection's order. */
export const phaseTags: readonly Phase[] = [
  "Pending",
  "Work",
  "Evaluation",
  "Finalization",
  "Done",
  "Escalated",
  "Revoked",
];

/** The phase a state is in: its tag. */
export function phaseOf(state: TicketState): Phase {
  return typeof state === "string" ? state : state.type;
}

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

/** The package's `isTerminal`: Done or Revoked. */
export function isTerminal(state: TicketState): boolean {
  return isTerminalPhase(phaseOf(state));
}

/** The package's `isPending`. */
export function isPending(state: TicketState): boolean {
  return state === "Pending";
}

/** The package's `isEscalated`. */
export function isEscalated(state: TicketState): boolean {
  return phaseOf(state) === "Escalated";
}

/** The package's `revocationAllowed`: anything short of Finalization and the terminals. */
export function revocationAllowed(state: TicketState): boolean {
  const phase = phaseOf(state);
  return phase !== "Done" && phase !== "Revoked" && phase !== "Finalization";
}
