/**
 * A workspace's invite links, decided with no renderer: the address a made
 * link is handed out as, what a link's form may hold before it is sent, the
 * word and the access a link's row draws, which links the reader may revoke,
 * and what a revocation leaves to be said.
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
  type AccessTenantAbilities,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";
import {
  accessFailureLabel,
  projectRoleOffered,
  tenantHeldEveryProject,
  tenantHeldProjectLines,
  tenantHeldWords,
  tenantInvitationGrantsBody,
  tenantRoleOffered,
} from "./tenantPeople.ts";
import type {
  TenantHeld,
  TenantHeldProjectLine,
  TenantInvitationGrantsForm,
} from "./tenantPeople.ts";

/** Where a link is opened, which is the one page the console serves there. */
export const inviteRoutePath = "/invite";

/** The address a made link is handed out as, its token in the fragment, which no server is sent. */
export function inviteLinkAddress(origin: string, token: string): string {
  return `${origin}${inviteRoutePath}#${token}`;
}

/** What a dialog that invites makes: an invitation of one person, or a link. */
export const inviteModes = ["Person", "Link"] as const;

export type InviteMode = (typeof inviteModes)[number];

/** What the choice between the two is labelled. */
export const inviteModesLabel: Copy = { id: "settings-invitation-mode" };

/** One of the two as its choice is labelled. */
export function inviteModeLabel(mode: InviteMode): Copy {
  switch (mode) {
    case "Person":
      return { id: "settings-invitation-mode-person" };
    case "Link":
      return { id: "settings-invitation-mode-link" };
  }
}

/** What sending a dialog's form is called, and while it is unanswered. */
export interface InviteSendWords {
  readonly idle: Copy;
  readonly busy: Copy;
}

/** What making a link is called on the action that sends it, and while it is unanswered. */
export const inviteLinkSendWords: InviteSendWords = {
  idle: { id: "settings-invite-link-create" },
  busy: { id: "settings-creating" },
};

/** What a made link's dialog says of the address it holds. */
export const tenantInviteLinkShownOnce: Copy = {
  id: "settings-invite-link-shown-once",
};

export function tenantInviteLinkSendable(
  form: TenantInvitationGrantsForm,
): boolean {
  return accessInvitationGrantsSchema.safeParse(
    tenantInvitationGrantsBody(form),
  ).success;
}

/** One link's state as the word its row draws. */
export function inviteLinkStateLabel(state: AccessInviteLink["state"]): Copy {
  switch (state) {
    case "Open":
      return { id: "settings-invite-link-open" };
    case "Used":
      return { id: "settings-invite-link-used" };
    case "Revoked":
      return { id: "settings-invite-link-revoked" };
    case "Expired":
      return { id: "settings-invite-link-expired" };
  }
}

/** What a link's row draws of what it carries: the workspace role's word,
 * whether that reaches every project, and a line for each project it names. */
export interface InviteLinkAccess {
  readonly held: readonly Copy[];
  readonly every: boolean;
  readonly lines: readonly TenantHeldProjectLine[];
}

export function inviteLinkAccess(link: AccessInviteLink): InviteLinkAccess {
  const held: TenantHeld = {
    tenantRoles: [link.role],
    hostedRuns: false,
    personalRunners: false,
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

/** The words of the section a workspace's links are listed in. */
export const inviteLinksWords = {
  heading: { id: "settings-invite-links" },
  access: { id: "settings-invite-links-access" },
  status: { id: "settings-invite-links-status" },
  usedBy: { id: "settings-invite-links-used-by" },
  madeBy: { id: "settings-invite-links-made-by" },
  expires: { id: "settings-invite-links-expires" },
  revoke: { id: "settings-invite-links-revoke" },
} as const satisfies Readonly<Record<string, Copy>>;

/** What a revocation is asked with before it is sent. */
export const inviteLinkRevocationQuestion = {
  question: { id: "settings-invite-links-revoke-question" },
  line: { id: "settings-invite-links-revoke-line" },
} as const satisfies Readonly<Record<string, Copy>>;

/** What a revocation leaves to be said: nothing where it was done or the link
 * had already ended, and the refusal's line otherwise. */
export function inviteLinkRevocationNote(
  result: ApiResult<undefined>,
): Copy | undefined {
  if (result.outcome === "Ok") return undefined;
  if (
    result.outcome === "Conflict" &&
    result.code === accessInviteLinkEndedCode
  )
    return undefined;
  return accessFailureLabel(result);
}
