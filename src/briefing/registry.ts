/**
 * Names to transforms, so a pipeline is configured as a list of names rather
 * than of functions. The spec is what a name means: which names exist, and
 * what the transform behind each one takes.
 *
 * The entries are an object rather than a list of pairs, so a name declared
 * twice is unrepresentable rather than refused, and the mapped type makes a
 * name with no transform behind it the same. Both were runtime refusals when
 * the spec was one branded string for every name.
 */

import type { Transform, TransformName } from "./transform.ts";

export type TransformsFor<View, Spec> = {
  readonly [Name in keyof Spec]: Transform<View, Spec[Name]>;
};

export interface Registry<View, Spec> {
  transformNamed<Name extends TransformName<Spec>>(
    name: Name,
  ): Transform<View, Spec[Name]>;
}

export function registryOf<View, Spec>(
  transforms: TransformsFor<View, Spec>,
): Registry<View, Spec> {
  return { transformNamed: (name) => transforms[name] };
}
