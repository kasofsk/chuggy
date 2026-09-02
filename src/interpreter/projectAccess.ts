/**
 * What a principal may do in one project, and the port that answers it.
 *
 * IT STANDS APART FROM THE BOUNDARY THAT USES IT because every project-scoped
 * service takes it, and several of those are composed into the boundary itself.
 * Declared inside the boundary, a service that gates its own reads would import
 * the module that imports it, and the layer each of them belongs to would stop
 * being answerable.
 *
 * AUTHORIZATION ANSWERS WITH THE AUDITED AUTHORITY RATHER THAN A BOOLEAN, so no
 * transport can authorize one subject and record another.
 */

import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";

/** Every project access kind, and the declaration `ProjectAccessKind` derives from, so narrowing a supplied kind has one list to check. */
export const allProjectAccessKinds = [
  "Read",
  "Mutate",
  "DispatchTicket",
  "ProposeDispatch",
  "ManageProjectSelector",
] as const;

export type ProjectAccessKind = (typeof allProjectAccessKinds)[number];

/** Narrows text to the access kind it names, refusing anything `authorize_project_access` would not know. */
export function asProjectAccessKind(value: string): ProjectAccessKind {
  const kind = allProjectAccessKinds.find((known) => known === value);
  if (kind === undefined)
    throw new RangeError(`project access kind: ${value} is not a known kind`);
  return kind;
}

/** Current project access and the non-reassignable authority it resolves to. */
export interface ProjectAccess {
  authorize(
    principal: Principal,
    partition: Partition,
    access: ProjectAccessKind,
  ): Promise<Authority | undefined>;
}
