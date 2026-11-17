/**
 * What the console calls a project to a reader: the name it was given, as the
 * inventory lists it. A project the inventory does not hold, or not yet, is
 * called by its address, which is what its name is read as where none was
 * given. An address in a link or a route stays the address. Its icon is the
 * one the inventory lists for it, and a project it does not hold names none.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  InventoryProject,
  NamedProject,
} from "../../../../src/contract/responses.ts";

function projectListed<Project extends NamedProject>(
  inventory: readonly Project[] | undefined,
  partition: PartitionIdentity,
): Project | undefined {
  return inventory?.find(
    (candidate) =>
      candidate.tenant === partition.tenant &&
      candidate.project === partition.project,
  );
}

export function projectNamed(
  inventory: readonly NamedProject[] | undefined,
  partition: PartitionIdentity,
): string {
  return projectListed(inventory, partition)?.name ?? partition.project;
}

export function projectIcon(
  inventory: readonly InventoryProject[] | undefined,
  partition: PartitionIdentity,
): string | undefined {
  return projectListed(inventory, partition)?.icon;
}
