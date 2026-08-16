/**
 * THE EFFECT VOCABULARY — `model/domain.qnt`'s eight effect strings as a type,
 * and the codec that keeps the type and the strings the same thing.
 *
 * WHAT THE MODEL ACTUALLY HAS, because the encoding turns on it. The model
 * declares no effect sum type at all: `StepRecord.effects` is `List[str]` and
 * every decider writes a literal into it. So there is nothing here to mirror
 * definition-for-definition; what this file does is close that open vocabulary,
 * which is the one thing a `List[str]` cannot do for itself — an unknown string
 * is a value the model's type admits and no dispatch can be total over.
 *
 * THE ENCODING, and it is the tree's existing rule rather than a new one:
 *
 *  13. THE MODEL'S EFFECT STRINGS BECOME A SUM TYPE HERE, under
 *      `measure.ts`'s encoding decision 1 — every constructor is nullary, so it
 *      is a union of string literals named exactly for those constructors. The
 *      alternative, eight payload-free records tagged `tag`, would be decision
 *      2's shape applied to a type with no payload, and would put a second
 *      convention for nullary constructors in a tree that already has one
 *      (`Phase`, `Verdict`, `Resume` and five more are spelled this way, and
 *      `Phase` is carried in a `StepRecord` exactly as an effect is).
 *
 * WHICH MAKES THE SERIALIZATION 1:1 BY CONSTRUCTION, NOT BY A TABLE. An
 * `Effect` IS its journal string, so printing cannot drift from parsing and no
 * stored byte can change without the literal in this file changing with it. A
 * table mapping constructors to different strings would be a second statement
 * of the vocabulary, and the one that drifts is whichever is not being read on
 * the day a name changes. `effect.test.ts` holds the round trip to the
 * committed corpus — the model's own emitted traces — so the claim is checked
 * against bytes the model wrote rather than against bytes this file wrote.
 *
 * IT STORES NOTHING AND CHANGES NOTHING. The journal keeps strings:
 * `entry.ts`'s schema types a row's `rec` as a `StepRecord`, whose `effects`
 * stays `readonly string[]`, and s5's rows are byte-identical before and after
 * this slice. This type is the view an interpreter dispatches on, and it is
 * built at the point of dispatch and discarded there.
 *
 * WHY IT IS IN `src/effects/` AND NOT THE SPINE. An effect is data describing a
 * request to the world, and `.dependency-cruiser.mjs`'s `effects-reach-only-domain`
 * rule is what that sentence means operationally: this file may read the
 * domain's `StepRecord` and nothing above it. It knows no journal, no cursor,
 * no port and no fabric.
 */

import { invariant } from "../domain/assert.ts";
import type { StepRecord } from "../domain/measure.ts";

/**
 * `model/domain.qnt`'s effect vocabulary: what a decision asks the world to do.
 *
 * The eight, with the decider that emits each: `CreateDraft` (`decideArrive`),
 * `Revoke` (`decideRevoke`), `OpenHumanTask` (`escalate`, and once per parked
 * dependent in the revoke cascade), `SpawnWorkTasks` (`decideDispatch`, both
 * rework arms, the `RWorking` resume), `SpawnEvalTasks` (`decideWorkReduce`,
 * the stage advance, the `REvaluating` resume), `EnqueueWrapUp` (`eval-passed`,
 * the `RWrapUp` resume), `OpenGate` (`decideWrapUpStart`) and `Complete`
 * (`completeTicket`).
 */
export type Effect =
  | "CreateDraft"
  | "Revoke"
  | "OpenHumanTask"
  | "SpawnWorkTasks"
  | "SpawnEvalTasks"
  | "EnqueueWrapUp"
  | "OpenGate"
  | "Complete";

/**
 * The vocabulary as data, in `model/domain.qnt`'s own definition order.
 *
 * THE COMPILER MAINTAINS THIS COPY, which is what makes a second statement of
 * the union legitimate here: the `satisfies` clause is an identity mapped type
 * over `Effect`, so a constructor added to the type without a row here is a
 * compile error, a row here that is not in the type is a compile error, and a
 * row whose value is any string but its own key is a compile error. Nothing
 * about it can be forgotten.
 */
const vocabulary = {
  CreateDraft: "CreateDraft",
  Revoke: "Revoke",
  OpenHumanTask: "OpenHumanTask",
  SpawnWorkTasks: "SpawnWorkTasks",
  SpawnEvalTasks: "SpawnEvalTasks",
  EnqueueWrapUp: "EnqueueWrapUp",
  OpenGate: "OpenGate",
  Complete: "Complete",
} as const satisfies { readonly [E in Effect]: E };

/** Every effect the machine can emit, so a roster can be taken over the type. */
export const effectVocabulary: readonly Effect[] = Object.values(vocabulary);

/**
 * The typed view of one journal string, or `undefined` for a string outside the
 * vocabulary.
 *
 * IT ANSWERS RATHER THAN THROWING, because its caller is reading a record that
 * outlived the process which wrote it: a row carrying an effect this build does
 * not know is a log written by a machine this build is not, and that is a
 * verdict to report rather than an exception to raise inside an executor. The
 * scan is over eight entries, which is the bound.
 */
export function parseEffect(text: string): Effect | undefined {
  return effectVocabulary.find((known) => known === text);
}

/**
 * The journal string of one effect — the print half of the codec.
 *
 * It is the identity at run time, and that is the property rather than an
 * accident: the encoding above makes an `Effect` its own serialization, so
 * printing has nothing to do but widen the type. It is still a named function,
 * because a call site that spelled the widening itself would be a call site
 * that knows the encoding by heart, and because the round-trip test needs
 * something to hold the print side of the claim.
 */
export function printEffect(effect: Effect): string {
  return effect;
}

/**
 * A decision record's effects, typed — the whole list, in the order the decider
 * emitted it.
 *
 * ORDER AND MULTIPLICITY ARE BOTH LOAD-BEARING, so this is a map and never a
 * set. `decideRevoke` emits `["Revoke", "OpenHumanTask", "OpenHumanTask"]` for
 * a cascade that parks two dependents — the shape frozen in
 * `corpus/tier2/witness-cascade-park.itf.json` — and a list that deduplicated
 * would open one desk task for two tickets.
 *
 * IT ASSERTS RATHER THAN ANSWERING, which is the opposite of `parseEffect` one
 * line up and is deliberate. `parseEffect` is asked about a string of unknown
 * provenance; this is asked about a record that `journalLegalOn` has already
 * re-derived from its own decider, so an unknown effect here is not a foreign
 * log but a decider emitting a string this vocabulary does not hold — a defect
 * in this tree, at the moment the two halves of it disagree.
 */
export function effectsOf(rec: StepRecord): readonly Effect[] {
  return rec.effects.map((text) => {
    const effect = parseEffect(text);
    invariant(
      effect !== undefined,
      `effectsOf: ${JSON.stringify(text)} is not an effect this build knows, in a record labelled ${JSON.stringify(rec.label)}`,
    );
    return effect;
  });
}
