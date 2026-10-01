/**
 * Proving that a person controls a forge account from what the forge answered
 * under their authorization: an account by its number, never its renameable
 * login, and an organization by an active owner. The token never reaches here.
 */

import { assertNever } from "../domain/assertNever.ts";
import type {
  ForgeAccount,
  ForgeAccountId,
  ForgeInstallationId,
} from "./forgeInstallation.ts";

/** What the console's authorization came back with, which the forge redeems once. */
export interface ForgeAuthorizationGrant {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

/** The person the forge authorized. */
export interface ForgeUser {
  readonly id: ForgeAccountId;
  readonly login: ForgeAccount;
}

/** What the forge answered about the person's membership of one organization. */
export type ForgeMembershipRead =
  | {
      readonly read: "Membership";
      readonly organizationId: ForgeAccountId;
      readonly active: boolean;
      readonly owner: boolean;
    }
  | { readonly read: "Refused" }
  | { readonly read: "Unavailable" };

interface ForgeUserInstallationOf {
  readonly installationId: ForgeInstallationId;
  readonly account: ForgeAccount;
  readonly accountId: ForgeAccountId;
}

/** One installation of the portal app the person reaches, an organization's carrying their membership of it. */
export type ForgeUserInstallation =
  | (ForgeUserInstallationOf & { readonly accountKind: "User" })
  | (ForgeUserInstallationOf & {
      readonly accountKind: "Organization";
      readonly membership: ForgeMembershipRead;
    });

/**
 * What redeeming one grant came to, `truncated` saying the person reaches more
 * installations than were read. `Unavailable` may leave the grant unredeemed,
 * so it may be offered again; `Spent` redeemed it and then could not read what
 * it reaches, so only a new authorization can.
 */
export type ForgeUserAuthorized =
  | {
      readonly authorized: "User";
      readonly user: ForgeUser;
      readonly installations: readonly ForgeUserInstallation[];
      readonly truncated: boolean;
    }
  | { readonly authorized: "Refused" }
  | { readonly authorized: "Unavailable" }
  | { readonly authorized: "Spent" };

/** Redeems one grant and reads what it reaches, dropping the token it was redeemed for. */
export interface ForgeUserAuthorization {
  authorized(grant: ForgeAuthorizationGrant): Promise<ForgeUserAuthorized>;
}

/** Whether one reachable account is the person's, and the declaration its type derives from. */
export const allForgeAccountProofs = [
  "Proven",
  "NotOwner",
  "Unavailable",
] as const;

export type ForgeAccountProof = (typeof allForgeAccountProofs)[number];

/** What claiming one app on a proven account came to, and the declaration its type derives from. */
export const allForgeAppClaims = [
  "Claimed",
  "AlreadyClaimed",
  "Missing",
  "Unavailable",
] as const;

export type ForgeAppClaim = (typeof allForgeAppClaims)[number];

/** Whether the person owns the account one installation stands on. */
export function forgeAccountProof(
  user: ForgeUser,
  installation: ForgeUserInstallation,
): ForgeAccountProof {
  if (installation.accountKind === "User")
    return installation.accountId === user.id ? "Proven" : "NotOwner";
  const membership = installation.membership;
  switch (membership.read) {
    case "Membership":
      return membership.organizationId === installation.accountId &&
        membership.active &&
        membership.owner
        ? "Proven"
        : "NotOwner";
    case "Refused":
      return "NotOwner";
    case "Unavailable":
      return "Unavailable";
    default:
      return assertNever(membership);
  }
}
