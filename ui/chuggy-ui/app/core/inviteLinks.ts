/**
 * A workspace's invite links, decided with no renderer: the address a made
 * link is handed out as, what a link's form may hold before it is sent and
 * what making one came to, the word and the access a link's row draws, which
 * links the reader may revoke, and what a revocation leaves to be said.
 *
 * The plane asks of a link exactly what it asks of an invitation, so a link's
 * form is the part of an invitation's that says what is granted, imported
 * from the people's module and not restated here. What a link carries is drawn
 * from the same account of what is held that a person's row is.
 *
 * THE TOKEN IS IN A MINT'S ANSWER AND NOWHERE AFTER IT. Nothing here keeps
 * one: the address is built from a token it is handed, and the list a row is
 * drawn from never carries it.
 */

import {
  accessInvitationGrantsSchema,
  accessInviteLinkEndedCode,
  type AccessInviteLink,
  type AccessInviteLinkMinted,
  type AccessTenantAbilities,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import {
  accessFailureLabel,
  projectRoleOffered,
  tenantHeldEveryProject,
  tenantHeldProjectLines,
  tenantHeldWords,
  tenantInvitationGrantsBody,
  tenantInvitationRefused,
  tenantRoleOffered,
} from "./tenantPeople.ts";
import type {
  TenantHeld,
  TenantHeldProjectLine,
  TenantInvitationGrantsForm,
  TenantInvitationRefused,
} from "./tenantPeople.ts";

/** Where a link is opened, which is the one page the console serves there. */
export const inviteRoutePath = "/invite";

/** The address a made link is handed out as, its token in the fragment, which no server is sent. */
export function inviteLinkAddress(origin: string, token: string): string {
  return `${origin}${inviteRoutePath}#${token}`;
}

/** What the Invite dialog makes: an invitation of one person, or a link. */
export const tenantInviteModes = ["Person", "Link"] as const;

export type TenantInviteMode = (typeof tenantInviteModes)[number];

/** What a made link's dialog says of the address it holds. */
export const tenantInviteLinkShownOnce = "Shown once";

export function tenantInviteLinkSendable(
  form: TenantInvitationGrantsForm,
): boolean {
  return accessInvitationGrantsSchema.safeParse(
    tenantInvitationGrantsBody(form),
  ).success;
}

/** What making a link came to: the mint's answer, or a refusal as an invitation's is drawn. */
export type TenantInviteLinkOutcome =
  | { readonly outcome: "Made"; readonly minted: AccessInviteLinkMinted }
  | TenantInvitationRefused;

export function tenantInviteLinkOutcome(
  result: ApiResult<AccessInviteLinkMinted>,
): TenantInviteLinkOutcome {
  return result.outcome === "Ok"
    ? { outcome: "Made", minted: result.value }
    : tenantInvitationRefused(result);
}

/** One link's state as the word its row draws. */
export function inviteLinkStateLabel(state: AccessInviteLink["state"]): string {
  switch (state) {
    case "Open":
      return "Open";
    case "Used":
      return "Used";
    case "Revoked":
      return "Revoked";
    case "Expired":
      return "Expired";
  }
}

/** What a link's row draws of what it carries: the workspace role's word,
 * whether that reaches every project, and a line for each project it names. */
export interface InviteLinkAccess {
  readonly held: readonly string[];
  readonly every: boolean;
  readonly lines: readonly TenantHeldProjectLine[];
}

export function inviteLinkAccess(link: AccessInviteLink): InviteLinkAccess {
  const held: TenantHeld = {
    tenantRoles: [link.role],
    hostedRuns: false,
    projects: link.projects,
  };
  return {
    held: tenantHeldWords(held),
    every: tenantHeldEveryProject(held),
    lines: tenantHeldProjectLines(
      held,
      link.projects.map((named) => named.project),
    ),
  };
}

/** Whether a row offers the reader its link's revocation: an open link, every
 * role it carries one the reader's abilities grant. */
export function inviteLinkRevocable(
  abilities: AccessTenantAbilities | undefined,
  link: AccessInviteLink,
): boolean {
  return (
    link.state === "Open" &&
    tenantRoleOffered(abilities, link.role) &&
    link.projects.every((named) =>
      named.roles.every((role) =>
        projectRoleOffered(abilities, named.project, role),
      ),
    )
  );
}

/** What a revocation is asked with before it is sent. */
export const inviteLinkRevocationQuestion = {
  question: "Revoke link",
  line: "This link will stop working.",
} as const;

/** What a revocation leaves to be said: nothing where it was done or the link
 * had already ended, and the refusal's line otherwise. */
export function inviteLinkRevocationNote(
  result: ApiResult<undefined>,
): string | undefined {
  if (result.outcome === "Ok") return undefined;
  if (
    result.outcome === "Conflict" &&
    result.code === accessInviteLinkEndedCode
  )
    return undefined;
  return accessFailureLabel(result);
}
