/**
 * The authorization code flow with PKCE, expressed as data.
 *
 * Every function here builds a request or reads an answer; the redirect, the
 * storage of the in-flight transaction and the holding of the token are the
 * caller's. The authorize request carries `audience` because without it the
 * access token comes back with an empty audience and every API call answers
 * 401.
 */

import { base64urlDecoded } from "./encoding.js";
import { challengeMethod } from "./pkce.js";

export const configurationPath = "/config.json";
export const discoveryPath = "/.well-known/openid-configuration";
export const sessionRefreshSecondsBefore = 60;

/**
 * @typedef {object} Configuration
 * @property {string} issuer
 * @property {string} clientId
 * @property {string} audience
 * @property {string} redirectUri
 * @property {readonly string[]} scopes
 */

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 */
function required(fields, name) {
  const value = fields[name];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`the console configuration has no ${name}`);
  return value;
}

/**
 * @param {unknown} value
 * @returns {Configuration}
 */
export function parseConfiguration(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("the console configuration is not an object");
  const fields = /** @type {Record<string, unknown>} */ (value);
  const scopes = fields["scopes"];
  if (
    !Array.isArray(scopes) ||
    scopes.some((scope) => typeof scope !== "string")
  )
    throw new TypeError("the console configuration has no scope list");
  return {
    issuer: required(fields, "issuer").replace(/\/+$/u, ""),
    clientId: required(fields, "clientId"),
    audience: required(fields, "audience"),
    redirectUri: required(fields, "redirectUri"),
    scopes: /** @type {readonly string[]} */ (scopes),
  };
}

/** @param {Configuration} configuration */
export function discoveryUrl(configuration) {
  return `${configuration.issuer}${discoveryPath}`;
}

/**
 * The issuer the document claims must be the issuer the console asked.
 *
 * @param {Configuration} configuration
 * @param {unknown} value
 */
export function parseDiscovery(configuration, value) {
  if (typeof value !== "object" || value === null)
    throw new TypeError("the discovery document is not an object");
  const fields = /** @type {Record<string, unknown>} */ (value);
  const issuer = required(fields, "issuer").replace(/\/+$/u, "");
  if (issuer !== configuration.issuer)
    throw new TypeError("the discovery document names another issuer");
  return {
    issuer,
    authorizationEndpoint: required(fields, "authorization_endpoint"),
    tokenEndpoint: required(fields, "token_endpoint"),
  };
}

/**
 * @typedef {{ issuer: string, authorizationEndpoint: string, tokenEndpoint: string }} Endpoints
 */

/**
 * @typedef {object} Transaction
 * @property {string} state
 * @property {string} verifier
 * @property {string} challenge
 */

/**
 * @param {Configuration} configuration
 * @param {Endpoints} endpoints
 * @param {Transaction} transaction
 */
export function authorizeUrl(configuration, endpoints, transaction) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    scope: configuration.scopes.join(" "),
    audience: configuration.audience,
    state: transaction.state,
    code_challenge: transaction.challenge,
    code_challenge_method: challengeMethod,
  });
  return `${endpoints.authorizationEndpoint}?${query.toString()}`;
}

/**
 * @param {string} search
 * @returns {{ result: "Code", code: string, state: string }
 *   | { result: "Denied", code: string, description: string }
 *   | { result: "Absent" }}
 */
export function parseCallback(search) {
  const query = new URLSearchParams(search);
  const failure = query.get("error");
  if (failure !== null)
    return {
      result: "Denied",
      code: failure,
      description:
        query.get("error_description") ?? "The authorization server declined.",
    };
  const code = query.get("code");
  const state = query.get("state");
  if (code === null || state === null) return { result: "Absent" };
  return { result: "Code", code, state };
}

/**
 * @param {string} endpoint
 * @param {Record<string, string>} fields
 */
function formRequest(endpoint, fields) {
  return {
    method: /** @type {const} */ ("POST"),
    url: endpoint,
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
  };
}

/**
 * @param {Configuration} configuration
 * @param {Endpoints} endpoints
 * @param {{ code: string, verifier: string }} exchange
 */
export function tokenExchangeRequest(configuration, endpoints, exchange) {
  return formRequest(endpoints.tokenEndpoint, {
    grant_type: "authorization_code",
    code: exchange.code,
    redirect_uri: configuration.redirectUri,
    client_id: configuration.clientId,
    code_verifier: exchange.verifier,
  });
}

/**
 * @param {Configuration} configuration
 * @param {Endpoints} endpoints
 * @param {string} refreshToken
 */
export function tokenRefreshRequest(configuration, endpoints, refreshToken) {
  return formRequest(endpoints.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: configuration.clientId,
  });
}

/**
 * @param {unknown} value
 * @returns {{ accessToken: string, expiresInSeconds: number,
 *   refreshToken: string | undefined, idToken: string | undefined }}
 */
export function parseTokenResponse(value) {
  if (typeof value !== "object" || value === null)
    throw new TypeError("the token response is not an object");
  const fields = /** @type {Record<string, unknown>} */ (value);
  const expires = fields["expires_in"];
  const refresh = fields["refresh_token"];
  const identity = fields["id_token"];
  return {
    accessToken: required(fields, "access_token"),
    expiresInSeconds:
      typeof expires === "number" &&
      Number.isSafeInteger(expires) &&
      expires > 0
        ? expires
        : 0,
    refreshToken: typeof refresh === "string" ? refresh : undefined,
    idToken: typeof identity === "string" ? identity : undefined,
  };
}

/**
 * A session with no stated lifetime is treated as one that has already run out.
 *
 * @param {number} nowMs
 * @param {number} expiresInSeconds
 */
export function sessionExpiresAtMs(nowMs, expiresInSeconds) {
  return nowMs + expiresInSeconds * 1_000;
}

/**
 * @param {number} nowMs
 * @param {number} expiresAtMs
 */
export function sessionNeedsRefresh(nowMs, expiresAtMs) {
  return nowMs >= expiresAtMs - sessionRefreshSecondsBefore * 1_000;
}

/**
 * The subject a signed-in operator is shown, read from the identity token
 * without verifying it. The API is the authority on who this is; this label is
 * only so an operator can tell which account the console is holding.
 *
 * @param {string} idToken
 */
export function identityLabel(idToken) {
  const payload = idToken.split(".")[1];
  if (payload === undefined) return undefined;
  const decoded = /** @type {unknown} */ (
    JSON.parse(new TextDecoder().decode(base64urlDecoded(payload)))
  );
  if (typeof decoded !== "object" || decoded === null) return undefined;
  const claims = /** @type {Record<string, unknown>} */ (decoded);
  for (const name of ["email", "preferred_username", "name", "sub"]) {
    const value = claims[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
