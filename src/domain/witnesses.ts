/**
 * The anti-vacuity witness. IT IS NOT AN INVARIANT OF THIS MACHINE: it is a
 * claim `model/domain.qnt` expects to be VIOLATED, and a run that reports it
 * green is a run that proved nothing.
 *
 * WHAT IT BUYS BY FAILING. `stageAdvanceNever` failing is the proof that
 * multi-stage plans run stage by stage, without which the `eval-stage-passed`
 * golden has nothing to aim at and the interpreter's advance edge is untested.
 *
 * THEY LIVE IN THEIR OWN FILE AND UNDER THEIR OWN TYPE, so folding one into
 * the bundle takes an import, a type that does not fit, and a run-time
 * membership check against the model that would reject the name. A `Witness`
 * carries a claim rather than a predicate that holds, and is not assignable to
 * `NamedInvariant` in either direction.
 */

import { type Config } from "./config.ts";
import type { StepView } from "./invariants.ts";

/** One witness: a claim the machine refutes, under the name the model declares it by. */
export interface Witness {
  readonly witness: string;
  readonly claim: (config: Config, view: StepView) => boolean;
}

/** No eval stage ever advances: no progress owes a task. Violated by the interpreter's advance edge. */
export function stageAdvanceNever(_config: Config, view: StepView): boolean {
  return (
    view.last === "NoDecision" ||
    view.last.type !== "Decided" ||
    view.last.value.event.type !== "TicketEvaluationProgressed" ||
    view.last.value.obligations.length === 0
  );
}

/** The roster, so a suite iterates it rather than restating the list. */
export const witnesses: readonly Witness[] = [
  { witness: "stageAdvanceNever", claim: stageAdvanceNever },
];
