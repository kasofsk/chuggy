/**
 * The invariant bundle asked one leaf at a time, so a predicate that cannot be
 * evaluated on a state is named rather than taking the run down with it.
 *
 * THE BUNDLE IS A CONJUNCTION AND A MEMBER OF IT MAY BE PARTIAL. A leaf that
 * walks the dependency graph reaches `ticketAt` for whatever key the edges
 * name, and on a state with a dangling dep that key is not there. That is the
 * model's own partiality — `model/domain.qnt` looks the same key up the same
 * way — and it is not a defect in either. `allInvariants` short-circuits, so
 * such a leaf is only ever reached where the leaves before it held;
 * `failedInvariants` asks every member.
 *
 * IT BITES HERE BECAUSE A REPLAY MEETS EXACTLY THOSE STATES. A conformance run
 * evaluates the bundle on what the deciders produced, and the state most worth
 * a report is the one a wrong decider just built: a stack trace out of a
 * derived set names neither the invariant nor the step, which is the whole of
 * what a reader needs. So each leaf is asked on its own, and a throw is
 * reported as that leaf refusing rather than as the run failing.
 *
 * A REFUSAL IS A FINDING. It says the state was malformed enough that a
 * predicate could not be applied to it, which is never a state this machine
 * reaches, and reporting it beside the members that answered false is what makes
 * the pair readable: one names the shape, the other names what fell over on it.
 */

import type { Config } from "../../src/domain/config.ts";
import {
  invariantBundle,
  type NamedInvariant,
  type StepView,
} from "../../src/domain/invariants.ts";

/** One state's answers: the members that came back false, and those that could not be asked. */
export interface BundleVerdict {
  readonly failed: readonly string[];
  readonly refused: readonly string[];
}

/** Every member of `roster`, in the model's order, each asked on its own. */
export function evaluateBundle(
  config: Config,
  view: StepView,
  roster: readonly NamedInvariant[] = invariantBundle,
): BundleVerdict {
  const failed: string[] = [];
  const refused: string[] = [];
  for (const member of roster) {
    try {
      if (!member.holds(config, view)) failed.push(member.invariant);
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      refused.push(`${member.invariant} (${why})`);
    }
  }
  return { failed, refused };
}

/** Whether a state answered every leaf and answered each of them yes. */
export function bundleHolds(verdict: BundleVerdict): boolean {
  return verdict.failed.length === 0 && verdict.refused.length === 0;
}
