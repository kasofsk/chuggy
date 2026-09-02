import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { SignJWT, generateKeyPair } from "jose";

import {
  asSessionId,
  asSessionBearerSecret,
  sessionBearerPattern,
  sessionBearerPrefix,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
  type SessionBearerSecret,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { twoBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import type {
  BearerAuthentication,
  PrincipalAuthentication,
} from "../../src/adapters/http/server.ts";

/** A secret minted the way the scheduler mints one, so the language under test is the real one. */
function mintedSecret(): SessionBearerSecret {
  return asSessionBearerSecret(
    `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`,
  );
}

const identity: SessionBearerIdentity = {
  partition: { tenant: asTenantId("acme"), project: asProjectId("atlas") },
  session: asSessionId("session-one"),
  kind: "Thread",
  principal: asPrincipal("issuer\u0000subject"),
};

/**
 * Both authorities record every token they are offered, because what the cases
 * below are about is which one is offered a token at all.
 */
function authorities(
  offered: string[],
  answers: {
    readonly oidc?: BearerAuthentication;
    readonly session?: SessionBearerIdentity | undefined;
    readonly sessionRaises?: boolean;
  } = {},
): {
  readonly oidc: PrincipalAuthentication;
  readonly sessions: SessionBearerAuthority;
} {
  return {
    oidc: {
      authenticateBearer: (token) => {
        offered.push(`oidc:${token}`);
        return Promise.resolve(
          answers.oidc ?? { authenticated: "InvalidToken" },
        );
      },
    },
    sessions: {
      authenticate: (secret) => {
        offered.push(`session:${secret}`);
        if (answers.sessionRaises === true)
          return Promise.reject(new Error("the session authority is down"));
        return Promise.resolve(answers.session);
      },
    },
  };
}

test("a session bearer authorizes as its session's principal and names the session", async () => {
  const offered: string[] = [];
  const secret = mintedSecret();
  const { oidc, sessions } = authorities(offered, { session: identity });
  const decided = await twoBearerAuthentication(
    oidc,
    sessions,
  ).authenticateBearer(secret);
  assert.deepEqual(decided, {
    authenticated: "Bearer",
    bearer: {
      principal: identity.principal,
      viaSession: identity.session,
    },
  });
  assert.deepEqual(offered, [`session:${secret}`]);
});

test("a token outside the bearer language is never offered to the session authority", async () => {
  const offered: string[] = [];
  const keys = await generateKeyPair("RS256", { extractable: true });
  const token = await new SignJWT({ sub: "subject-one" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://accounts.example.test")
    .setAudience("chuggy-web")
    .sign(keys.privateKey);
  const { oidc, sessions } = authorities(offered, {
    oidc: {
      authenticated: "Bearer",
      bearer: { principal: identity.principal },
    },
  });
  const decided = await twoBearerAuthentication(
    oidc,
    sessions,
  ).authenticateBearer(token);
  assert.equal(decided.authenticated, "Bearer");
  assert.deepEqual(offered, [`oidc:${token}`]);
});

test("a session bearer the authority does not know is never offered to the issuer", async () => {
  const offered: string[] = [];
  const secret = mintedSecret();
  const { oidc, sessions } = authorities(offered, {
    session: undefined,
    oidc: {
      authenticated: "Bearer",
      bearer: { principal: identity.principal },
    },
  });
  const decided = await twoBearerAuthentication(
    oidc,
    sessions,
  ).authenticateBearer(secret);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`session:${secret}`]);
});

test("a bearer of the wrong kind is refused exactly as a bad one of its own kind is", async () => {
  const sessionSide = authorities([], { session: undefined });
  const oidcSide = authorities([], {
    oidc: { authenticated: "InvalidToken" },
  });
  const unknownSession = await twoBearerAuthentication(
    sessionSide.oidc,
    sessionSide.sessions,
  ).authenticateBearer(mintedSecret());
  const badToken = await twoBearerAuthentication(
    oidcSide.oidc,
    oidcSide.sessions,
  ).authenticateBearer("not-a-session-bearer");
  assert.deepEqual(unknownSession, badToken);
  assert.deepEqual(unknownSession, { authenticated: "InvalidToken" });
});

test("a session authority that raised could not decide, and says so", async () => {
  const offered: string[] = [];
  const { oidc, sessions } = authorities(offered, { sessionRaises: true });
  const decided = await twoBearerAuthentication(
    oidc,
    sessions,
  ).authenticateBearer(mintedSecret());
  assert.deepEqual(decided, { authenticated: "AuthorityUnavailable" });
  assert.equal(offered.filter((call) => call.startsWith("oidc:")).length, 0);
});

test("the two bearer languages are disjoint, so the routing is total", async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const token = await new SignJWT({ sub: "subject-one" })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
  assert.equal(token.startsWith("ey"), true);
  assert.equal(sessionBearerPattern.test(token), false);
  assert.equal(sessionBearerPattern.test(mintedSecret()), true);
});

/** Text the prefix routes to this side and the brand refuses, which is nobody's credential. */
const malformed = [
  sessionBearerPrefix,
  `${sessionBearerPrefix}${"a".repeat(31)}`,
  `${sessionBearerPrefix}${"a".repeat(241)}`,
  `${sessionBearerPrefix}not a bearer!`,
];

test("a prefixed token outside the language is the token's fault, and reaches neither authority", async () => {
  for (const token of malformed) {
    const offered: string[] = [];
    const { oidc, sessions } = authorities(offered, { session: identity });
    const decided = await twoBearerAuthentication(
      oidc,
      sessions,
    ).authenticateBearer(token);
    assert.deepEqual(
      decided,
      { authenticated: "InvalidToken" },
      `refusing ${JSON.stringify(token)}`,
    );
    assert.deepEqual(offered, [], `refusing ${JSON.stringify(token)}`);
  }
});

test("the prefix is compared exactly, so a case that no minting produces is the issuer's", async () => {
  const offered: string[] = [];
  const token = `${sessionBearerPrefix.toUpperCase()}${randomUUID()}${randomUUID()}`;
  const { oidc, sessions } = authorities(offered, { session: identity });
  const decided = await twoBearerAuthentication(
    oidc,
    sessions,
  ).authenticateBearer(token);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`oidc:${token}`]);
});
