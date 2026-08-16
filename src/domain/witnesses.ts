/**
 * The three anti-vacuity witnesses. THEY ARE NOT INVARIANTS OF THIS MACHINE,
 * and each is a claim `model/domain.qnt` expects to be VIOLATED: a run that
 * reports one green is a run that proved nothing.
 *
 * WHAT EACH ONE BUYS BY FAILING. `freeClimbNever` failing on the free-retry
 * instance is the machine-level proof that a free pipeline resume really does
 * climb the measure and really is exempted by `stepDescends`' churn arm, which
 * no green run could tell from dead code. `cascadeParkNever` failing is the
 * proof that the cascade parks dependents on reachable states, without which
 * `cascadeSafety` is vacuously true wherever nothing is doomed.
 * `stageAdvanceNever` failing is the proof that multi-stage programs run stage
 * by stage, without which the stage digit and the interpreter's advance edge
 * are never exercised.
 *
 * THEY LIVE IN THEIR OWN FILE AND UNDER THEIR OWN TYPE, so folding one into
 * the bundle takes an import, a type that does not fit, and a run-time
 * membership check against the model that would reject the name. A `Witness`
 * carries a claim rather than a predicate that holds, and is not assignable to
 * `NamedInvariant` in either direction.
 */

import { boundsOf, type Config } from "./config.ts";
import { sysMeasure } from "./measure.ts";
import type { StepView } from "./invariants.ts";

/** One witness: a claim the machine refutes, under the name the model declares it by. */
export interface Witness {
  readonly witness: string;
  readonly claim: (config: Config, view: StepView) => boolean;
}

/**
 * No operator retry into a pipeline phase ever climbs the measure. Violated
 * under free retries and holding under charged ones, which is the whole of its
 * value; the pre-work resume is deliberately excluded because that flavour is
 * free under both meterings.
 */
export function freeClimbNever(config: Config, view: StepView): boolean {
  const bounds = boundsOf(config);
  return !(
    view.rec.label === "operator-retry" &&
    view.rec.transitions.some(
      (t) => t.to === "PEvaluating" || t.to === "PWrapUp",
    ) &&
    sysMeasure(bounds, view.post) > sysMeasure(bounds, view.pre)
  );
}

/** No revoke ever parks a dependent. Violated by any revoke whose cascade finds one. */
export function cascadeParkNever(_config: Config, view: StepView): boolean {
  return !(
    view.rec.label === "ticket-revoked" && view.rec.transitions.length > 1
  );
}

/** No eval stage ever advances. Violated by the interpreter's advance edge. */
export function stageAdvanceNever(_config: Config, view: StepView): boolean {
  return view.rec.label !== "eval-stage-passed";
}

/** The three, so a suite iterates them rather than restating the list. */
export const witnesses: readonly Witness[] = [
  { witness: "freeClimbNever", claim: freeClimbNever },
  { witness: "cascadeParkNever", claim: cascadeParkNever },
  { witness: "stageAdvanceNever", claim: stageAdvanceNever },
];
