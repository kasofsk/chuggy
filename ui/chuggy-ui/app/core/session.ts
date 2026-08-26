/**
 * What a signed-in session is, and when it has to be renewed.
 *
 * The access token is held in memory only; the refresh token is what a
 * deployment persists, so a reload or a restart keeps the session without ever
 * writing an access token down. Every decision here is a function of the clock
 * the caller passes, so the scheduling and the failure budget are testable
 * without waiting.
 */

import {
  sessionRefreshFailuresMax,
  sessionRefreshSecondsBefore,
} from "./authorization.ts";
import type { IssuedTokens } from "./authorization.ts";

export interface SessionHeld {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresAtMs: number;
  readonly refreshFailures: number;
}

export type SessionState =
  | { readonly state: "SignedOut" }
  | { readonly state: "Held"; readonly held: SessionHeld };

export const sessionSignedOut: SessionState = { state: "SignedOut" };

/**
 * An issuer that rotates no refresh token sends none back, and the one already
 * held stays the one that renews the session.
 */
export function sessionFromTokens(
  nowMs: number,
  tokens: IssuedTokens,
  heldRefreshToken?: string,
): SessionState {
  return {
    state: "Held",
    held: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? heldRefreshToken,
      expiresAtMs: nowMs + tokens.expiresInSeconds * 1_000,
      refreshFailures: 0,
    },
  };
}

/** A session restored from a persisted refresh token holds no access token yet. */
export function sessionFromRefreshToken(refreshToken: string): SessionState {
  return {
    state: "Held",
    held: {
      accessToken: "",
      refreshToken,
      expiresAtMs: 0,
      refreshFailures: 0,
    },
  };
}

export function sessionRefreshDueAtMs(held: SessionHeld): number {
  return held.expiresAtMs - sessionRefreshSecondsBefore * 1_000;
}

export function sessionNeedsRefresh(nowMs: number, held: SessionHeld): boolean {
  return nowMs >= sessionRefreshDueAtMs(held);
}

export function sessionCanRefresh(held: SessionHeld): boolean {
  return (
    held.refreshToken !== undefined &&
    held.refreshFailures < sessionRefreshFailuresMax
  );
}

/** A budget, so an issuer that keeps declining ends the session once. */
export function sessionAfterRefreshFailure(held: SessionHeld): SessionState {
  const failed = { ...held, refreshFailures: held.refreshFailures + 1 };
  return sessionCanRefresh(failed)
    ? { state: "Held", held: failed }
    : sessionSignedOut;
}

/** The token a request may carry, or nothing when one has to be fetched first. */
export function sessionUsableAccessToken(
  nowMs: number,
  state: SessionState,
): string | undefined {
  if (state.state === "SignedOut") return undefined;
  if (state.held.accessToken === "") return undefined;
  return sessionNeedsRefresh(nowMs, state.held)
    ? undefined
    : state.held.accessToken;
}
