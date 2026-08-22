import assert from "node:assert/strict";
import { test } from "node:test";

import {
  oidcAuthentication,
  oidcPrincipal,
} from "../../src/adapters/http/oidc.ts";

const config = {
  issuer: "https://accounts.example.test",
  audience: "chuggy-web",
  algorithms: ["RS256"],
  discoveryTimeoutMs: 1_000,
  jwksTimeoutMs: 1_000,
};

test("principal identity is collision-free across issuer and subject", () => {
  assert.notEqual(
    oidcPrincipal("https://one.example", "/subject"),
    oidcPrincipal("https://one.example/", "subject"),
  );
  assert.equal(
    oidcPrincipal("https://one.example", "subject"),
    oidcPrincipal("https://one.example", "subject"),
  );
});

test("OIDC discovery is issuer-pinned and bounded", async () => {
  let signal: AbortSignal | undefined;
  const authentication = await oidcAuthentication(config, (input, init) => {
    assert.ok(input instanceof URL);
    assert.equal(
      input.href,
      "https://accounts.example.test/.well-known/openid-configuration",
    );
    signal = init?.signal ?? undefined;
    return Promise.resolve(
      Response.json({
        issuer: config.issuer,
        jwks_uri: "https://accounts.example.test/jwks",
      }),
    );
  });
  assert.ok(signal !== undefined);
  assert.equal(typeof authentication.authenticateBearer, "function");
});

test("OIDC refuses insecure endpoints and discovery substitution", async () => {
  await assert.rejects(() =>
    oidcAuthentication({ ...config, issuer: "http://issuer.example" }),
  );
  await assert.rejects(() =>
    oidcAuthentication(config, () =>
      Promise.resolve(
        Response.json({
          issuer: "https://attacker.example",
          jwks_uri: "https://attacker.example/jwks",
        }),
      ),
    ),
  );
});
