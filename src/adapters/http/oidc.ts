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

/**
 * The failures that are the token's, listed rather than derived, so that
 * anything not on the list — a key set that timed out, answered a non-200, or
 * could not be reached at all — reads as this server failing to verify rather
 * than as the caller failing to prove.
 */
const oidcInvalidTokenCodes = new Set([
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
  if (config.algorithms.length === 0 || config.algorithms.includes("none"))
    throw new RangeError("OIDC algorithms are empty or insecure");
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
      if (subject === undefined) return { authenticated: "InvalidToken" };
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
