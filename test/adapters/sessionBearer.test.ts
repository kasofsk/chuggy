import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

import { SignJWT, generateKeyPair } from "jose";

import {
  accessTokenPattern,
  accessTokenPrefix,
} from "../../src/contract/accessToken.ts";
import {
  sessionBearerPattern,
  sessionBearerPrefix,
} from "../../src/contract/sessionPlane.ts";
import type {
  AccessTokenBearerAuthority,
  AccessTokenBearerIdentity,
} from "../../src/interpreter/accessToken.ts";
import {
  asSessionId,
  asSessionBearerSecret,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
  type SessionBearerSecret,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { threeBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
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
  principal: asPrincipal("issuer-subject"),
  scope: "Project",
  capabilities: ["ProjectRead"],
};

/**
 * Every authority records every token they are offered, because what the cases
 * below are about is which one is offered a token at all.
 */
function authorities(
  offered: string[],
  answers: {
    readonly oidc?: BearerAuthentication;
    readonly session?: SessionBearerIdentity | undefined;
    readonly sessionRaises?: boolean;
    readonly token?: AccessTokenBearerIdentity | undefined;
    readonly tokenRaises?: boolean;
  } = {},
): {
  readonly oidc: PrincipalAuthentication;
  readonly sessions: SessionBearerAuthority;
  readonly tokens: AccessTokenBearerAuthority;
} {
  return {
    tokens: {
      authenticate: (secret) => {
        offered.push(`token:${secret}`);
        if (answers.tokenRaises === true)
          return Promise.reject(new Error("the token authority is down"));
        return Promise.resolve(answers.token);
      },
    },
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

test("a session bearer authorizes as its session's principal, names the session and carries its partition, scope and capabilities", async () => {
  const offered: string[] = [];
  const secret = mintedSecret();
  const { oidc, sessions, tokens } = authorities(offered, {
    session: identity,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(secret);
  assert.deepEqual(decided, {
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
  const { oidc, sessions, tokens } = authorities(offered, {
    oidc: {
      authenticated: "Bearer",
      bearer: { principal: identity.principal },
    },
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(token);
  assert.equal(decided.authenticated, "Bearer");
  assert.deepEqual(offered, [`oidc:${token}`]);
});

test("a session bearer the authority does not know is never offered to the issuer", async () => {
  const offered: string[] = [];
  const secret = mintedSecret();
  const { oidc, sessions, tokens } = authorities(offered, {
    session: undefined,
    oidc: {
      authenticated: "Bearer",
      bearer: { principal: identity.principal },
    },
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(secret);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`session:${secret}`]);
});

test("a bearer of the wrong kind is refused exactly as a bad one of its own kind is", async () => {
  const sessionSide = authorities([], { session: undefined });
  const oidcSide = authorities([], {
    oidc: { authenticated: "InvalidToken" },
  });
  const unknownSession = await threeBearerAuthentication(
    sessionSide.oidc,
    sessionSide.sessions,
    sessionSide.tokens,
  ).authenticateBearer(mintedSecret());
  const badToken = await threeBearerAuthentication(
    oidcSide.oidc,
    oidcSide.sessions,
    oidcSide.tokens,
  ).authenticateBearer("not-a-session-bearer");
  assert.deepEqual(unknownSession, badToken);
  assert.deepEqual(unknownSession, { authenticated: "InvalidToken" });
});

test("a session authority that raised could not decide, and says so", async () => {
  const offered: string[] = [];
  const { oidc, sessions, tokens } = authorities(offered, {
    sessionRaises: true,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
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
    const { oidc, sessions, tokens } = authorities(offered, {
      session: identity,
    });
    const decided = await threeBearerAuthentication(
      oidc,
      sessions,
      tokens,
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
  const { oidc, sessions, tokens } = authorities(offered, {
    session: identity,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(token);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`oidc:${token}`]);
});

/** A secret drawn the way the mint draws one, so the language under test is the real one. */
function drawnToken(): string {
  return `${accessTokenPrefix}${randomBytes(32).toString("base64url")}`;
}

const tokenIdentity: AccessTokenBearerIdentity = {
  partition: identity.partition,
  token: randomUUID(),
  name: "nightly",
  access: "Write",
  principal: asPrincipal("token-maker"),
  expiresAt: "2027-01-01T00:00:00.000Z",
};

test("an access token authorizes as its maker and carries its token, name, access, project and expiry", async () => {
  const offered: string[] = [];
  const token = drawnToken();
  const { oidc, sessions, tokens } = authorities(offered, {
    token: tokenIdentity,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(token);
  assert.deepEqual(decided, {
    authenticated: "Bearer",
    bearer: {
      principal: tokenIdentity.principal,
      viaToken: {
        token: tokenIdentity.token,
        name: tokenIdentity.name,
        access: tokenIdentity.access,
        partition: tokenIdentity.partition,
        expiresAt: tokenIdentity.expiresAt,
      },
    },
  });
  assert.deepEqual(offered, [`token:${token}`]);
});

test("an access token outside the token language is the token's fault, and reaches no authority", async () => {
  for (const token of [
    accessTokenPrefix,
    `${accessTokenPrefix}${"a".repeat(42)}`,
    `${accessTokenPrefix}${"a".repeat(44)}`,
    `${accessTokenPrefix}${"a".repeat(42)}!`,
  ]) {
    assert.equal(accessTokenPattern.test(token), false, token);
    const offered: string[] = [];
    const { oidc, sessions, tokens } = authorities(offered, {
      token: tokenIdentity,
      oidc: {
        authenticated: "Bearer",
        bearer: { principal: identity.principal },
      },
    });
    const decided = await threeBearerAuthentication(
      oidc,
      sessions,
      tokens,
    ).authenticateBearer(token);
    assert.deepEqual(decided, { authenticated: "InvalidToken" }, token);
    assert.deepEqual(offered, [], token);
  }
});

test("an access token the authority does not know is invalid, and never offered to the issuer", async () => {
  const offered: string[] = [];
  const token = drawnToken();
  const { oidc, sessions, tokens } = authorities(offered, {
    token: undefined,
    oidc: {
      authenticated: "Bearer",
      bearer: { principal: identity.principal },
    },
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(token);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`token:${token}`]);
});

test("a token authority that raised could not decide, and says so", async () => {
  const offered: string[] = [];
  const { oidc, sessions, tokens } = authorities(offered, {
    tokenRaises: true,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(drawnToken());
  assert.deepEqual(decided, { authenticated: "AuthorityUnavailable" });
  assert.equal(offered.filter((call) => !call.startsWith("token:")).length, 0);
});

test("a compact JWS goes to the issuer and to no other authority", async () => {
  const offered: string[] = [];
  const keys = await generateKeyPair("RS256", { extractable: true });
  const token = await new SignJWT({ sub: "subject-one" })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
  assert.equal(accessTokenPattern.test(token), false);
  const { oidc, sessions, tokens } = authorities(offered, {
    token: tokenIdentity,
    session: identity,
  });
  await threeBearerAuthentication(oidc, sessions, tokens).authenticateBearer(
    token,
  );
  assert.deepEqual(offered, [`oidc:${token}`]);
});

test("the token prefix is compared exactly, so a case that no mint produces is the issuer's", async () => {
  const offered: string[] = [];
  const token = `${accessTokenPrefix.toUpperCase()}${randomBytes(32).toString("base64url")}`;
  const { oidc, sessions, tokens } = authorities(offered, {
    token: tokenIdentity,
  });
  const decided = await threeBearerAuthentication(
    oidc,
    sessions,
    tokens,
  ).authenticateBearer(token);
  assert.deepEqual(decided, { authenticated: "InvalidToken" });
  assert.deepEqual(offered, [`oidc:${token}`]);
});
