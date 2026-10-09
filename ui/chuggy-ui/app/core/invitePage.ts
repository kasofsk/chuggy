/**
 * The page an invite link is opened at, decided with no renderer: what a
 * fragment or a cookie holds of a token, the cookie that carries the token
 * across a sign-in, which card the page draws, and what a redemption came to.
 *
 * THE FRAGMENT IS ANYONE'S TO WRITE, so nothing read from it is trusted to be
 * a token the plane made: it is bounded where it is read, and percent-encoded
 * where it is written into a cookie, which leaves a minted token as it is and
 * keeps any other text from being read as an attribute.
 *
 * Every decision says whether the cookie is cleared, so the page performs what
 * is decided here and decides nothing of its own.
 */

import {
  accessInviteLinkTokenCharsMax,
  type AccessInviteLinkRedeemed,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import { accessFailureLabel } from "./tenantPeople.ts";

/** The cookie a token crosses a sign-in in. The deployment's sign-in hook
 * reads it by this name, to admit a person the link invites. */
export const inviteCookieName = "chuggy_invite";

/** How long the cookie outlives the press of `Sign in`: a sign-in's length, and not a link's. */
export const inviteCookieMaxAgeSeconds = 30 * 60;

/** Where the page sends a reader it has nothing to draw for. */
export const inviteElsewherePath = "/";

/** A token as a fragment or a cookie holds it, none where that is empty or
 * longer than a redemption is read with. */
export function inviteTokenRead(held: string): string | undefined {
  return held === "" || held.length > accessInviteLinkTokenCharsMax
    ? undefined
    : held;
}

function inviteCookieLine(
  value: string,
  maxAgeSeconds: number,
  domain: string | undefined,
): string {
  return [
    `${inviteCookieName}=${value}`,
    "Path=/",
    `Max-Age=${String(maxAgeSeconds)}`,
    "Secure",
    "SameSite=Lax",
    ...(domain === undefined ? [] : [`Domain=${domain}`]),
  ].join("; ");
}

/** The cookie as the browser is handed it at the press of `Sign in`, the
 * console host's own where the deployment names no domain. */
export function inviteCookieWritten(
  token: string,
  domain: string | undefined,
): string {
  return inviteCookieLine(
    encodeURIComponent(token),
    inviteCookieMaxAgeSeconds,
    domain,
  );
}

/** The same cookie ended, which a browser matches by its path and its domain. */
export function inviteCookieCleared(domain: string | undefined): string {
  return inviteCookieLine("", 0, domain);
}

/** The token among the cookies the browser reads back, where there is one. */
export function inviteCookieToken(cookies: string): string | undefined {
  const named = `${inviteCookieName}=`;
  const held = cookies
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(named));
  if (held === undefined) return undefined;
  try {
    return inviteTokenRead(decodeURIComponent(held.slice(named.length)));
  } catch {
    return undefined;
  }
}

/** Whether the sign-in service sent this address back: it returns a person it
 * would not register with the flow it refused them in. */
export function inviteFlowCarried(search: string): boolean {
  return new URLSearchParams(search).has("flow");
}

/** What the page is opened with. */
export interface InviteArrival {
  readonly flow: boolean;
  readonly signedIn: boolean;
  /** The token taken from the fragment, where this page was opened with one. */
  readonly tokenKept: string | undefined;
  readonly cookies: string;
}

/** What the page draws, and whether opening it clears the cookie. */
export type InvitePage = { readonly cookieCleared: boolean } & (
  | { readonly page: "Needed" | "Elsewhere" | "SignedOut" }
  | { readonly page: "Invited" | "Redeeming"; readonly token: string }
);

/**
 * The first that matches: a person the sign-in service would not register,
 * whose cookie is cleared so that signing in again does not ask it the same;
 * no token, which is somewhere else for a reader and the ordinary card for
 * anyone else; a token and no session, which waits for a press; and a token
 * and a session, which redeems it.
 */
export function invitePageDecided(arrival: InviteArrival): InvitePage {
  if (arrival.flow) return { page: "Needed", cookieCleared: true };
  const token = arrival.tokenKept ?? inviteCookieToken(arrival.cookies);
  if (token === undefined)
    return {
      page: arrival.signedIn ? "Elsewhere" : "SignedOut",
      cookieCleared: false,
    };
  return {
    page: arrival.signedIn ? "Redeeming" : "Invited",
    token,
    cookieCleared: false,
  };
}

/** The words of the page's cards. */
export const invitePageWords = {
  needed: "Invite needed",
  invited: "Invited",
  redeeming: "Joining…",
  notValid: "Link not valid",
  signIn: "Sign in",
  open: "Open chuggy",
  retry: "Retry",
} as const;

/** What a redemption came to, and whether it clears the cookie. */
export type InviteRedemption =
  | {
      readonly outcome: "Redeemed";
      readonly path: string;
      readonly cookieCleared: true;
    }
  | { readonly outcome: "NotValid"; readonly cookieCleared: true }
  | {
      readonly outcome: "Failed";
      readonly line: string;
      readonly cookieCleared: false;
    };

/**
 * A link the plane took sends its reader to the first project it granted, or
 * to the landing page where it granted none. One the plane does not know, or
 * a request it will not read, is a link no retry mends and so clears the
 * cookie, which any other failure keeps for the retry.
 */
export function inviteRedemption(
  result: ApiResult<AccessInviteLinkRedeemed>,
): InviteRedemption {
  switch (result.outcome) {
    case "Ok": {
      const project = result.value.projects[0]?.project;
      return {
        outcome: "Redeemed",
        path:
          project === undefined
            ? inviteElsewherePath
            : `/${encodeURIComponent(result.value.tenant)}/${encodeURIComponent(project)}`,
        cookieCleared: true,
      };
    }
    case "Absent":
    case "Rejected":
      return { outcome: "NotValid", cookieCleared: true };
    case "Unauthenticated":
    case "Conflict":
    case "Retryable":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return {
        outcome: "Failed",
        line: accessFailureLabel(result),
        cookieCleared: false,
      };
  }
}
