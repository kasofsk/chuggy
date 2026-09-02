/**
 * The API's second bearer kind, and the routing that keeps the two apart.
 *
 * THE TWO KINDS ARE TOLD APART BY THE LANGUAGE EACH IS WRITTEN IN, never by
 * offering a token to one authority and then the other. A token offered to the
 * wrong authority is a token that authority now has, and probing is how a
 * leaked credential reaches an issuer it was never for. `sessionBearerPattern`
 * is the whole discriminator: every session bearer matches it, and no compact
 * JWS can, because a compact JWS begins with the base64url of `{"alg` and the
 * pattern demands `chgs_`. So the routing is total and neither authority ever
 * sees the other's credential.
 *
 * THE THREE ANSWERS STAY THREE, for the reason `./oidc.ts`'s header argues
 * about a key set: a session authority that raised could not decide, and
 * answering that as a refusal of the token would tell a caller to replace a
 * credential that was never the problem. A session the authority looked up and
 * did not find is the token's fault and is refused as one — a closed session, a
 * dead attempt and a secret that was never minted are indistinguishable from
 * outside, and they are all `InvalidToken`.
 *
 * REVOCATION IS THE SESSION ROW. The authority answers nothing once the session
 * closes or its attempt ends, so ending a session ends its pod's authority with
 * no token exchange and no second issuer.
 *
 * AUTHORIZATION IS UNCHANGED. A session resolves to its own row's principal and
 * is authorized as that principal, by the one path every other bearer takes.
 * The session is recorded on what it submits and decides nothing.
 */

import {
  asSessionBearerSecret,
  sessionBearerPattern,
  type SessionBearerSecret,
  type SessionId,
  type SessionKind,
} from "../../interpreter/agentSession.ts";
import type { Principal } from "../../interpreter/principal.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { PrincipalAuthentication } from "./server.ts";

/** Whose authority a session bearer carries, and which session carried it. */
export interface SessionBearerIdentity {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly kind: SessionKind;
  readonly principal: Principal;
}

/** The durable side's answer about one session bearer, which is a row or nothing. */
export interface SessionBearerAuthority {
  authenticate(
    secret: SessionBearerSecret,
  ): Promise<SessionBearerIdentity | undefined>;
}

export function twoBearerAuthentication(
  oidc: PrincipalAuthentication,
  sessions: SessionBearerAuthority,
): PrincipalAuthentication {
  return {
    authenticateBearer: async (token) => {
      if (!sessionBearerPattern.test(token))
        return oidc.authenticateBearer(token);
      const secret = asSessionBearerSecret(token);
      let identity;
      try {
        identity = await sessions.authenticate(secret);
      } catch {
        return { authenticated: "AuthorityUnavailable" };
      }
      if (identity === undefined) return { authenticated: "InvalidToken" };
      return {
        authenticated: "Bearer",
        bearer: {
          principal: identity.principal,
          viaSession: identity.session,
        },
      };
    },
  };
}
