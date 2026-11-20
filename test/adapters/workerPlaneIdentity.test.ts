/**
 * The worker plane's identity routes: each tenant's discovery document and the
 * key set, served without a bearer only where the plane holds an issuer, under
 * the base URL's own path, and never in place of a route that needs a bearer.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { createLocalJWKSet, jwtVerify } from "jose";

import {
  jobIdentityKeyBitsMin,
  jobIdentitySigner,
} from "../../src/adapters/crypto/jobIdentitySigner.ts";
import {
  createWorkerPlaneApp,
  workerIdentityDocumentsCacheSecs,
  workerIdentityRoutes,
  workerPlaneHealthRoutes,
} from "../../src/adapters/http/workerPlaneServer.ts";
import { workerPlaneUploadBytesMax } from "../../src/contract/http.ts";
import { workerPlaneRoutes } from "../../src/contract/workerPlane.ts";
import {
  jobIdentityIssuerCharsMax,
  type JobIdentitySigner,
} from "../../src/interpreter/jobIdentityToken.ts";
import { routerServed } from "./routerFixtures.ts";
import { inertWorkerPlane } from "./workerPlaneFixtures.ts";

function rsaPem(): string {
  return generateKeyPairSync("rsa", { modulusLength: jobIdentityKeyBitsMin })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
}

const pems = [rsaPem(), rsaPem()];

async function signer(keys: readonly string[]): Promise<JobIdentitySigner> {
  const built = await jobIdentitySigner(keys);
  assert.equal(built.result, "Built");
  return built.signer;
}

const twoKeys = await signer(pems);

function plane(issuerBaseUrl?: string, held: JobIdentitySigner = twoKeys) {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(workerPlaneUploadBytesMax),
    ...(issuerBaseUrl === undefined
      ? {}
      : { identity: { issuerBaseUrl, signer: held } }),
  });
}

const base = "https://identity.example/chuggy/v1";

test("each route answers without a bearer, its discovery document naming the tenant's issuer and the key set's own address", async () => {
  const app = plane(base);
  const discovery = await app.inject({
    method: "GET",
    url: "/chuggy/v1/acme/.well-known/openid-configuration",
  });
  assert.equal(discovery.statusCode, 200);
  assert.match(
    String(discovery.headers["content-type"]),
    /^application\/json/u,
  );
  assert.equal(
    discovery.headers["cache-control"],
    `public, max-age=${String(workerIdentityDocumentsCacheSecs)}`,
  );
  const document = discovery.json<{ issuer: string; jwks_uri: string }>();
  assert.equal(document.issuer, `${base}/acme`);
  assert.equal(document.jwks_uri, `${base}/acme/jwks`);

  const keySet = await app.inject({
    method: "GET",
    url: new URL(document.jwks_uri).pathname,
  });
  assert.equal(keySet.statusCode, 200);
  assert.match(String(keySet.headers["content-type"]), /^application\/json/u);
  assert.equal(
    keySet.headers["cache-control"],
    `public, max-age=${String(workerIdentityDocumentsCacheSecs)}`,
  );
  assert.deepEqual(keySet.json(), twoKeys.keySet());
  await app.close();
});

test("a token the plane's signer signs verifies against the served key set by its kid", async () => {
  const app = plane(base);
  const served = (
    await app.inject({ method: "GET", url: "/chuggy/v1/acme/jwks" })
  ).json<{ keys: [] }>();
  const iat = 1_800_000_000;
  const token = await twoKeys.sign({
    iss: `${base}/acme`,
    sub: "subject",
    aud: "audience",
    iat,
    exp: iat + 60,
  });
  const { protectedHeader } = await jwtVerify(
    token,
    createLocalJWKSet(served),
    { algorithms: ["RS256"], currentDate: new Date((iat + 1) * 1000) },
  );
  assert.equal(protectedHeader.kid, twoKeys.keySet().keys[0]?.kid);
  await app.close();
});

test("with two key files both keys are served, and with one only the one", async () => {
  for (const [held, count] of [
    [twoKeys, 2],
    [await signer(pems.slice(0, 1)), 1],
  ] as const) {
    const app = plane(base, held);
    const served = (
      await app.inject({ method: "GET", url: "/chuggy/v1/acme/jwks" })
    ).json<{ keys: readonly { kid: string }[] }>();
    assert.equal(served.keys.length, count);
    assert.equal(new Set(served.keys.map(({ kid }) => kid)).size, count);
    await app.close();
  }
});

test("a base URL without a path serves at the root, and one with a path only under it", async () => {
  for (const [issuerBaseUrl, served, unserved] of [
    ["https://identity.example", "/acme/jwks", "/chuggy/v1/acme/jwks"],
    [base, "/chuggy/v1/acme/jwks", "/acme/jwks"],
  ] as const) {
    const app = plane(issuerBaseUrl);
    assert.equal(
      (await app.inject({ method: "GET", url: served })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: unserved })).statusCode,
      404,
    );
    const document = (
      await app.inject({
        method: "GET",
        url: served.replace(/jwks$/u, ".well-known/openid-configuration"),
      })
    ).json<{ issuer: string }>();
    assert.equal(document.issuer, `${issuerBaseUrl}/acme`);
    await app.close();
  }
});

test("the longest tenant an issuer holds is answered, and a tenant the issuer function refuses is not found", async () => {
  const app = plane(base);
  const longest = "x".repeat(jobIdentityIssuerCharsMax - base.length - 1);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/chuggy/v1/${longest}/.well-known/openid-configuration`,
      })
    ).json<{ issuer: string }>().issuer,
    `${base}/${longest}`,
  );
  for (const tenant of [
    "ac%20me",
    "ac%2Fme",
    "%C3%A9",
    `${longest}x`,
    "x".repeat(jobIdentityIssuerCharsMax),
  ])
    for (const document of ["jwks", ".well-known/openid-configuration"])
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: `/chuggy/v1/${tenant}/${document}`,
          })
        ).statusCode,
        404,
        `${tenant} ${document}`,
      );
  await app.close();
});

test("neither path is served to a POST", async () => {
  const app = plane(base);
  for (const document of ["jwks", ".well-known/openid-configuration"])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/chuggy/v1/acme/${document}`,
        })
      ).statusCode,
      404,
      document,
    );
  await app.close();
});

test("without an issuer neither path is served", async () => {
  const app = plane();
  for (const url of [
    "/acme/jwks",
    "/acme/.well-known/openid-configuration",
    "/chuggy/v1/acme/jwks",
    "/chuggy/v1/acme/.well-known/openid-configuration",
  ])
    assert.equal(
      (await app.inject({ method: "GET", url })).statusCode,
      404,
      url,
    );
  await app.close();
});

test("an issuer adds only its two GET routes, and every contract route still asks for a bearer", async () => {
  for (const issuerBaseUrl of ["https://identity.example", base]) {
    const app = plane(issuerBaseUrl);
    await app.ready();
    const without = plane();
    await without.ready();
    const identityRoutes = Object.values(
      workerIdentityRoutes(issuerBaseUrl),
    ).flatMap(({ path }) => [`GET ${path}`, `HEAD ${path}`]);
    assert.deepEqual(
      routerServed(app),
      [...routerServed(without), ...identityRoutes].sort(),
    );
    for (const { method, path } of Object.values(workerPlaneRoutes)) {
      const url = path.replace(/:[^/]+/gu, "acme");
      const [held, bare] = await Promise.all(
        [app, without].map((each) => each.inject({ method, url })),
      );
      assert.equal(held?.statusCode, bare?.statusCode, `${method} ${path}`);
      assert.equal(held?.statusCode, 401, `${method} ${path}`);
    }
    for (const { method, path } of Object.values(workerPlaneHealthRoutes))
      assert.equal(
        (await app.inject({ method, url: path })).statusCode,
        200,
        path,
      );
    await app.close();
    await without.close();
  }
});
