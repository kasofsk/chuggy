/**
 * The eval program's verdict rule, interpreted over a resolved stage.
 *
 * Eval is data, and the data — `Stage` and `Combinator` — is the model's. What
 * is here is what the model does with it.
 */

import { assertNever } from "./assertNever.ts";
import type { Combinator, Task } from "./generated/modelTypes.ts";
import { taskPassed } from "./task.ts";

/** The combinator interpreted over a resolved set. Callers guarantee every task is resolved. */
export function combine(
  combinator: Combinator,
  tasks: ReadonlySet<Task>,
): boolean {
  switch (combinator) {
    case "UnanimousPass":
      return [...tasks].every(taskPassed);
    case "AnyPass":
      return [...tasks].some(taskPassed);
    default:
      return assertNever(combinator);
  }
}
