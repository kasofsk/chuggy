/**
 * Which evaluations over a stack are to be invalidated: the ones whose stack
 * stopped standing. `model/stacking.qnt`'s `sweep` states it, and this is its
 * definition for the tickets still in an evaluation. A ticket not yet evaluated
 * and one whose evaluation failed are not swept: the first lands as a re-check
 * when its merge result is not the tree it was evaluated on, and the second is
 * taken as `InvalidateEvaluationFailure` by the writer's failure policy where a
 * marker says its stack was dead.
 *
 * It takes plain data and reads nothing, so it replays without a database.
 */

import type { EvaluatingStack } from "./evaluationStack.ts";
import { stackStands, type StackEntry } from "./stackChoice.ts";

/** The evaluating stacks among `evaluating` that no longer stand over `queue`. */
export function stackInvalidations(
  evaluating: readonly EvaluatingStack[],
  queue: readonly StackEntry[],
): readonly EvaluatingStack[] {
  return evaluating.filter((each) => !stackStands(each.standing, queue));
}
