/**
 * The API's second bearer kind, and the routing that keeps the two apart.
 *
 * THE TWO KINDS ARE TOLD APART BY THE LANGUAGE EACH IS WRITTEN IN, never by
 * offering a token to one authority and then the other. A token offered to the
 * wrong authority is a token that authority now has, and probing is how a
 * leaked credential reaches an issuer it was never for.
 *
 * `sessionBearerPrefix` ROUTES AND `sessionBearerPattern` ADMITS, and the two
 * jobs are separate because a malformed session bearer belongs to neither
 * authority. Routing on the pattern would send `chgs_` followed by junk to the
 * issuer, which is the very thing above; routing on the prefix and stopping
 * there would hand the session authority text its brand refuses. So a token
 * carrying the prefix is this side's to refuse, and everything else is the
 * issuer's. The prefix is compared exactly, as the pattern spells it, because a
 * case-folded comparison admits `CHGS_` — text no minting ever produces — into
 * the half of the routing that is not the issuer's. No compact JWS can carry
 * the prefix: one begins with the base64url of `{"alg`.
 *
 * THE THREE ANSWERS STAY THREE, for the reason `./oidc.ts`'s header argues
 * about a key set: a session authority that raised could not decide, and
 * answering that as a refusal of the token would tell a caller to replace a
 * credential that was never the problem. Everything else on this side is the
 * token's fault and is refused as one — text outside the bearer language, a
 * closed session, a dead attempt and a secret that was never minted are
 * indistinguishable from outside, and they are all `InvalidToken`. In
 * particular a token this side cannot brand must never reach the blanket catch
 * in `./server.ts`, which would report a bad token as this server's own outage
 * and hand an anonymous caller a switch that declares one.
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
  sessionBearerPrefix,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
} from "../../interpreter/agentSession.ts";
import type { PrincipalAuthentication } from "./server.ts";

export function twoBearerAuthentication(
  oidc: PrincipalAuthentication,
  sessions: SessionBearerAuthority,
): PrincipalAuthentication {
  return {
    authenticateBearer: async (token) => {
      if (!token.startsWith(sessionBearerPrefix))
        return oidc.authenticateBearer(token);
      if (!sessionBearerPattern.test(token))
        return { authenticated: "InvalidToken" };
      const secret = asSessionBearerSecret(token);
      let identity: SessionBearerIdentity | undefined;
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
