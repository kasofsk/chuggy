/**
 * The eval program's verdict rule, interpreted over a resolved stage.
 *
 * Eval is data, and the data — the `StageDefinition` a ticket's program carries — is
 * the model's. What is here is what the model does with it.
 */

import type { Task } from "./generated/modelTypes.ts";
import { taskPassed } from "./task.ts";

/** A stage passes when every evaluator in it passed. Callers guarantee every task is resolved. */
export function combine(tasks: ReadonlySet<Task>): boolean {
  return [...tasks].every(taskPassed);
}
