/**
 * The API's second and third bearer kinds, and the routing that keeps the
 * three apart: the issuer's, a session's, and a project's access token.
 *
 * THE KINDS ARE TOLD APART BY THE LANGUAGE EACH IS WRITTEN IN, never by
 * offering a token to one authority and then another. A token offered to the
 * wrong authority is a token that authority now has, and probing is how a
 * leaked credential reaches an issuer it was never for.
 *
 * EACH PREFIX ROUTES AND EACH PATTERN ADMITS — `sessionBearerPrefix` and
 * `sessionBearerPattern`, `accessTokenPrefix` and `accessTokenPattern` — and
 * the two jobs are separate because a malformed bearer of either kind belongs
 * to no authority. Routing on the pattern would send `chgs_` followed by junk
 * to the issuer, which is the very thing above; routing on the prefix and
 * stopping there would hand an authority text its brand refuses. So a token
 * carrying either prefix is this side's to refuse, and everything else is the
 * issuer's. Each prefix is compared exactly, as its pattern spells it, because
 * a case-folded comparison admits `CHGS_` — text no minting ever produces —
 * into the half of the routing that is not the issuer's. No compact JWS can
 * carry either prefix: one begins with the base64url of `{"alg`.
 *
 * THE THREE ANSWERS STAY THREE, for the reason `./oidc.ts`'s header argues
 * about a key set: an authority that raised could not decide, and answering
 * that as a refusal of the token would tell a caller to replace a credential
 * that was never the problem. Everything else on this side is the token's
 * fault and is refused as one — text outside the bearer language, a closed
 * session, a dead attempt, a deleted or expired access token and a secret that
 * was never minted are indistinguishable from outside, and they are all
 * `InvalidToken`. In particular a token this side cannot brand must never
 * reach the blanket catch in `./server.ts`, which would report a bad token as
 * this server's own outage and hand an anonymous caller a switch that declares
 * one.
 *
 * REVOCATION IS THE SESSION ROW, AND THE TOKEN ROW. The session authority
 * answers nothing once the session closes or its attempt ends, so ending a
 * session ends its pod's authority with no token exchange and no second
 * issuer. The token authority reads its row on every request and holds no
 * cache, so a deleted token is refused on the next request it makes.
 *
 * A SESSION IS AUTHORIZED AS ITS PRINCIPAL, INSIDE ITS OWN PARTITION ONLY. It
 * resolves to its own row's principal and is authorized as that principal, by
 * the one path every other bearer takes, but the partition the authority
 * answered travels with it and `./sessionBearerScope.ts` confines it there. The
 * session is recorded on what it submits and decides nothing. An access token
 * is the same with its maker as the principal, confined by
 * `./accessTokenScope.ts`.
 */

import {
  accessTokenPattern,
  accessTokenPrefix,
} from "../../contract/accessToken.ts";
import {
  sessionBearerPattern,
  sessionBearerPrefix,
} from "../../contract/sessionPlane.ts";
import {
  asAccessTokenBearerSecret,
  type AccessTokenBearerAuthority,
  type AccessTokenBearerIdentity,
} from "../../interpreter/accessToken.ts";
import {
  asSessionBearerSecret,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
} from "../../interpreter/agentSession.ts";
import type {
  BearerAuthentication,
  PrincipalAuthentication,
} from "./server.ts";

/** One presented access token, answered by the token authority alone. */
async function threeBearerAccessToken(
  tokens: AccessTokenBearerAuthority,
  token: string,
): Promise<BearerAuthentication> {
  if (!accessTokenPattern.test(token)) return { authenticated: "InvalidToken" };
  const secret = asAccessTokenBearerSecret(token);
  let identity: AccessTokenBearerIdentity | undefined;
  try {
    identity = await tokens.authenticate(secret);
  } catch {
    return { authenticated: "AuthorityUnavailable" };
  }
  if (identity === undefined) return { authenticated: "InvalidToken" };
  return {
    authenticated: "Bearer",
    bearer: {
      principal: identity.principal,
      viaToken: {
        token: identity.token,
        name: identity.name,
        access: identity.access,
        partition: identity.partition,
        expiresAt: identity.expiresAt,
      },
    },
  };
}

export function threeBearerAuthentication(
  oidc: PrincipalAuthentication,
  sessions: SessionBearerAuthority,
  tokens: AccessTokenBearerAuthority,
): PrincipalAuthentication {
  return {
    authenticateBearer: async (token) => {
      if (token.startsWith(accessTokenPrefix))
        return threeBearerAccessToken(tokens, token);
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
          viaSession: {
            session: identity.session,
            partition: identity.partition,
            scope: identity.scope,
            capabilities: identity.capabilities,
          },
        },
      };
    },
  };
}
