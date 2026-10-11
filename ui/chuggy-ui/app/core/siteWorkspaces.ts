/**
 * The site's workspaces as their page draws them, and the site inviting a
 * person into a workspace of their own: what a row says of a workspace, what
 * the form holds, what each field may hold before anything is sent, what is
 * sent, and what one answer came to, as the one line it leaves.
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
  type AccessSiteTenant,
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

/** Whether the reader is drawn the list and its form, which a reader whose
 * abilities were not answered is not. */
export function siteWorkspaceOffered(
  abilities: AccessSiteAbilities | undefined,
): boolean {
  return abilities?.createTenant ?? false;
}

/** How many workspaces the table under this line holds. */
export function siteWorkspacesCountLine(count: number): string {
  return count === 1 ? "1 workspace" : `${String(count)} workspaces`;
}

/** The administrators a workspace's answer counts and does not name: a line
 * after those it names, the count alone where it names none, nothing at zero. */
export function siteWorkspaceUnnamedLine(
  listed: Pick<AccessSiteTenant, "administrators" | "unnamed">,
): string | undefined {
  if (listed.unnamed === 0) return undefined;
  return listed.administrators.length === 0
    ? `${String(listed.unnamed)} unnamed`
    : `+${String(listed.unnamed)} more`;
}

/** The box that hands account creation on with a workspace, as its form and a link's row word it. */
export const siteWorkspaceCreateAccountsLabel = "Can invite new people";

/** Whom a workspace's admins may invite, as its row says it. */
export function siteWorkspaceInvitesLabel(createAccounts: boolean): string {
  return createAccounts ? "New people" : "Existing accounts";
}

/** The form as every opening of the dialog starts it: nothing typed, and the
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

/** What a name something already holds is refused as. */
export const siteWorkspaceNameTaken = "Name taken";

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

/** What one creation came to, as the line it leaves. A `200` replay is a
 * creation too, because the workspace it names is the person's. */
export interface SiteWorkspaceOutcome {
  readonly outcome: "Created" | "Refused";
  readonly line: string;
}

/** What the dialog's one line says of an answer that made nothing. */
export function siteWorkspaceRefusal(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Conflict":
    case "Rejected":
      if (failure.code === accessTenantTakenCode) return siteWorkspaceNameTaken;
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
