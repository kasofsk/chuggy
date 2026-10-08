/**
 * The site inviting a person into a workspace of their own: what the form
 * holds, what each field may hold before anything is sent, what is sent, and
 * what one answer came to, as the one line the form draws.
 *
 * Every field rule is the access contract's own schema, so this only spares
 * the reader a round trip to be told what the plane would refuse anyway. The
 * form holds exactly what the plane is sent, so nothing is derived between the
 * two but the box: handing account creation on is the reader's only where
 * they manage the site's permissions, and it is sent unchecked wherever they
 * do not, whatever the form held.
 */

import {
  accessNotPermittedCode,
  accessOwnedTenantSchema,
  accessOwnerInvitationSchema,
  accessTenantTakenCode,
  type AccessOwnerInvitation,
  type AccessOwnerInvited,
  type AccessSiteAbilities,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import {
  projectCreationNameFault,
  tenantNameReservedFault,
} from "./projectCreation.ts";
import { accessFailureLabel } from "./tenantPeople.ts";

export type SiteWorkspaceForm = AccessOwnerInvitation;

/** What the page draws for a reader who may make no workspace. */
export const siteWorkspacesWithheld = "A site admin creates workspaces";

/** Whether the reader is drawn the form, which a reader whose abilities were
 * not answered is not. */
export function siteWorkspaceOffered(
  abilities: AccessSiteAbilities | undefined,
): boolean {
  return abilities?.createTenant ?? false;
}

/** The form as it starts and as a creation leaves it: nothing typed, and the
 * box checked where the reader may hand account creation on. */
export function siteWorkspaceBlank(
  abilities: AccessSiteAbilities,
): SiteWorkspaceForm {
  return {
    tenant: "",
    github: "",
    email: "",
    createAccounts: abilities.manageAuthorities,
  };
}

/** The form as it is drawn and sent under the abilities now read. */
export function siteWorkspaceHeld(
  form: SiteWorkspaceForm,
  abilities: AccessSiteAbilities,
): SiteWorkspaceForm {
  return {
    ...form,
    createAccounts: form.createAccounts && abilities.manageAuthorities,
  };
}

/** Why one name cannot be sent, in the lines a project's creation draws, or
 * nothing while it is empty. */
export function siteWorkspaceNameFault(name: string): string | undefined {
  const shape = projectCreationNameFault(name);
  if (name === "" || shape !== undefined) return shape;
  return accessOwnedTenantSchema.safeParse(name).success
    ? undefined
    : tenantNameReservedFault;
}

export function siteWorkspaceSendable(form: SiteWorkspaceForm): boolean {
  return accessOwnerInvitationSchema.safeParse(form).success;
}

/** What one creation came to, as the line the form draws for it. A `200`
 * replay is a creation too, because the workspace it names is the person's. */
export interface SiteWorkspaceOutcome {
  readonly outcome: "Created" | "Refused";
  readonly line: string;
}

function siteWorkspaceRefusal(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Conflict":
    case "Rejected":
      if (failure.code === accessTenantTakenCode) return "Name taken";
      if (failure.code === accessNotPermittedCode) return "Not permitted";
      return accessFailureLabel(failure);
    case "Unauthenticated":
    case "Absent":
    case "Retryable":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return accessFailureLabel(failure);
  }
}

export function siteWorkspaceOutcome(
  sent: SiteWorkspaceForm,
  result: ApiResult<AccessOwnerInvited>,
): SiteWorkspaceOutcome {
  if (result.outcome !== "Ok")
    return { outcome: "Refused", line: siteWorkspaceRefusal(result) };
  return {
    outcome: "Created",
    line: `${result.value.tenant} created · ${sent.github} signs in with GitHub`,
  };
}
