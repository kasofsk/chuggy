/**
 * Names to transforms, so a pipeline is configured as a list of names rather
 * than of functions. The spec is what a name means: which names exist, and
 * what the transform behind each one takes.
 *
 * The entries are an object rather than a list of pairs, so a name bound twice
 * is unrepresentable rather than refused: a registry is written here, in
 * TypeScript, where a second key cannot be spelled. That refusal is gone for
 * good and the list it guarded went with it.
 *
 * Lookup still answers `undefined`, which the mapped type says it need not.
 * The type states totality over a spec, and a spec is a compile-time artifact:
 * a name arriving from a ticket's configuration was a string one cast ago, and
 * `chain` is what refuses it.
 */

import type { Transform, TransformName } from "./transform.ts";

export type TransformsFor<View, Spec> = {
  readonly [Name in keyof Spec]: Transform<View, Spec[Name]>;
};

export interface Registry<View, Spec> {
  transformNamed<Name extends TransformName<Spec>>(
    name: Name,
  ): Transform<View, Spec[Name]> | undefined;
}

export function registryOf<View, Spec>(
  transforms: TransformsFor<View, Spec>,
): Registry<View, Spec> {
  return { transformNamed: (name) => transforms[name] };
}
