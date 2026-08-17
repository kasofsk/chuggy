/**
 * Names to transforms, so a pipeline is configured as a list of names rather
 * than of functions.
 *
 * It is an interface rather than the map behind it, so `registryOf` is the only
 * way to make one: a bare map would satisfy a map-shaped type structurally and
 * carry a duplicate name past the refusal below.
 */

import type { TransformName } from "./names.ts";
import type { Transform } from "./transform.ts";

export type RegistryEntry<View> = readonly [
  name: TransformName,
  transform: Transform<View>,
];

export interface Registry<View> {
  transformNamed(name: TransformName): Transform<View> | undefined;
}

/** A name declared twice is refused: which definition won would otherwise be declaration order. */
export function registryOf<View>(
  entries: readonly RegistryEntry<View>[],
): Registry<View> {
  const byName = new Map<TransformName, Transform<View>>();
  for (const [name, transform] of entries) {
    if (byName.has(name)) {
      throw new Error(`registry: ${name} is declared twice`);
    }
    byName.set(name, transform);
  }
  return { transformNamed: (name) => byName.get(name) };
}
