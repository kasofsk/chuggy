/**
 * The authorization code flow the console builds, checked as data.
 *
 * The audience parameter has its own case: without it the access token comes
 * back with an empty audience and every API read answers 401, which is a
 * failure no other assertion here would catch.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeUrl,
  discoveryUrl,
  identityLabel,
  parseCallback,
  parseConfiguration,
  parseDiscovery,
  parseTokenResponse,
  sessionExpiresAtMs,
  sessionNeedsRefresh,
  sessionRefreshSecondsBefore,
  tokenExchangeRequest,
  tokenRefreshRequest,
} from "../../ui/console/app/authorization.js";
import {
  base64urlDecoded,
  base64urlEncoded,
} from "../../ui/console/app/encoding.js";
import {
  challengeFromVerifier,
  challengeMethod,
  verifierBytesCount,
  verifierFromBytes,
} from "../../ui/console/app/pkce.js";

const declared = {
  issuer: "https://auth.vteng.io/",
  clientId: "chuggy-web",
  audience: "https://chuggy.vteng.io/api",
  redirectUri: "https://chuggy.vteng.io/auth/callback",
  scopes: ["openid", "offline_access"],
};

const configuration = parseConfiguration(declared);

const endpoints = parseDiscovery(configuration, {
  issuer: "https://auth.vteng.io",
  authorization_endpoint: "https://auth.vteng.io/oauth2/auth",
  token_endpoint: "https://auth.vteng.io/oauth2/token",
});

test("base64url survives a round trip and pads nothing", () => {
  const bytes = Uint8Array.from([0, 1, 250, 255, 128, 64, 7]);
  assert.deepEqual([...base64urlDecoded(base64urlEncoded(bytes))], [...bytes]);
  assert.equal(base64urlEncoded(Uint8Array.from([255, 255, 255])), "____");
  assert.ok(!base64urlEncoded(bytes).includes("="));
  assert.throws(() => base64urlDecoded("not+base64url"), RangeError);
});

test("a verifier is the fixed byte count, and the challenge is S256 over it", async () => {
  const verifier = verifierFromBytes(
    new Uint8Array(verifierBytesCount).fill(1),
  );
  assert.equal(challengeMethod, "S256");
  assert.equal(
    await challengeFromVerifier(verifier),
    base64urlEncoded(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  );
  assert.throws(() => verifierFromBytes(new Uint8Array(8)), RangeError);
});

test("the configuration is read strictly and its issuer is normalised", () => {
  assert.equal(configuration.issuer, "https://auth.vteng.io");
  assert.equal(
    discoveryUrl(configuration),
    "https://auth.vteng.io/.well-known/openid-configuration",
  );
  assert.throws(
    () => parseConfiguration({ ...declared, clientId: "" }),
    TypeError,
  );
  assert.throws(
    () => parseConfiguration({ ...declared, scopes: "openid" }),
    TypeError,
  );
});

test("a discovery document naming another issuer is refused", () => {
  assert.throws(
    () =>
      parseDiscovery(configuration, {
        issuer: "https://elsewhere.example",
        authorization_endpoint: "https://elsewhere.example/auth",
        token_endpoint: "https://elsewhere.example/token",
      }),
    TypeError,
  );
});

test("the authorize request carries the audience, the challenge and the state", () => {
  const url = new URL(
    authorizeUrl(configuration, endpoints, {
      state: "state-1",
      verifier: "verifier-1",
      challenge: "challenge-1",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://auth.vteng.io/oauth2/auth");
  assert.equal(url.searchParams.get("audience"), declared.audience);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), declared.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), declared.redirectUri);
  assert.equal(url.searchParams.get("scope"), "openid offline_access");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_verifier"), null);
});

test("a callback is a code, a refusal, or neither", () => {
  assert.deepEqual(parseCallback("?code=c1&state=s1"), {
    result: "Code",
    code: "c1",
    state: "s1",
  });
  assert.deepEqual(parseCallback("?error=access_denied&error_description=no"), {
    result: "Denied",
    code: "access_denied",
    description: "no",
  });
  assert.deepEqual(parseCallback("?code=c1"), { result: "Absent" });
  assert.deepEqual(parseCallback(""), { result: "Absent" });
});

test("the exchange sends the verifier and the refresh sends the token", () => {
  const exchange = tokenExchangeRequest(configuration, endpoints, {
    code: "c1",
    verifier: "v1",
  });
  assert.equal(exchange.url, "https://auth.vteng.io/oauth2/token");
  assert.equal(
    exchange.headers["content-type"],
    "application/x-www-form-urlencoded",
  );
  const sent = new URLSearchParams(exchange.body);
  assert.equal(sent.get("grant_type"), "authorization_code");
  assert.equal(sent.get("code_verifier"), "v1");
  assert.equal(sent.get("redirect_uri"), declared.redirectUri);
  const refreshed = new URLSearchParams(
    tokenRefreshRequest(configuration, endpoints, "r1").body,
  );
  assert.equal(refreshed.get("grant_type"), "refresh_token");
  assert.equal(refreshed.get("refresh_token"), "r1");
});

test("a token response with no stated lifetime has already run out", () => {
  const token = parseTokenResponse({
    access_token: "a1",
    token_type: "bearer",
  });
  assert.equal(token.expiresInSeconds, 0);
  assert.equal(
    sessionNeedsRefresh(0, sessionExpiresAtMs(0, token.expiresInSeconds)),
    true,
  );
  assert.throws(() => parseTokenResponse({ token_type: "bearer" }), TypeError);
});

test("a session is refreshed before it expires, not after", () => {
  const expiresAtMs = sessionExpiresAtMs(0, 3_600);
  assert.equal(sessionNeedsRefresh(0, expiresAtMs), false);
  assert.equal(
    sessionNeedsRefresh(
      expiresAtMs - sessionRefreshSecondsBefore * 1_000,
      expiresAtMs,
    ),
    true,
  );
});

test("the identity label prefers the most human claim the token carries", () => {
  const claims = (payload: unknown) =>
    `header.${base64urlEncoded(new TextEncoder().encode(JSON.stringify(payload)))}.signature`;
  assert.equal(identityLabel(claims({ sub: "s1" })), "s1");
  assert.equal(identityLabel(claims({ sub: "s1", email: "a@b.c" })), "a@b.c");
  assert.equal(identityLabel(claims({})), undefined);
  assert.equal(identityLabel("not-a-token"), undefined);
});
