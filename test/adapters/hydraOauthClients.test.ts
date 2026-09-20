import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hydraResponseBytesMax,
  hydraWorkerPoolClients,
} from "../../src/adapters/hydra/oauthClients.ts";

const settings = {
  adminUrl: "https://issuer.invalid/",
  audience: "chuggy-api",
  requestTimeoutMs: 1_000,
};

/**
 * Captured from Ory Hydra's own answer to a client creation, and edited only
 * into TypeScript syntax and onto this tree's values.
 */
const hydraCreated = {
  client_id: "chuggy-pool-one",
  client_name: "chuggy-pool-one",
  client_secret: "a-secret-hydra-drew",
  client_secret_expires_at: 0,
  created_at: "2026-09-18T00:00:00Z",
  grant_types: ["client_credentials"],
  audience: ["chuggy-api"],
  token_endpoint_auth_method: "client_secret_basic",
  scope: "",
  subject_type: "public",
};

test("a pool's client is created with one grant, the API's audience and no redirect", async () => {
  let asked: { url: string; method: string; body: unknown } | undefined;
  const minted = await hydraWorkerPoolClients(settings, (input, init) => {
    asked = {
      url: (input as URL).href,
      method: init?.method ?? "",
      body: JSON.parse(init?.body as string) as unknown,
    };
    return Promise.resolve(Response.json(hydraCreated, { status: 201 }));
  }).create("chuggy-pool-one");
  assert.deepEqual(minted, {
    clientId: "chuggy-pool-one",
    clientSecret: "a-secret-hydra-drew",
  });
  assert.equal(asked?.url, "https://issuer.invalid/admin/clients");
  assert.equal(asked?.method, "POST");
  assert.deepEqual(asked?.body, {
    client_id: "chuggy-pool-one",
    client_name: "chuggy-pool-one",
    grant_types: ["client_credentials"],
    response_types: [],
    audience: ["chuggy-api"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: "",
  });
});

test("a client is removed by the id it was created under", async () => {
  let asked: { url: string; method: string } | undefined;
  await hydraWorkerPoolClients(settings, (input, init) => {
    asked = { url: (input as URL).href, method: init?.method ?? "" };
    return Promise.resolve(new Response(null, { status: 204 }));
  }).remove("chuggy-pool one");
  assert.equal(
    asked?.url,
    "https://issuer.invalid/admin/clients/chuggy-pool%20one",
  );
  assert.equal(asked?.method, "DELETE");
});

test("a client the issuer no longer holds is already removed", async () => {
  await hydraWorkerPoolClients(settings, () =>
    Promise.resolve(Response.json({ error: "Not Found" }, { status: 404 })),
  ).remove("chuggy-pool-gone");
});

test("a removal the issuer refused for any other reason is a fault", async () => {
  await assert.rejects(
    hydraWorkerPoolClients(settings, () =>
      Promise.resolve(new Response("nope", { status: 500 })),
    ).remove("chuggy-pool-one"),
    { name: "WorkerPoolClientUnavailable" },
  );
});

for (const [why, answering] of [
  [
    "a status this side did not ask for",
    () => Promise.resolve(new Response("nope", { status: 500 })),
  ],
  [
    "a body that is not JSON",
    () => Promise.resolve(new Response("{", { status: 201 })),
  ],
  [
    "a created client carrying no secret",
    () =>
      Promise.resolve(
        Response.json({ client_id: "chuggy-pool-one" }, { status: 201 }),
      ),
  ],
  [
    "a connection that did not open",
    () => Promise.reject(new Error("connection refused")),
  ],
] as const)
  test(`${why} is a fault and never a refusal`, async () => {
    await assert.rejects(
      hydraWorkerPoolClients(settings, answering).create("chuggy-pool-one"),
      { name: "WorkerPoolClientUnavailable" },
    );
  });

test("an answer past its bound is refused rather than read", async () => {
  const oversized = "x".repeat(hydraResponseBytesMax + 1);
  await assert.rejects(
    hydraWorkerPoolClients(settings, () =>
      Promise.resolve(new Response(oversized, { status: 201 })),
    ).create("chuggy-pool-one"),
    { name: "WorkerPoolClientUnavailable" },
  );
});

for (const [why, broken] of [
  ["an admin address that is not HTTP", { adminUrl: "ftp://issuer.invalid/" }],
  [
    "an admin address carrying a credential",
    { adminUrl: "https://who:what@issuer.invalid/" },
  ],
  ["an empty audience", { audience: "" }],
  ["a timeout that is not positive", { requestTimeoutMs: 0 }],
] as const)
  test(`${why} refuses the composition`, () => {
    assert.throws(
      () => hydraWorkerPoolClients({ ...settings, ...broken }),
      RangeError,
    );
  });
