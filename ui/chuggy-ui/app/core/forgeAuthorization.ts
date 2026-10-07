/**
 * Connecting forge accounts by proof: the authorization this console sends a
 * person to the forge for, and the word they come back with. The state and
 * verifier are held in tab storage and taken once by the callback.
 */

import type {
  ForgeAuthorizationClientResponse,
  ForgeAuthorizationResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import type { ForgeReturnWord } from "./forgeReturn.ts";
import {
  pkceChallengeFromVerifier,
  pkceChallengeMethod,
  pkceVerifierBytesCount,
  pkceVerifierFromBytes,
} from "./pkce.ts";
import type { PkceDigestPort } from "./pkce.ts";
import type { KeyValuePort } from "./sessionHolder.ts";

/** Where the transaction is held, which is `sessionStorage` and not the URL. */
export const forgeAuthorizeTransactionKey = "chuggy.forgeAuthorization";

/**
 * The address the forge returns an authorization to, which an operator
 * registers as the portal app's callback URL.
 */
export const forgeCallbackRoutePath = "/forge/github/callback";

/** Where the person goes, and comes back to, and what redeems the code. */
export interface ForgeAuthorizeTarget {
  readonly tenant: string;
  readonly returnPath: string;
}

/** What the console remembers while the person is away at the forge. */
export interface ForgeAuthorizeTransaction extends ForgeAuthorizeTarget {
  readonly state: string;
  readonly verifier: string;
}

export interface ForgeAuthorizePorts {
  readonly drawBytes: (count: number) => Uint8Array;
  readonly digest: PkceDigestPort;
  readonly transient: KeyValuePort;
}

/** The callback address on this console's own origin. */
export function forgeCallbackRedirectUri(origin: string): string {
  return `${origin}${forgeCallbackRoutePath}`;
}

/** Stores a fresh transaction and answers the forge address to send the person to. */
export async function forgeAuthorizeBegin(
  ports: ForgeAuthorizePorts,
  client: ForgeAuthorizationClientResponse,
  origin: string,
  target: ForgeAuthorizeTarget,
): Promise<string> {
  const verifier = pkceVerifierFromBytes(
    ports.drawBytes(pkceVerifierBytesCount),
  );
  const state = base64urlFromBytes(ports.drawBytes(pkceVerifierBytesCount));
  const challenge = await pkceChallengeFromVerifier(ports.digest, verifier);
  const transaction: ForgeAuthorizeTransaction = { ...target, state, verifier };
  ports.transient.write(
    forgeAuthorizeTransactionKey,
    JSON.stringify(transaction),
  );
  const url = new URL(client.authorizeUrl);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", forgeCallbackRedirectUri(origin));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", pkceChallengeMethod);
  return url.toString();
}

/** Read once and removed, so a callback opened twice matches nothing the second time. */
export function forgeAuthorizeTake(
  store: KeyValuePort,
): ForgeAuthorizeTransaction | undefined {
  const stored = store.read(forgeAuthorizeTransactionKey);
  store.remove(forgeAuthorizeTransactionKey);
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const fields = parsed as Record<string, unknown>;
    const { state, verifier, tenant, returnPath } = fields;
    if (typeof state !== "string" || typeof verifier !== "string")
      return undefined;
    if (typeof tenant !== "string" || typeof returnPath !== "string")
      return undefined;
    return { state, verifier, tenant, returnPath };
  } catch {
    return undefined;
  }
}

export interface ForgeCallbackQuery {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly error: string | undefined;
}

function forgeCallbackText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** What the forge put on the address, under the forge's own names. */
export function forgeCallbackQueryOf(
  search: Readonly<Record<string, unknown>>,
): ForgeCallbackQuery {
  return {
    code: forgeCallbackText(search["code"]),
    state: forgeCallbackText(search["state"]),
    error: forgeCallbackText(search["error"]),
  };
}

export type ForgeCallbackDecision =
  | {
      readonly decision: "Redeem";
      readonly transaction: ForgeAuthorizeTransaction;
      readonly code: string;
    }
  | {
      readonly decision: "Declined";
      readonly transaction: ForgeAuthorizeTransaction;
    }
  | { readonly decision: "Unexpected" };

/** A return whose state is not the one this tab stored redeems nothing. */
export function forgeCallbackDecision(
  query: ForgeCallbackQuery,
  taken: ForgeAuthorizeTransaction | undefined,
): ForgeCallbackDecision {
  if (taken === undefined) return { decision: "Unexpected" };
  if (query.state === undefined || query.state !== taken.state)
    return { decision: "Unexpected" };
  if (query.error !== undefined)
    return { decision: "Declined", transaction: taken };
  if (query.code === undefined) return { decision: "Unexpected" };
  return { decision: "Redeem", transaction: taken, code: query.code };
}

/** What this console says where the person declined at the forge. */
export const forgeAuthorizationDeclined: ForgeReturnWord = {
  standing: "Unfinished",
  status: "Declined",
};

/** What this console says where the forge spent the code before the api could read what it reaches. */
export const forgeAuthorizationSpent = "Start again";

function forgeAuthorizationWordFailed(status: string): ForgeReturnWord {
  return { standing: "Failed", status };
}

/**
 * What an answered authorization says, which is nothing where it connected an
 * account and read every one it reaches. An account the forge could not answer
 * for may be proven by asking again, so it is not a reason to install anything.
 */
function forgeAuthorizationWordAnswered(
  answered: ForgeAuthorizationResponse,
): ForgeReturnWord | undefined {
  const uninstalled = answered.accounts.every(
    (account) => account.proof === "NotOwner",
  );
  const standing = uninstalled ? "Uninstalled" : "Unfinished";
  if (answered.truncated) return { standing, status: "Partial" };
  if (uninstalled) return { standing, status: "Not installed" };
  if (answered.accounts.some((account) => account.proof === "Unavailable"))
    return { standing, status: "Unavailable" };
  return undefined;
}

/**
 * What redeeming came to, as the word the person returns with.
 * `ForgeNotConfigured` and a tenant the caller does not administer are both a
 * `404`, which the console reads without its code, so both are one word.
 */
export function forgeAuthorizationWord(
  result: ApiResult<ForgeAuthorizationResponse>,
): ForgeReturnWord | undefined {
  switch (result.outcome) {
    case "Ok":
      return forgeAuthorizationWordAnswered(result.value);
    case "Rejected":
      return forgeAuthorizationWordFailed("Refused");
    case "Absent":
      return forgeAuthorizationWordFailed("Not found");
    case "Retryable":
      return forgeAuthorizationWordFailed("Unavailable");
    case "Conflict":
      return forgeAuthorizationWordFailed("Conflict");
    case "Unauthenticated":
      return forgeAuthorizationWordFailed("Not signed in");
    case "Fault":
      return forgeAuthorizationWordFailed(
        result.code === "AuthorizationSpent"
          ? forgeAuthorizationSpent
          : "Failed",
      );
    case "Unreachable":
      return forgeAuthorizationWordFailed("Unreachable");
    case "Unreadable":
      return forgeAuthorizationWordFailed("Unreadable");
  }
}
