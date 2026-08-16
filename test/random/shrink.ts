/**
 * Greedy trace shrinking: drop the tail past the finding, then delete one step
 * at a time, keeping a deletion only when what remains is still a machine trace
 * and still fails.
 *
 * THE ORACLE IS `walkReplay`, WHICH RE-CHECKS EVERY GUARD AND EVERY DRAW at the
 * state each surviving step now meets — deleting a step changes every state
 * after it, so a candidate is worthless until the machine itself has accepted
 * it again. A candidate that fails earlier than the original is truncated
 * there, which is a free shrink. The result is one-minimal: the passes repeat
 * until a whole pass deletes nothing, so no single deletion can keep it red.
 *
 * BOUNDED BY CONSTRUCTION. Every accepted deletion or truncation strictly
 * shortens the trace, the inner sweep advances or shortens on every iteration,
 * and the outer loop carries an explicit cap wide enough for one confirming
 * pass past every possible deletion, on top of its own fixed-point exit.
 */

import type { Config } from "../../src/domain/config.ts";
import { walkReplay, type Decide, type WalkStep } from "./walk.ts";

/** The candidate without one step. */
function shrinkWithout(
  steps: readonly WalkStep[],
  index: number,
): readonly WalkStep[] {
  return [...steps.slice(0, index), ...steps.slice(index + 1)];
}

/**
 * Shrinks a failing trace to a one-minimal failing trace. The input must fail;
 * handing this a clean trace is a caller error and is refused loudly.
 */
export function shrinkSteps(
  config: Config,
  steps: readonly WalkStep[],
  decide: Decide,
): readonly WalkStep[] {
  const opening = walkReplay(config, steps, decide);
  if (opening.kind !== "finding") {
    throw new Error(
      "shrink: the trace does not fail, so there is nothing to shrink",
    );
  }
  let kept = steps.slice(0, opening.at);
  const passesMax = kept.length + 1;
  for (let pass = 0; pass < passesMax; pass++) {
    let deleted = false;
    let index = 0;
    while (index < kept.length) {
      const candidate = shrinkWithout(kept, index);
      const outcome = walkReplay(config, candidate, decide);
      if (outcome.kind === "finding") {
        kept = candidate.slice(0, outcome.at);
        deleted = true;
      } else {
        index++;
      }
    }
    if (!deleted) break;
  }
  return kept;
}
