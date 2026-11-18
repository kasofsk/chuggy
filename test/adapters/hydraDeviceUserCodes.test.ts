/**
 * A device's code handed to Hydra's admin API: the request it is sent as, and
 * each answer read by its status, a redirect off the issuer's origin, a body
 * past its bound and a call that never answers each a fault.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { hydraDeviceUserCodes } from "../../src/adapters/hydra/deviceUserCodes.ts";
import { hydraResponseBytesMax } from "../../src/adapters/hydra/oauthClients.ts";

const settings = {
  adminUrl: "https://hydra-admin.invalid/",
  issuer: "https://auth.invalid/",
  requestTimeoutMs: 1_000,
};

const redirectTo =
  "https://auth.invalid/oauth2/auth?client_id=machine&device_verifier=v";

function accepting(answer: () => Promise<Response>) {
  return hydraDeviceUserCodes(settings, answer).accept("a-challenge", "BCDF");
}

test("the code is put to the device acceptance under the challenge in its query", async () => {
  let asked: { url: string; method: string; body: unknown } | undefined;
  const answered = await hydraDeviceUserCodes(settings, (input, init) => {
    asked = {
      url: (input as URL).href,
      method: init?.method ?? "",
      body: JSON.parse(init?.body as string) as unknown,
    };
    return Promise.resolve(Response.json({ redirect_to: redirectTo }));
  }).accept("a+challenge/=", "BCDFGHJK");
  assert.deepEqual(answered, { answer: "Accepted", redirectTo });
  assert.equal(
    asked?.url,
    "https://hydra-admin.invalid/admin/oauth2/auth/requests/device/accept?device_challenge=a%2Bchallenge%2F%3D",
  );
  assert.equal(asked?.method, "PUT");
  assert.deepEqual(asked?.body, { user_code: "BCDFGHJK" });
});

for (const [status, answer] of [
  [400, "CodeRefused"],
  [401, "LinkExpired"],
  [404, "LinkExpired"],
  [409, "Unavailable"],
  [500, "Unavailable"],
] as const)
  test(`a ${String(status)} is read as ${answer}`, async () => {
    assert.deepEqual(
      await accepting(() =>
        Promise.resolve(
          Response.json({ error: "invalid_request" }, { status }),
        ),
      ),
      { answer },
    );
  });

for (const [why, answer] of [
  [
    "a redirect off the issuer's origin",
    () =>
      Promise.resolve(
        Response.json({ redirect_to: "https://elsewhere.invalid/oauth2/auth" }),
      ),
  ],
  ["a success naming no redirect", () => Promise.resolve(Response.json({}))],
  ["a success that is not JSON", () => Promise.resolve(new Response("{"))],
  [
    "an answer past its bound",
    () => Promise.resolve(new Response("x".repeat(hydraResponseBytesMax + 1))),
  ],
  [
    "a connection that did not open",
    () => Promise.reject(new Error("connection refused")),
  ],
] as const)
  test(`${why} is a fault`, async () => {
    assert.deepEqual(await accepting(answer), { answer: "Unavailable" });
  });

test("a call that is never answered is a fault once its timeout passes", async () => {
  const answered = await hydraDeviceUserCodes(
    { ...settings, requestTimeoutMs: 1 },
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      }),
  ).accept("a-challenge", "BCDF");
  assert.deepEqual(answered, { answer: "Unavailable" });
});

for (const [why, broken] of [
  ["an admin address that is not HTTP", { adminUrl: "ftp://hydra.invalid/" }],
  ["an issuer with no origin", { issuer: "urn:issuer" }],
  ["a timeout that is not positive", { requestTimeoutMs: 0 }],
] as const)
  test(`${why} refuses the composition`, () => {
    assert.throws(
      () => hydraDeviceUserCodes({ ...settings, ...broken }),
      RangeError,
    );
  });
