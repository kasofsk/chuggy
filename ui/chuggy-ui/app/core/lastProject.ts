/**
 * The project this browser was last looking at.
 *
 * It is a convenience and never an authority: a stored partition the inventory
 * does not carry is discarded, so a project that was renamed or withdrawn
 * cannot strand a tab on a route the API will refuse.
 */

import { partitionSchema } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import type { KeyValuePort } from "./sessionHolder.ts";

export const lastProjectKey = "chuggy.lastProject";

export function lastProjectRead(
  store: KeyValuePort,
): PartitionIdentity | undefined {
  const stored = store.read(lastProjectKey);
  if (stored === null) return undefined;
  try {
    return partitionSchema.parse(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

export function lastProjectWrite(
  store: KeyValuePort,
  partition: PartitionIdentity,
): void {
  store.write(lastProjectKey, JSON.stringify(partition));
}

/** The remembered project if the inventory still has it, else the first one. */
export function lastProjectOrFirst(
  remembered: PartitionIdentity | undefined,
  inventory: readonly PartitionIdentity[],
): PartitionIdentity | undefined {
  const held = inventory.find(
    (candidate) =>
      remembered !== undefined &&
      candidate.tenant === remembered.tenant &&
      candidate.project === remembered.project,
  );
  return held ?? inventory[0];
}
