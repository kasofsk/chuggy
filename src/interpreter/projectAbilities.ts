/**
 * What a reader of a project may do in it, answered by the question each of
 * its doors asks, so a control is drawn for the caller it serves and no other.
 *
 * AN OUTAGE IS THROWN AND NEVER RETURNED. Any one of the questions the
 * authority cannot answer rejects the whole read: a `false` in its place would
 * hide a control from someone who holds it.
 */

import type { ProjectAbilitiesResponse } from "../contract/responses.ts";
import type { AuthorizedResult } from "./authorizedProject.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** The kind each ability asks, exhaustive over the answer's fields, so a field added without a kind is a compile error. */
export const projectAbilityKinds: Readonly<
  Record<keyof ProjectAbilitiesResponse, ProjectAccessKind>
> = {
  mutate: "Mutate",
  dispatch: "DispatchTicket",
  manageSelector: "ManageProjectSelector",
  administer: "Administer",
};

/**
 * Whether the caller may press each of a project's doors, asked only of a
 * caller who may read it. These kinds are the ones a door of the API that a
 * person presses asks: the grant kinds and `ManageProjectAuthorities` are the
 * access plane's doors and its own abilities answer them, and `Execute` and
 * `ProposeDispatch` are asked of no door a person presses.
 */
export async function projectAbilities(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<AuthorizedResult<ProjectAbilitiesResponse>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const held = async (kind: ProjectAccessKind) =>
    (await access.authorize(principal, partition, kind)) !== undefined;
  const [mutate, dispatch, manageSelector, administer] = await Promise.all([
    held(projectAbilityKinds.mutate),
    held(projectAbilityKinds.dispatch),
    held(projectAbilityKinds.manageSelector),
    held(projectAbilityKinds.administer),
  ]);
  return {
    result: "Authorized",
    value: { mutate, dispatch, manageSelector, administer },
  };
}
