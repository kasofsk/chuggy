/**
 * The credential source over the native API's minting route: the one request it
 * makes, what every answer comes to, and what a held token spares.
 *
 * THE TRANSPORT IS THE RECORDER TWO FORGE SUITES ALREADY USE, so a redirect is
 * refused here for the reason it is refused there and a case asserting no
 * request is asserting over the same recorder.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { remoteRepositoryCredentials } from "../../src/adapters/http/remoteRepositoryCredentials.ts";
import type { AccessTokenSource } from "../../src/adapters/http/accessToken.ts";
import {
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { fixtureForge, type ForgeRecorder } from "./forgeFixtures.ts";

const fixtureToken = "ghs-minted-q4w5e6";
const fixtureBearer = "bearer-h1j2k3";
const fixtureBaseUrl = "https://api.chuggy.invalid";

/** The instant a minted token stops working, far enough ahead that a case holds it. */
const fixtureExpiresAtMs = Date.parse("2099-09-10T12:00:00Z");

const fixtureBinding = {
  partition: {
    tenant: asTenantId("vteng"),
    project: asProjectId("chuggy"),
  },
  repository: asRepositoryId("https://github.com/kasofsk/chuggy"),
  recoveryEpoch: "epoch",
} as unknown as RepositoryBinding;

/** The bearer this suite presents, recording every token reported as spent. */
function fixtureAccessToken(spent: string[] = []): AccessTokenSource {
  return {
    token: () => Promise.resolve(fixtureBearer),
    invalidate: (refused) => spent.push(refused),
  };
}

function fixtureSource(
  recorder: ForgeRecorder,
  accessToken: AccessTokenSource = fixtureAccessToken(),
  currentTimeEpochMs?: () => number,
) {
  return remoteRepositoryCredentials(
    {
      baseUrl: fixtureBaseUrl,
      accessToken,
      permissions: "write",
      requestTimeoutMs: 5_000,
      responseBytesMax: 65_536,
      responseReadsMax: 16,
      tokenMarginMs: 60_000,
      cachedTokensMax: 2,
      ...(currentTimeEpochMs === undefined ? {} : { currentTimeEpochMs }),
    },
    recorder.requestFetch,
  );
}

function fixtureGranted(overrides: Readonly<Record<string, unknown>> = {}) {
  return Response.json(
    { token: fixtureToken, expiresAtMs: fixtureExpiresAtMs, ...overrides },
    { status: 200 },
  );
}

test("one credential is one bounded request naming the project and the repository", async () => {
  const recorder = fixtureForge([fixtureGranted()]);
  assert.deepEqual(await fixtureSource(recorder).credential(fixtureBinding), {
    resolved: "Credential",
    credential: fixtureToken,
  });
  const call = recorder.calls[0];
  assert.equal(
    call?.url,
    `${fixtureBaseUrl}/api/v1/tenants/vteng/projects/chuggy/forge-credentials`,
  );
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "error");
  assert.equal(call.headers["authorization"], `Bearer ${fixtureBearer}`);
  assert.equal(call.headers["content-type"], "application/vnd.chuggy.v1+json");
  assert.deepEqual(JSON.parse(call.body ?? ""), {
    repository: "https://github.com/kasofsk/chuggy",
    permissions: "write",
  });
});

test("the route's own refusal is settled and every other answer is a wait", async () => {
  for (const [status, resolved] of [
    [404, "Denied"],
    [400, "Unavailable"],
    [403, "Unavailable"],
    [500, "Unavailable"],
    [503, "Unavailable"],
  ] as const) {
    const recorder = fixtureForge([new Response("{}", { status })]);
    assert.deepEqual(
      await fixtureSource(recorder).credential(fixtureBinding),
      { resolved },
      String(status),
    );
  }
});

test("a bearer the API rejected is reported as spent before the wait", async () => {
  const spent: string[] = [];
  const recorder = fixtureForge([new Response("{}", { status: 401 })]);
  assert.deepEqual(
    await fixtureSource(recorder, fixtureAccessToken(spent)).credential(
      fixtureBinding,
    ),
    { resolved: "Unavailable" },
  );
  assert.deepEqual(spent, [fixtureBearer]);
});

test("a fault and an answer this side cannot read are both a wait", async () => {
  const answers: readonly (Response | Error)[] = [
    new TypeError("the network went away"),
    new Response("", {
      status: 302,
      headers: { location: "https://elsewhere.invalid/" },
    }),
    new Response("{", { status: 200 }),
    Response.json({ token: fixtureToken }, { status: 200 }),
    Response.json(
      { token: "", expiresAtMs: fixtureExpiresAtMs },
      { status: 200 },
    ),
  ];
  for (const answer of answers) {
    const recorder = fixtureForge([answer]);
    assert.deepEqual(
      await fixtureSource(recorder).credential(fixtureBinding),
      { resolved: "Unavailable" },
      String(answer instanceof Error ? answer.message : answer.status),
    );
  }
});

test("a held token is handed out again until its own expiry and asked for again after it", async () => {
  let currentMs = Date.parse("2026-09-10T11:00:00Z");
  const recorder = fixtureForge([fixtureGranted(), fixtureGranted()]);
  const source = fixtureSource(recorder, fixtureAccessToken(), () => currentMs);
  await source.credential(fixtureBinding);
  await source.credential(fixtureBinding);
  assert.equal(recorder.calls.length, 1, "a held token makes no request");
  currentMs = fixtureExpiresAtMs;
  await source.credential(fixtureBinding);
  assert.equal(recorder.calls.length, 2, "an expired token is asked for again");
});

test("each project's repository is its own held token", async () => {
  const recorder = fixtureForge([fixtureGranted(), fixtureGranted()]);
  const source = fixtureSource(recorder);
  await source.credential(fixtureBinding);
  await source.credential({
    ...fixtureBinding,
    repository: asRepositoryId("https://github.com/kasofsk/other"),
  });
  assert.equal(recorder.calls.length, 2);
});

test("a bound no composition could serve is refused where it is composed", () => {
  const recorder = fixtureForge([]);
  assert.throws(
    () =>
      remoteRepositoryCredentials(
        {
          baseUrl: fixtureBaseUrl,
          accessToken: fixtureAccessToken(),
          permissions: "read",
          requestTimeoutMs: 0,
          responseBytesMax: 1,
          responseReadsMax: 1,
          tokenMarginMs: 1,
          cachedTokensMax: 1,
        },
        recorder.requestFetch,
      ),
    /remote credential request timeout/u,
  );
});
