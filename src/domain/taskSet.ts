/**
 * The verdict rule over a live task set, for a reader holding identities and
 * no instance.
 *
 * What a STAGE means is the protocol's (`stagePassed` in
 * `src/domain/evaluation.ts`), read off the run the instance keeps. This is
 * the same question asked of a task set, which is what the work cycle has.
 */

import type { Task } from "./generated/modelTypes.ts";
import { taskPassed } from "./task.ts";

/** Every task in the set passed. Callers guarantee every one of them is resolved. */
export function allPassed(tasks: ReadonlySet<Task>): boolean {
  return [...tasks].every(taskPassed);
}
