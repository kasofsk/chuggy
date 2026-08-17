/**
 * Who is calling: a token from one issuer, verified against that issuer's
 * published keys, and the verified subject looked up in the registry.
 *
 * THE VERIFIER IS INJECTED, NOT NAMED HERE. The key source, the issuer and the
 * audience arrive as a value, so the deployment points at Google's published
 * keys and a suite points at a key pair it generated — the same verification
 * either way, against different keys. A verifier this module constructed would
 * make every test of it a test of the network.
 *
 * SIGNATURE VERIFICATION IS NOT HAND-WRITTEN. `jose` checks the signature, the
 * issuer, the audience and the expiry together; each of those is a refusal that
 * costs the whole deployment if it is subtly wrong, and none of them is a place
 * to be original.
 *
 * TWO REFUSALS, AND THEY ARE NOT THE SAME REFUSAL. A token that does not verify
 * names nobody, so the caller is unauthenticated and may retry with a real one.
 * A token that verifies for a subject the registry does not hold names somebody
 * this deployment declines to serve, and retrying changes nothing — the
 * registry IS the allowlist, and absence from it is the answer.
 */

import { jwtVerify, type JWTVerifyGetKey } from "jose";

import type { Registry, RegistryUser } from "../../interpreter/registry.ts";

/** What a token is verified against: where the keys come from, and the two claims a token must carry. */
export interface Identity {
  readonly keys: JWTVerifyGetKey;
  readonly issuer: string;
  readonly audience: string;
}

/** Who is calling, or why nobody is. */
export type Caller =
  | { readonly caller: "Admitted"; readonly user: RegistryUser }
  | { readonly caller: "Unverified"; readonly why: string }
  | { readonly caller: "Unregistered"; readonly subject: string };

/** What a token names once it has passed the verifier, or why it did not. */
export type Verified =
  | { readonly verified: "Subject"; readonly subject: string }
  | { readonly verified: "Refused"; readonly why: string };

/** The cookie the browser flow sets; the API takes it or a bearer header, and prefers the header. */
export const identityCookieName = "chuggy_session";

/** The named cookie's value out of a `Cookie` header; a pair this desk cannot decode names nobody, exactly as a missing one does. */
function identityCookieIn(header: string, name: string): string | undefined {
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The token a request carries: the bearer header when it has one, else the session cookie. */
export function identityTokenIn(
  authorization: string | undefined,
  cookie: string | undefined,
): string | undefined {
  const bearer = /^Bearer +(\S+)$/.exec(authorization ?? "");
  const named = bearer?.[1];
  if (named !== undefined) return named;
  return identityCookieIn(cookie ?? "", identityCookieName);
}

/** The subject a token names once its signature, issuer, audience and expiry all hold. */
export async function identityVerify(
  identity: Identity,
  token: string | undefined,
): Promise<Verified> {
  if (token === undefined || token === "") {
    return { verified: "Refused", why: "the request carried no token" };
  }
  try {
    const { payload } = await jwtVerify(token, identity.keys, {
      issuer: identity.issuer,
      audience: identity.audience,
    });
    const subject = payload.sub;
    if (subject === undefined || subject === "") {
      return { verified: "Refused", why: "the token names no subject" };
    }
    return { verified: "Subject", subject };
  } catch (failure: unknown) {
    const why = failure instanceof Error ? failure.message : String(failure);
    return { verified: "Refused", why };
  }
}

/** The caller a token names: verified, and then admitted or refused by the registry alone. */
export async function identityCaller(
  identity: Identity,
  registry: Registry,
  token: string | undefined,
): Promise<Caller> {
  const verified = await identityVerify(identity, token);
  if (verified.verified === "Refused") {
    return { caller: "Unverified", why: verified.why };
  }
  const user = await registry.userBySubject(verified.subject);
  if (user === undefined) {
    return { caller: "Unregistered", subject: verified.subject };
  }
  return { caller: "Admitted", user };
}
