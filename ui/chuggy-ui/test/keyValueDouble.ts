/**
 * A `KeyValuePort` a case can read back, standing in for the two browser
 * stores. The session and the forge install transaction are both written
 * through one, so the double is written once here rather than in each suite.
 */

import type { KeyValuePort } from "../app/core/sessionHolder.ts";

export type HeldStore = KeyValuePort & { readonly held: Map<string, string> };

export function keyValueDouble(): HeldStore {
  const held = new Map<string, string>();
  return {
    held,
    read: (key) => held.get(key) ?? null,
    write: (key, value) => {
      held.set(key, value);
    },
    remove: (key) => {
      held.delete(key);
    },
  };
}
