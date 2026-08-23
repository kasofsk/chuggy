import assert from "node:assert/strict";
import { test } from "node:test";

import { oidcAuthentication } from "../../src/adapters/http/oidc.ts";

const config = {
  issuer: "https://accounts.example.test",
  audience: "chuggy-web",
  algorithms: ["RS256"],
  discoveryTimeoutMs: 1_000,
  jwksTimeoutMs: 1_000,
};

/**
 * Captured verbatim from the Ory Hydra deployment this API authenticates
 * against, and edited only into TypeScript syntax.
 */
const hydraDiscovery = {
  authorization_endpoint: "https://auth.vteng.io/oauth2/auth",
  backchannel_logout_session_supported: true,
  backchannel_logout_supported: true,
  claims_parameter_supported: false,
  claims_supported: ["sub"],
  code_challenge_methods_supported: ["plain", "S256"],
  credentials_endpoint_draft_00: "https://auth.vteng.io/credentials",
  credentials_supported_draft_00: [
    {
      cryptographic_binding_methods_supported: ["jwk"],
      cryptographic_suites_supported: [
        "PS256",
        "RS256",
        "ES256",
        "PS384",
        "RS384",
        "ES384",
        "PS512",
        "RS512",
        "ES512",
        "EdDSA",
      ],
      format: "jwt_vc_json",
      types: ["VerifiableCredential", "UserInfoCredential"],
    },
  ],
  device_authorization_endpoint: "https://auth.vteng.io/oauth2/device/auth",
  end_session_endpoint: "https://auth.vteng.io/oauth2/sessions/logout",
  frontchannel_logout_session_supported: true,
  frontchannel_logout_supported: true,
  grant_types_supported: [
    "authorization_code",
    "implicit",
    "client_credentials",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
  ],
  id_token_signed_response_alg: ["RS256"],
  id_token_signing_alg_values_supported: ["RS256"],
  issuer: "https://auth.vteng.io",
  jwks_uri: "https://auth.vteng.io/.well-known/jwks.json",
  request_object_signing_alg_values_supported: ["none", "RS256", "ES256"],
  request_parameter_supported: true,
  request_uri_parameter_supported: true,
  require_request_uri_registration: true,
  response_modes_supported: ["query", "fragment", "form_post"],
  response_types_supported: [
    "code",
    "code id_token",
    "id_token",
    "token id_token",
    "token",
    "token id_token code",
  ],
  revocation_endpoint: "https://auth.vteng.io/oauth2/revoke",
  scopes_supported: ["offline_access", "offline", "openid"],
  subject_types_supported: ["public"],
  token_endpoint: "https://auth.vteng.io/oauth2/token",
  token_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
    "private_key_jwt",
    "none",
  ],
  userinfo_endpoint: "https://auth.vteng.io/userinfo",
  userinfo_signed_response_alg: ["RS256"],
  userinfo_signing_alg_values_supported: ["none", "RS256"],
};

/** Captured verbatim from Google, a second provider with a different member set. */
const googleDiscovery = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  device_authorization_endpoint: "https://oauth2.googleapis.com/device/code",
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  revocation_endpoint: "https://oauth2.googleapis.com/revoke",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  response_types_supported: [
    "code",
    "token",
    "id_token",
    "code token",
    "code id_token",
    "token id_token",
    "code token id_token",
    "none",
  ],
  response_modes_supported: ["query", "fragment", "form_post"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "email", "profile"],
  token_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
  ],
  claims_supported: [
    "aud",
    "email",
    "email_verified",
    "exp",
    "family_name",
    "given_name",
    "iat",
    "iss",
    "name",
    "picture",
    "sub",
  ],
  code_challenge_methods_supported: ["plain", "S256"],
  grant_types_supported: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  ],
  authorization_response_iss_parameter_supported: true,
};

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

test("OIDC discovery ignores the members a real provider adds", async () => {
  for (const document of [hydraDiscovery, googleDiscovery]) {
    const authentication = await oidcAuthentication(
      { ...config, issuer: document.issuer },
      () => Promise.resolve(Response.json(document)),
    );
    assert.equal(typeof authentication.authenticateBearer, "function");
  }
});

test("OIDC discovery still requires the members it reads", async () => {
  await assert.rejects(() =>
    oidcAuthentication(config, () =>
      Promise.resolve(Response.json({ issuer: config.issuer })),
    ),
  );
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
  await assert.rejects(
    () =>
      oidcAuthentication(config, () =>
        Promise.resolve(Response.json(hydraDiscovery)),
      ),
    /different issuer/u,
  );
  await assert.rejects(() =>
    oidcAuthentication(config, () =>
      Promise.resolve(
        Response.json({
          issuer: config.issuer,
          jwks_uri: "http://accounts.example.test/jwks",
        }),
      ),
    ),
  );
  await assert.rejects(() =>
    oidcAuthentication(config, () =>
      Promise.resolve(
        Response.json({
          issuer: config.issuer,
          jwks_uri: "https://user:secret@accounts.example.test/jwks",
        }),
      ),
    ),
  );
});

test("OIDC discovery treats an unsuccessful response as a failure", async () => {
  await assert.rejects(() =>
    oidcAuthentication(config, () =>
      Promise.resolve(new Response("", { status: 500 })),
    ),
  );
});
