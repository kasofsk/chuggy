/**
 * What the console calls a project to a reader: the name it was given, as the
 * inventory lists it. A project the inventory does not hold, or not yet, is
 * called by its address, which is what its name is read as where none was
 * given. An address in a link or a route stays the address.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { NamedProject } from "../../../../src/contract/responses.ts";

export function projectNamed(
  inventory: readonly NamedProject[] | undefined,
  partition: PartitionIdentity,
): string {
  return (
    inventory?.find(
      (candidate) =>
        candidate.tenant === partition.tenant &&
        candidate.project === partition.project,
    )?.name ?? partition.project
  );
}
