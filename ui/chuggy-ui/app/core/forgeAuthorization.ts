/**
 * Connecting forge accounts by proof: the authorization this console sends a
 * person to the forge for, and what the api said each account came to. The
 * state and verifier are held in tab storage and taken once by the callback.
 */

import type {
  ForgeAppName,
  ForgeAccountProofName,
} from "../../../../src/contract/rosters.ts";
import type {
  ForgeAuthorizationClientResponse,
  ForgeAuthorizationResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
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
  readonly project: string;
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
    const { state, verifier, tenant, project, returnPath } = fields;
    if (typeof state !== "string" || typeof verifier !== "string")
      return undefined;
    if (typeof tenant !== "string" || typeof project !== "string")
      return undefined;
    if (typeof returnPath !== "string") return undefined;
    return { state, verifier, tenant, project, returnPath };
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

/** One account as the callback draws it: its proof, that proof's word, and the apps left to install. */
export interface ForgeAuthorizedLine {
  readonly account: string;
  readonly proof: ForgeAccountProofName;
  readonly status: string;
  readonly install: readonly ForgeAppName[];
}

function forgeProofStatus(proof: ForgeAccountProofName): string {
  switch (proof) {
    case "Proven":
      return "Connected";
    case "NotOwner":
      return "Not owner";
    case "Unavailable":
      return "Unavailable";
  }
}

export function forgeAuthorizedLines(
  answered: ForgeAuthorizationResponse,
): readonly ForgeAuthorizedLine[] {
  return answered.accounts.map((account) => ({
    account: account.account,
    proof: account.proof,
    status: forgeProofStatus(account.proof),
    install: account.apps
      .filter((app) => app.claim === "Missing")
      .map((app) => app.app),
  }));
}

/** What this console says where the forge spent the code before the api could read what it reaches. */
export const forgeAuthorizationSpent = "Start again";

/**
 * What redeeming came to, as the lines drawn or the one word in their place.
 * `Again` is a code no retry can redeem, which only a new authorization puts
 * right.
 */
export type ForgeAuthorizationOutcome =
  | {
      readonly outcome: "Authorized";
      readonly lines: readonly ForgeAuthorizedLine[];
      readonly truncated: boolean;
    }
  | { readonly outcome: "Again"; readonly status: string }
  | { readonly outcome: "Refused"; readonly status: string };

/**
 * `ForgeNotConfigured` and a tenant the caller does not administer are both a
 * `404`, which the console reads without its code, so both are one word.
 */
export function forgeAuthorizationOutcome(
  result: ApiResult<ForgeAuthorizationResponse>,
): ForgeAuthorizationOutcome {
  switch (result.outcome) {
    case "Ok":
      return {
        outcome: "Authorized",
        lines: forgeAuthorizedLines(result.value),
        truncated: result.value.truncated,
      };
    case "Rejected":
      return result.code === "AuthorizationRefused"
        ? { outcome: "Again", status: "Refused" }
        : { outcome: "Refused", status: "Refused" };
    case "Absent":
      return { outcome: "Refused", status: "Not found" };
    case "Retryable":
      return { outcome: "Refused", status: "Unavailable" };
    case "Conflict":
      return { outcome: "Refused", status: "Conflict" };
    case "Unauthenticated":
      return { outcome: "Refused", status: "Not signed in" };
    case "Fault":
      return result.code === "AuthorizationSpent"
        ? { outcome: "Again", status: forgeAuthorizationSpent }
        : { outcome: "Refused", status: "Failed" };
    case "Unreachable":
      return { outcome: "Refused", status: "Unreachable" };
    case "Unreadable":
      return { outcome: "Refused", status: "Unreadable" };
  }
}
