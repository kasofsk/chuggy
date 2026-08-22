import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import { asPrincipal, type Principal } from "../../interpreter/nativeWeb.ts";
import type { PrincipalAuthentication } from "./server.ts";

export interface OidcAuthenticationConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly discoveryTimeoutMs: number;
  readonly jwksTimeoutMs: number;
}

const discoverySchema = z.strictObject({
  issuer: z.string(),
  jwks_uri: z.string(),
});

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

export function oidcPrincipal(issuer: string, subject: string): Principal {
  if (subject.length === 0) throw new RangeError("OIDC subject is empty");
  return asPrincipal(`${String(issuer.length)}:${issuer}${subject}`);
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
      const verified = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: [...config.algorithms],
        requiredClaims: ["sub"],
      });
      const subject = verified.payload.sub;
      if (subject === undefined) throw new Error("OIDC token has no subject");
      return oidcPrincipal(config.issuer, subject);
    },
  };
}
