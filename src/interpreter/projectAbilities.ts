/**
 * What a reader of a project may do in it, answered by the question each of
 * its doors asks, so a control is drawn for the caller it serves and no other.
 *
 * AN OUTAGE IS THROWN AND NEVER RETURNED. Any one of the questions the
 * authority cannot answer rejects the whole read: a `false` in its place would
 * hide a control from someone who holds it.
 *
 * AN ACCESS TOKEN NARROWS WHAT ITS MAKER MAY DO, never widens it. Under a
 * `Read` token every ability is false; under any token, so are making tokens
 * and merging proposals, which no token may do whatever its maker holds.
 */

import type { AccessTokenAccess } from "../contract/accessToken.ts";
import type { ProjectAbilitiesResponse } from "../contract/responses.ts";
import type { AuthorizedResult } from "./authorizedProject.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** The kind each ability asks, exhaustive over the answer's fields but the reader's principal, so a field added without a kind is a compile error. */
export const projectAbilityKinds: Readonly<
  Record<
    Exclude<keyof ProjectAbilitiesResponse, "principal">,
    ProjectAccessKind
  >
> = {
  mutate: "Mutate",
  dispatch: "DispatchTicket",
  manageSelector: "ManageProjectSelector",
  overrideTicketConfig: "OverrideTicketConfig",
  skipPlannedEvaluations: "SkipPlannedEvaluations",
  mergeProposals: "MergeProposals",
  makeAccessTokens: "MakeAccessTokens",
  administer: "Administer",
  writeEpic: "Mutate",
};

/**
 * Whether the caller may press each of a project's doors, asked only of a
 * caller who may read it. These kinds are the ones a door of the API that a
 * person presses asks: the grant kinds and `ManageProjectAuthorities` are the
 * access plane's doors and its own abilities answer them, and `Execute` is
 * asked of no door a person presses.
 */
export async function projectAbilities(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
  viaToken?: AccessTokenAccess,
): Promise<AuthorizedResult<ProjectAbilitiesResponse>> {
  const held = await projectAbilitiesHeld(access, principal, partition);
  if (held.result === "NotFound" || viaToken === undefined) return held;
  return {
    result: "Authorized",
    value: projectAbilitiesThroughToken(held.value, viaToken),
  };
}

/** What a token of `viaToken` may do of what its maker holds. */
function projectAbilitiesThroughToken(
  held: ProjectAbilitiesResponse,
  viaToken: AccessTokenAccess,
): ProjectAbilitiesResponse {
  const may = (value: boolean): boolean => viaToken === "Write" && value;
  return {
    principal: held.principal,
    mutate: may(held.mutate),
    dispatch: may(held.dispatch),
    manageSelector: may(held.manageSelector),
    overrideTicketConfig: may(held.overrideTicketConfig),
    skipPlannedEvaluations: may(held.skipPlannedEvaluations),
    mergeProposals: false,
    makeAccessTokens: false,
    administer: may(held.administer),
    writeEpic: may(held.writeEpic),
  };
}

/** Whether the caller may press each of the project's doors, as their own permits answer. */
async function projectAbilitiesHeld(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<AuthorizedResult<ProjectAbilitiesResponse>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const held = async (kind: ProjectAccessKind) =>
    (await access.authorize(principal, partition, kind)) !== undefined;
  const [
    mutate,
    dispatch,
    manageSelector,
    overrideTicketConfig,
    skipPlannedEvaluations,
    mergeProposals,
    makeAccessTokens,
    administer,
    writeEpic,
  ] = await Promise.all([
    held(projectAbilityKinds.mutate),
    held(projectAbilityKinds.dispatch),
    held(projectAbilityKinds.manageSelector),
    held(projectAbilityKinds.overrideTicketConfig),
    held(projectAbilityKinds.skipPlannedEvaluations),
    held(projectAbilityKinds.mergeProposals),
    held(projectAbilityKinds.makeAccessTokens),
    held(projectAbilityKinds.administer),
    held(projectAbilityKinds.writeEpic),
  ]);
  return {
    result: "Authorized",
    value: {
      principal,
      mutate,
      dispatch,
      manageSelector,
      overrideTicketConfig,
      skipPlannedEvaluations,
      mergeProposals,
      makeAccessTokens,
      administer,
      writeEpic,
    },
  };
}
