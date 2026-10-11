/**
 * The site's workspace links, decided with no renderer: what a link's form may
 * hold and is sent as, what making one came to, the words its list has of its
 * own, and which links the reader may revoke.
 *
 * A workspace link names nobody and no workspace, so all its form holds is
 * the box that hands account creation on, held as the workspace's own form
 * holds it, and a note only the site's list shows.
 */

import {
  accessWorkspaceLinkCreationSchema,
  accessWorkspaceLinkNoteCharsMax,
  accessWorkspaceLinkNoteSchema,
  type AccessInviteLinkMinted,
  type AccessSiteAbilities,
  type AccessWorkspaceLink,
  type AccessWorkspaceLinkCreation,
} from "../../../../src/contract/accessPlane.ts";
import { textCodePointsCount } from "../../../../src/contract/http.ts";

import type { ApiResult } from "./apiRequest.ts";
import { projectNameLengthFault } from "./projectCreation.ts";
import { siteWorkspaceRefusal } from "./siteWorkspaces.ts";

/** The words the site's list of links has that a workspace's does not. */
export const siteWorkspaceLinkWords = {
  note: "Note",
  workspace: "Workspace",
} as const;

/** What a note that runs past one line is refused as. */
export const siteWorkspaceLinkNoteLinesFault = "One line";

/** Why a note cannot be sent, or nothing while it is empty, which only leaves it out. */
export function siteWorkspaceLinkNoteFault(note: string): string | undefined {
  if (note === "" || accessWorkspaceLinkNoteSchema.safeParse(note).success)
    return undefined;
  return textCodePointsCount(note) > accessWorkspaceLinkNoteCharsMax
    ? projectNameLengthFault
    : siteWorkspaceLinkNoteLinesFault;
}

/** What a link is sent as: the box as the form holds it, and the note only where one was typed. */
export function siteWorkspaceLinkBody(
  createAccounts: boolean,
  note: string,
): AccessWorkspaceLinkCreation {
  return note === "" ? { createAccounts } : { createAccounts, note };
}

export function siteWorkspaceLinkSendable(
  creation: AccessWorkspaceLinkCreation,
): boolean {
  return accessWorkspaceLinkCreationSchema.safeParse(creation).success;
}

/** What making a link came to: the mint's answer, or the dialog's one line. */
export type SiteWorkspaceLinkOutcome =
  | { readonly outcome: "Made"; readonly minted: AccessInviteLinkMinted }
  | { readonly outcome: "Refused"; readonly line: string };

export function siteWorkspaceLinkOutcome(
  result: ApiResult<AccessInviteLinkMinted>,
): SiteWorkspaceLinkOutcome {
  return result.outcome === "Ok"
    ? { outcome: "Made", minted: result.value }
    : { outcome: "Refused", line: siteWorkspaceRefusal(result) };
}

/** Whether a row offers the reader its link's revocation: an open link, and
 * the reader granted what making it asked. */
export function siteWorkspaceLinkRevocable(
  abilities: AccessSiteAbilities,
  link: AccessWorkspaceLink,
): boolean {
  return (
    link.state === "Open" &&
    abilities.createTenant &&
    (!link.createAccounts || abilities.manageAuthorities)
  );
}
