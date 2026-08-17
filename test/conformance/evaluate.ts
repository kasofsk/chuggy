/**
 * The invariant bundle asked one leaf at a time, so a predicate that cannot be
 * evaluated on a state is named rather than taking the run down with it.
 *
 * THE BUNDLE IS A CONJUNCTION AND ITS MEMBERS ARE PARTIAL. `allInvariants`
 * short-circuits, so a leaf that walks the dependency graph is only ever
 * reached on a state where `depsAcyclic` already held; `failedInvariants` asks
 * every member, and on a state with a dangling dep `cascadeSafety` reaches
 * `ticketAt` for a key that is not there and throws. That is the model's own
 * partiality — `model/domain.qnt` looks the same key up the same way — and it
 * is not a defect in either.
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
 * reaches, and reporting it beside the leaves that answered false is what makes
 * the pair readable: one names the shape, the other names what fell over on it.
 */

import type { Config } from "../../src/domain/config.ts";
import { invariantLeaves, type StepView } from "../../src/domain/invariants.ts";

/** One state's answers: the leaves that came back false, and the leaves that could not be asked. */
export interface BundleVerdict {
  readonly failed: readonly string[];
  readonly refused: readonly string[];
}

/** Every leaf of `invariantLeaves`, in the model's order, each asked on its own. */
export function evaluateBundle(config: Config, view: StepView): BundleVerdict {
  const failed: string[] = [];
  const refused: string[] = [];
  for (const member of invariantLeaves) {
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
