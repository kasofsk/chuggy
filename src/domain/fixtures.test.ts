/**
 * `model/tests/chuggy_test.qnt`'s FIXTURE VOCABULARY, once: the four task
 * builders, the two programs every suite reads, and the single-ticket Core the
 * model writes over and over as `{ tickets: Map(1 -> j) }`.
 *
 * WHY IT IS ITS OWN FILE. Both domain suites mirror the same model suite, so
 * both need its builders, and `.chug/tasks/check-duplication.sh` is at
 * threshold 0 with tests deliberately in scope. Its header draws the line this
 * file sits on: a test's SCENARIO may repeat, its HARNESS is extracted. Four
 * one-line builders and two programs are harness — what the scenarios are
 * written IN, not what they say.
 *
 * WHY IT IS NAMED `.test.ts` AND DECLARES NO TEST. That suffix is this tree's
 * file class for "exists only for the suite":
 * `.dependency-cruiser.mjs`'s `domain-not-through-its-tests` rule forbids
 * domain source from reaching a `.test.ts` file precisely so that a
 * suite-only fixture cannot become part of what the domain ships. Naming it
 * `fixtures.ts` would make it domain source — pure, and shipped, and neither
 * of those is true of it.
 */

import type { Core, Stage, Task, TaskOutcome, Ticket } from "./measure.ts";

/** A RESOLVED work task. */
export function wt(id: number, outcome: TaskOutcome): Task {
  return { id, kind: { tag: "TKWork" }, state: { tag: "TSResolved", outcome } };
}

/** A RESOLVED eval task of stage `stage`. */
export function et(id: number, stage: number, outcome: TaskOutcome): Task {
  return {
    id,
    kind: { tag: "TKEval", stage },
    state: { tag: "TSResolved", outcome },
  };
}

/** A RUNNING work task. */
export function wr(id: number): Task {
  return { id, kind: { tag: "TKWork" }, state: { tag: "TSRunning" } };
}

/** A RUNNING eval task of stage `stage`. */
export function er(id: number, stage: number): Task {
  return { id, kind: { tag: "TKEval", stage }, state: { tag: "TSRunning" } };
}

/**
 * `chuggy_test`'s progU2 — exactly `defaultProgram` at the suite's consts: one
 * unanimous stage at full fan-out.
 */
export const progU2: readonly Stage[] = [
  { fanout: 2, combinator: "CUnanimousPass" },
];

/**
 * `chuggy_test`'s progStaged — two stages, so a program can ADVANCE rather
 * than only pass, and so the two combinators appear in one program.
 */
export const progStaged: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
  { fanout: 2, combinator: "CAnyPass" },
];

/** The single-ticket Core the model writes as `{ tickets: Map(1 -> j) }`. */
export function solo(j: Ticket): Core {
  return { tickets: new Map([[1, j]]) };
}
