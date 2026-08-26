/**
 * The authorization code flow with PKCE, expressed as data.
 *
 * Every function here builds a request or reads an answer; the redirect, the
 * holding of the tokens and the scheduling of a refresh are the caller's. The
 * client is public and registered with no authentication method, so no request
 * below carries a secret, and the authorize request carries `audience` because
 * the issuer mints an empty one otherwise.
 */

import { z } from "zod";

import { pkceChallengeMethod } from "./pkce.ts";
import type { ConsoleConfiguration } from "./configuration.ts";

export const discoveryPath = "/.well-known/openid-configuration";
export const sessionRefreshSecondsBefore = 60;
export const sessionRefreshFailuresMax = 3;

const discoverySchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.string().min(1),
  token_endpoint: z.string().min(1),
  revocation_endpoint: z.string().min(1).optional(),
  end_session_endpoint: z.string().min(1).optional(),
});

export interface AuthorizationEndpoints {
  readonly authorize: string;
  readonly token: string;
  readonly revoke: string | undefined;
}

export interface AuthorizationTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly challenge: string;
}

export interface FormRequest {
  readonly url: string;
  readonly body: string;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresInSeconds: number;
}

export type AuthorizationCallback =
  | { readonly result: "Code"; readonly code: string; readonly state: string }
  | { readonly result: "Denied"; readonly reason: string }
  | { readonly result: "None" };

export function discoveryUrl(configuration: ConsoleConfiguration): string {
  return `${configuration.issuer}${discoveryPath}`;
}

/** The issuer the document claims must be the issuer the console asked. */
export function parseDiscovery(
  configuration: ConsoleConfiguration,
  value: unknown,
): AuthorizationEndpoints {
  const document = discoverySchema.parse(value);
  if (document.issuer.replace(/\/+$/u, "") !== configuration.issuer)
    throw new TypeError("the discovery document names another issuer");
  return {
    authorize: document.authorization_endpoint,
    token: document.token_endpoint,
    revoke: document.revocation_endpoint,
  };
}

export function authorizeUrl(
  configuration: ConsoleConfiguration,
  endpoints: AuthorizationEndpoints,
  transaction: AuthorizationTransaction,
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    scope: configuration.scopes.join(" "),
    audience: configuration.audience,
    state: transaction.state,
    code_challenge: transaction.challenge,
    code_challenge_method: pkceChallengeMethod,
  });
  return `${endpoints.authorize}?${query.toString()}`;
}

export function parseAuthorizationCallback(
  search: string,
): AuthorizationCallback {
  const query = new URLSearchParams(search);
  const refusal = query.get("error");
  if (refusal !== null)
    return {
      result: "Denied",
      reason: `${refusal}: ${query.get("error_description") ?? "the authorization server declined"}`,
    };
  const code = query.get("code");
  const state = query.get("state");
  if (code === null || state === null) return { result: "None" };
  return { result: "Code", code, state };
}

function formRequest(url: string, fields: Record<string, string>): FormRequest {
  return { url, body: new URLSearchParams(fields).toString() };
}

export function tokenExchangeRequest(
  configuration: ConsoleConfiguration,
  endpoints: AuthorizationEndpoints,
  exchange: { readonly code: string; readonly verifier: string },
): FormRequest {
  return formRequest(endpoints.token, {
    grant_type: "authorization_code",
    code: exchange.code,
    redirect_uri: configuration.redirectUri,
    client_id: configuration.clientId,
    code_verifier: exchange.verifier,
  });
}

export function tokenRefreshRequest(
  configuration: ConsoleConfiguration,
  endpoints: AuthorizationEndpoints,
  refreshToken: string,
): FormRequest {
  return formRequest(endpoints.token, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: configuration.clientId,
  });
}

/** Absent from the discovery document, an issuer offers no revocation at all. */
export function tokenRevocationRequest(
  configuration: ConsoleConfiguration,
  endpoints: AuthorizationEndpoints,
  refreshToken: string,
): FormRequest | undefined {
  if (endpoints.revoke === undefined) return undefined;
  return formRequest(endpoints.revoke, {
    token: refreshToken,
    token_type_hint: "refresh_token",
    client_id: configuration.clientId,
  });
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
});

/** A response with no stated lifetime is one that has already run out. */
export function parseIssuedTokens(value: unknown): IssuedTokens {
  const issued = tokenResponseSchema.parse(value);
  return {
    accessToken: issued.access_token,
    refreshToken: issued.refresh_token,
    expiresInSeconds: issued.expires_in ?? 0,
  };
}
