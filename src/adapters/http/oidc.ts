/**
 * Bearer verification against the issuer's published key set, and the decision
 * of whose failure it is when that verification does not succeed.
 *
 * TWO LISTS GOVERN THIS FILE AND BOTH ARE ALLOW-LISTS, because the direction
 * that cannot go quietly wrong is refusing what nobody considered.
 *
 * `oidcVerifiableAlgorithms` IS WHAT MAY BE CONFIGURED, and membership needs
 * two things rather than one. An entry must verify with a PUBLISHED key: a
 * shared-secret algorithm verifies with the key it signs with, and naming one
 * beside an asymmetric algorithm lets a caller choose it against a key set
 * that is not a secret. And the installed verifier must actually implement it:
 * an algorithm it does not — `ES256K`, which this `jose` dropped — passes
 * configuration, discovery and key-set retrieval, and then refuses every token
 * on a server that started clean. `ML-DSA-*` satisfies both and is left off
 * anyway, because the runtime marks it experimental and an authentication path
 * is not where an experimental primitive earns its place. Every member is
 * signed with and verified through this module by a test, and the membership
 * itself is asserted, so an entry can be neither added without being
 * verifiable nor dropped without being noticed.
 *
 * `oidcInvalidTokenCodes` IS WHAT COUNTS AS THE TOKEN'S FAULT, and everything
 * else — a key set that timed out, answered a non-200, answered something that
 * is not a key set, or could not be reached — is this server failing to
 * verify. An unrecognised failure therefore reads as "could not decide", which
 * answers 503, rather than as an accusation that would tell a caller to
 * replace a credential that was never the problem.
 *
 * WHAT `jose` PROMISES ABOUT CLAIMS IS LESS THAN ITS TYPES SAY. `requiredClaims`
 * asks whether a claim is present and nothing about what is in it, so the
 * subject typed `string` is whatever JSON the issuer signed; `oidcUsableSubject`
 * is where that is narrowed, and it is narrowed before anything encodes it.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import { oidcPrincipal } from "../../interpreter/nativeWeb.ts";
import type { PrincipalAuthentication } from "./server.ts";

export interface OidcAuthenticationConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly discoveryTimeoutMs: number;
  readonly jwksTimeoutMs: number;
}

/**
 * A provider advertises far more than the two members this code reads, and
 * OpenID Connect Discovery requires a client to ignore the rest.
 */
const discoverySchema = z.object({
  issuer: z.string(),
  jwks_uri: z.string(),
});

const millisecondsPerSecond = 1_000;

/** The failures that are the token's, which the module header argues the membership of. */
export const oidcInvalidTokenCodes = new Set([
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
]);

function oidcInvalidToken(failure: unknown): boolean {
  if (typeof failure !== "object" || failure === null) return false;
  if (!("code" in failure)) return false;
  const code: unknown = failure.code;
  return typeof code === "string" && oidcInvalidTokenCodes.has(code);
}

/**
 * Whether a verified claim can name a principal, narrowing a value `jose` has
 * only checked the presence of. An array would reach `oidcPrincipal` and
 * throw, and an object would reach it and stringify.
 */
function oidcUsableSubject(subject: unknown): subject is string {
  return typeof subject === "string" && subject !== "";
}

/** The algorithms a deployment may name, which the module header argues the membership of. */
export const oidcVerifiableAlgorithms = new Set([
  "EdDSA",
  "ES256",
  "ES384",
  "ES512",
  "Ed25519",
  "PS256",
  "PS384",
  "PS512",
  "RS256",
  "RS384",
  "RS512",
]);

function positiveDuration(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return value;
}

function secureUrl(value: string, what: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
    throw new RangeError(`${what} must be an HTTPS URL without credentials`);
  return url;
}

function checkedConfiguration(
  config: OidcAuthenticationConfig,
): OidcAuthenticationConfig {
  const issuer = secureUrl(config.issuer, "OIDC issuer");
  if (issuer.search !== "" || issuer.hash !== "")
    throw new RangeError("OIDC issuer must not contain a query or fragment");
  if (config.audience.length === 0)
    throw new RangeError("OIDC audience is empty");
  if (config.algorithms.length === 0)
    throw new RangeError("OIDC algorithms are empty");
  const refused = config.algorithms.filter(
    (algorithm) => !oidcVerifiableAlgorithms.has(algorithm),
  );
  if (refused.length > 0)
    throw new RangeError(
      `OIDC algorithms must verify with a published key: ${refused
        .map((algorithm) => JSON.stringify(algorithm))
        .join(",")}`,
    );
  positiveDuration(config.discoveryTimeoutMs, "OIDC discovery timeout");
  positiveDuration(config.jwksTimeoutMs, "OIDC JWKS timeout");
  return config;
}

function discoveryUrl(issuer: string): URL {
  const url = new URL(issuer);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/.well-known/openid-configuration`;
  return url;
}

async function discoverJwks(
  config: OidcAuthenticationConfig,
  fetcher: typeof fetch,
): Promise<URL> {
  const response = await fetcher(discoveryUrl(config.issuer), {
    signal: AbortSignal.timeout(config.discoveryTimeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("OIDC discovery failed");
  const discovered = discoverySchema.parse(await response.json());
  if (discovered.issuer !== config.issuer)
    throw new Error("OIDC discovery returned a different issuer");
  return secureUrl(discovered.jwks_uri, "OIDC JWKS URI");
}

export async function oidcAuthentication(
  input: OidcAuthenticationConfig,
  fetcher: typeof fetch = fetch,
): Promise<PrincipalAuthentication> {
  const config = checkedConfiguration(input);
  const jwks = createRemoteJWKSet(await discoverJwks(config, fetcher), {
    timeoutDuration: config.jwksTimeoutMs,
  });
  return {
    authenticateBearer: async (token) => {
      let verified;
      try {
        verified = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: [...config.algorithms],
          requiredClaims: ["sub"],
        });
      } catch (failure) {
        return {
          authenticated: oidcInvalidToken(failure)
            ? "InvalidToken"
            : "AuthorityUnavailable",
        };
      }
      const subject = verified.payload.sub;
      if (!oidcUsableSubject(subject)) return { authenticated: "InvalidToken" };
      const expiry = verified.payload.exp;
      return {
        authenticated: "Bearer",
        bearer: {
          principal: oidcPrincipal(config.issuer, subject),
          ...(expiry === undefined
            ? {}
            : { expiresAtMs: expiry * millisecondsPerSecond }),
        },
      };
    },
  };
}
