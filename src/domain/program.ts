/**
 * The eval program: an ordered list of stages, each with its own fan-out and
 * its own verdict rule. Eval is data, and this is the data.
 */

import { assertNever } from "./assertNever.ts";
import { taskPassed, type Task } from "./task.ts";

/** The required-pass rule for a stage, at this machine's grain. */
export type Combinator = "CUnanimousPass" | "CAnyPass";

/** One stage: how wide it fans out, and how its verdicts combine. */
export interface Stage {
  readonly fanout: number;
  readonly combinator: Combinator;
}

/** The combinator interpreted over a resolved set. Callers guarantee every task is resolved. */
export function combine(
  combinator: Combinator,
  tasks: readonly Task[],
): boolean {
  switch (combinator) {
    case "CUnanimousPass":
      return tasks.every(taskPassed);
    case "CAnyPass":
      return tasks.some(taskPassed);
    default:
      return assertNever(combinator);
  }
}
