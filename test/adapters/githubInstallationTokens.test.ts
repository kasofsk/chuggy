/**
 * The mint against a recording forge: what the app's own JWT claims, what one
 * request carries, what every way of not being answered comes to, what a
 * second mint inside a token's life does not do, and when a token the forge has
 * just made is answered.
 *
 * THE JWT IS VERIFIED RATHER THAN INSPECTED. A suite that read the payload
 * would pass on a signature no forge accepts, so every case that is about the
 * assertion verifies it with the public half of a key pair generated here.
 *
 * BOTH PEM ENCODINGS ARE PROVED. GitHub issues an app's key as PKCS#1 and a key
 * converted by hand is PKCS#8, and a suite proving one would leave the other to
 * be discovered by the forge refusing a signature.
 *
 * THE TOKEN IS A SENTINEL AND SO IS THE KEY. Neither is a value any other
 * fixture string contains, so a case can assert the token reaches the caller
 * and that neither of them stands in anything that was sent.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { jwtVerify, decodeProtectedHeader } from "jose";

import {
  githubInstallationTokens,
  githubInstallationTokensDefaults,
  githubInstallationTokensPrecondition,
  githubInstallationTokensSettled,
} from "../../src/adapters/forge/githubInstallationTokens.ts";
import {
  allForgePermissionSets,
  asForgeAccount,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import { finalizerIdentityCharsMax } from "../../src/interpreter/finalizer.ts";
import {
  fixtureForge,
  fixtureForgeShapedToken,
  type ForgeRecorder,
} from "./forgeFixtures.ts";

/** The minted token, which must reach the caller and appear in nothing sent. */
const fixtureToken = "ghs-minted-q4w5e6";

const fixtureAppId = "4708055";
const fixtureApiUrl = "https://forge.invalid";
const fixtureInstallationId = "156333284";
const fixtureExpiry = "2099-09-10T12:00:00Z";

/** The app's key pair, generated once because generating one is the slow part. */
const fixtureKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** A bound no PEM fits in, so a case can tell a refusal from a short read. */
const fixtureShortKeyBound = 64;

/**
 * How far before its own expiry a held token stops being handed out. The case
 * that observes it names it here rather than reading the adapter's own default,
 * so a default narrowed to nothing is a case that fails rather than a case that
 * narrows with it.
 */
const fixtureMarginMs = 60_000;

/** The longest an app's JWT may live past its own issuance, which the forge enforces. */
const fixtureJwtLifetimeSecsMax = 600;

const millisecondsPerSecond = 1_000;

/** A clock this suite moves by hand, so no case waits and none depends on the machine's. */
function fixtureClock(startMs: number): {
  readonly now: () => number;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function directory(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-forge-key-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

/** The app's key on disk, in whichever PEM encoding the case is about. */
/**
 * Whether a value stands anywhere in what the forge was sent. The recorded
 * calls are compared as the JSON they serialise to, so the needle is escaped
 * the same way the haystack was: a PEM's own newlines are not what a request
 * carrying it would show.
 */
function fixtureSent(recorder: ForgeRecorder, value: string): boolean {
  return JSON.stringify(recorder.calls).includes(
    JSON.stringify(value).slice(1, -1),
  );
}

/** The app's key in one PEM encoding, which is what a request must not carry. */
function fixturePrivateKeyPem(type: "pkcs1" | "pkcs8"): string {
  return fixtureKeyPair.privateKey.export({ type, format: "pem" }).toString();
}

function fixtureKeyFile(t: TestContext, type: "pkcs1" | "pkcs8"): string {
  const path = join(directory(t), "app.pem");
  writeFileSync(path, fixturePrivateKeyPem(type));
  return path;
}

function fixtureRequest(
  overrides: Partial<ForgeTokenRequest> = {},
): ForgeTokenRequest {
  return {
    installation: {
      forge: asForgeId("github"),
      app: "portal",
      account: asForgeAccount("kasofsk"),
      installationId: asForgeInstallationId(fixtureInstallationId),
    },
    repositories: [asForgeRepositoryName("chuggy")],
    permissions: "read",
    ...overrides,
  };
}

/** One minted answer as this forge sends it. */
function fixtureMinted(
  overrides: Readonly<Record<string, unknown>> = {},
): Response {
  return Response.json(
    { token: fixtureToken, expires_at: fixtureExpiry, ...overrides },
    { status: 201 },
  );
}

/** The adapter over one recorder, reading a key in the encoding the case names and settling a new token as it names. */
function fixtureAdapter(
  t: TestContext,
  recorder: ForgeRecorder,
  options: {
    readonly type?: "pkcs1" | "pkcs8";
    readonly currentTimeEpochMs?: () => number;
    readonly tokenSettleMs?: number;
    readonly tokenSettleWait?: (ms: number) => Promise<unknown>;
  } = {},
) {
  return githubInstallationTokens({
    fetch: recorder.requestFetch,
    appId: fixtureAppId,
    privateKeyPath: fixtureKeyFile(t, options.type ?? "pkcs1"),
    apiUrl: fixtureApiUrl,
    ...(options.currentTimeEpochMs === undefined
      ? {}
      : { currentTimeEpochMs: options.currentTimeEpochMs }),
    ...(options.tokenSettleMs === undefined
      ? {}
      : { tokenSettleMs: options.tokenSettleMs }),
    ...(options.tokenSettleWait === undefined
      ? {}
      : { tokenSettleWait: options.tokenSettleWait }),
  });
}

/** The bearer one recorded request presented, which is the app's own JWT. */
function fixtureBearer(recorder: ForgeRecorder, index = 0): string {
  const presented = recorder.calls[index]?.headers["authorization"] ?? "";
  assert.ok(presented.startsWith("Bearer "), "no app JWT was presented");
  return presented.slice("Bearer ".length);
}

/**
 * The claims a presented JWT carries, proved against the public half of the
 * pair. The instant is the caller's because an assertion is checked against the
 * clock it was issued under rather than this machine's.
 */
async function fixtureClaims(
  assertion: string,
  atMs: number = Date.now(),
  key: KeyObject = fixtureKeyPair.publicKey,
) {
  const { payload } = await jwtVerify(assertion, key, {
    currentDate: new Date(atMs),
  });
  return payload;
}

test("the app's assertion is signed RS256 and claims the app and nothing else", async (t) => {
  const recorder = fixtureForge([fixtureMinted()]);
  const clock = fixtureClock(Date.parse("2026-09-10T11:00:00Z"));
  await fixtureAdapter(t, recorder, {
    currentTimeEpochMs: clock.now,
  }).mint(fixtureRequest());
  const assertion = fixtureBearer(recorder);
  assert.equal(decodeProtectedHeader(assertion).alg, "RS256");
  const claims = await fixtureClaims(assertion, clock.now());
  assert.equal(claims.iss, fixtureAppId);
  assert.equal(claims.sub, undefined, "an app's assertion names no subject");
  const issuedAt = claims.iat ?? 0;
  const expiry = claims.exp ?? 0;
  assert.ok(
    issuedAt < Math.floor(clock.now() / millisecondsPerSecond),
    "the assertion is issued against a clock the forge may be behind",
  );
  assert.ok(
    expiry - issuedAt <= fixtureJwtLifetimeSecsMax,
    "the assertion outlives what the forge admits",
  );
  assert.ok(expiry > issuedAt, "the assertion expires before it is issued");
  assert.ok(!fixtureSent(recorder, fixtureToken), "a minted token is not sent");
  for (const type of ["pkcs1", "pkcs8"] as const)
    assert.ok(
      !fixtureSent(recorder, fixturePrivateKeyPem(type)),
      `the app's key is signed with and never carried (${type})`,
    );
});

test("a key in either PEM encoding signs an assertion the forge can verify", async (t) => {
  for (const type of ["pkcs1", "pkcs8"] as const) {
    const recorder = fixtureForge([fixtureMinted()]);
    const minted = await fixtureAdapter(t, recorder, { type }).mint(
      fixtureRequest(),
    );
    assert.equal(minted.minted, "Token", type);
    assert.equal(
      (await fixtureClaims(fixtureBearer(recorder))).iss,
      fixtureAppId,
      type,
    );
  }
});

test("one mint is one bounded request naming the installation and what it is for", async (t) => {
  const recorder = fixtureForge([fixtureMinted()]);
  const minted = await fixtureAdapter(t, recorder).mint(
    fixtureRequest({ permissions: "propose" }),
  );
  assert.deepEqual(minted, {
    minted: "Token",
    token: fixtureToken,
    expiresAtMs: Date.parse(fixtureExpiry),
  });
  assert.equal(recorder.calls.length, 1);
  const call = recorder.calls[0];
  assert.equal(
    call?.url,
    `${fixtureApiUrl}/app/installations/${fixtureInstallationId}/access_tokens`,
  );
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "error");
  assert.equal(call.headers["accept"], "application/vnd.github+json");
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.headers["x-github-api-version"], "2022-11-28");
  assert.equal(call.headers["user-agent"], "chuggy-api");
  assert.deepEqual(JSON.parse(call.body ?? ""), {
    repositories: ["chuggy"],
    permissions: { contents: "write", pull_requests: "write" },
  });
});

test("a token of the forge's current shape is minted rather than refused for its length", async (t) => {
  assert.ok(
    fixtureForgeShapedToken.length > finalizerIdentityCharsMax,
    "the fixture no longer outruns the bound a stored identity carries",
  );
  const recorder = fixtureForge([
    fixtureMinted({ token: fixtureForgeShapedToken }),
  ]);
  assert.deepEqual(await fixtureAdapter(t, recorder).mint(fixtureRequest()), {
    minted: "Token",
    token: fixtureForgeShapedToken,
    expiresAtMs: Date.parse(fixtureExpiry),
  });
});

/** What one recorded mint asked the forge for. */
function fixtureAskedOf(recorder: ForgeRecorder, index: number): unknown {
  return (
    JSON.parse(recorder.calls[index]?.body ?? "") as { permissions: unknown }
  ).permissions;
}

/** The installation as the forge describes it to the app, granting `workflows` or not. */
function fixtureInstallationRead(grantsWorkflows: boolean): Response {
  return Response.json({
    id: Number(fixtureInstallationId),
    permissions: {
      contents: "write",
      pull_requests: "write",
      ...(grantsWorkflows ? { workflows: "write" } : {}),
    },
  });
}

test("a set naming no pipelines is the whole of what a body asks for, and reads no installation whatever its binding allows", async (t) => {
  const asked: unknown[] = [];
  for (const allowed of [false, true]) {
    const which = String(allowed);
    const recorder = fixtureForge([fixtureMinted()]);
    await fixtureAdapter(t, recorder).mint(
      fixtureRequest({
        permissions: "read",
        ...(allowed ? { pipelinesAllowed: true } : {}),
      }),
    );
    assert.equal(recorder.calls.length, 1, which);
    assert.equal(recorder.calls[0]?.method, "POST", which);
    asked.push(fixtureAskedOf(recorder, 0));
  }
  assert.deepEqual(asked, [{ contents: "read" }, { contents: "read" }]);
});

test("no set asks the forge for more than contents, pull requests and workflows, wherever its binding and the installation allow them", async (t) => {
  const asked = new Set<string>();
  const recorder: ForgeRecorder = {
    calls: [],
    requestFetch: (_input, init) => {
      if (init?.method !== "POST")
        return Promise.resolve(fixtureInstallationRead(true));
      const sent = typeof init.body === "string" ? init.body : "";
      const body = JSON.parse(sent) as { permissions: object };
      for (const permission of Object.keys(body.permissions))
        asked.add(permission);
      return Promise.resolve(fixtureMinted());
    },
  };
  const tokens = fixtureAdapter(t, recorder);
  for (const permissions of allForgePermissionSets)
    for (const allowed of [false, true]) {
      const minted = await tokens.mint(
        fixtureRequest({
          permissions,
          ...(allowed ? { pipelinesAllowed: true } : {}),
        }),
      );
      assert.equal(minted.minted, "Token", `${permissions} ${String(allowed)}`);
    }
  assert.deepEqual([...asked].sort(), [
    "contents",
    "pull_requests",
    "workflows",
  ]);
});

test("a set naming pipelines its binding does not allow asks for none, and reads no installation", async (t) => {
  const asked: unknown[] = [];
  for (const permissions of ["write", "propose"] as const) {
    const recorder = fixtureForge([fixtureMinted()]);
    const minted = await fixtureAdapter(t, recorder).mint(
      fixtureRequest({ permissions }),
    );
    assert.equal(minted.minted, "Token", permissions);
    assert.equal(recorder.calls.length, 1, permissions);
    assert.equal(recorder.calls[0]?.method, "POST", permissions);
    asked.push(fixtureAskedOf(recorder, 0));
  }
  assert.deepEqual(asked, [
    { contents: "write" },
    { contents: "write", pull_requests: "write" },
  ]);
});

test("a set naming pipelines its binding allows asks for workflows exactly where the installation, read as the app, grants them", async (t) => {
  const asked: unknown[] = [];
  for (const permissions of ["write", "propose"] as const)
    for (const grantsWorkflows of [true, false]) {
      const recorder = fixtureForge([
        fixtureInstallationRead(grantsWorkflows),
        fixtureMinted(),
      ]);
      const minted = await fixtureAdapter(t, recorder).mint(
        fixtureRequest({ permissions, pipelinesAllowed: true }),
      );
      const which = `${permissions} ${String(grantsWorkflows)}`;
      assert.equal(minted.minted, "Token", which);
      assert.equal(recorder.calls.length, 2, which);
      assert.equal(
        recorder.calls[0]?.url,
        `${fixtureApiUrl}/app/installations/${fixtureInstallationId}`,
        which,
      );
      assert.equal(recorder.calls[0].method, "GET", which);
      assert.equal(recorder.calls[0].body, undefined, which);
      assert.equal(
        (await fixtureClaims(fixtureBearer(recorder, 0))).iss,
        fixtureAppId,
        which,
      );
      asked.push(fixtureAskedOf(recorder, 1));
    }
  assert.deepEqual(asked, [
    { contents: "write", workflows: "write" },
    { contents: "write" },
    { contents: "write", pull_requests: "write", workflows: "write" },
    { contents: "write", pull_requests: "write" },
  ]);
});

test("an installation read refused, failing or unreadable is the mint's own answer, and no mint is posted", async (t) => {
  const marker = "forge-said-r5t6y7";
  const answers: readonly (readonly [() => Response | Error, unknown])[] = [
    [
      () => Response.json({ message: marker }, { status: 403 }),
      { minted: "Denied", evidence: { mint: "Status", status: 403 } },
    ],
    [
      () => Response.json({ message: marker }, { status: 404 }),
      { minted: "Denied", evidence: { mint: "Status", status: 404 } },
    ],
    [
      () => new Response("{}", { status: 500 }),
      { minted: "Unavailable", evidence: { mint: "Status", status: 500 } },
    ],
    [
      () =>
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      { minted: "Unavailable", evidence: { mint: "Throttle", status: 403 } },
    ],
    [
      () => new TypeError("the network went away"),
      { minted: "Unavailable", evidence: { mint: "Request" } },
    ],
    [
      () => Response.json({ id: Number(fixtureInstallationId) }),
      { minted: "Unavailable", evidence: { mint: "Body" } },
    ],
    [
      () => new Response("{", { status: 200 }),
      { minted: "Unavailable", evidence: { mint: "Body" } },
    ],
  ];
  for (const permissions of ["write", "propose"] as const)
    for (const [answer, expected] of answers) {
      const recorder = fixtureForge([answer(), fixtureMinted()]);
      const minted = await fixtureAdapter(t, recorder).mint(
        fixtureRequest({ permissions, pipelinesAllowed: true }),
      );
      const which = `${permissions} ${JSON.stringify(expected)}`;
      assert.deepEqual(minted, expected, which);
      assert.equal(JSON.stringify(minted).includes(marker), false, which);
      assert.equal(recorder.calls.length, 1, which);
      assert.equal(recorder.calls[0]?.method, "GET", which);
    }
});

test("an unheld mint naming pipelines reads the installation every time, and a held one reads it never", async (t) => {
  const recorder = fixtureForge([
    fixtureInstallationRead(false),
    fixtureMinted(),
    fixtureInstallationRead(true),
    fixtureMinted(),
    fixtureInstallationRead(true),
    fixtureMinted(),
  ]);
  const tokens = fixtureAdapter(t, recorder);
  for (const unheld of [true, true, false, false])
    await tokens.mint(
      fixtureRequest({
        permissions: "write",
        pipelinesAllowed: true,
        ...(unheld ? { unheld: true } : {}),
      }),
    );
  assert.deepEqual(
    recorder.calls.map((call) => call.method),
    ["GET", "POST", "GET", "POST", "GET", "POST"],
    "a held token makes no request at all",
  );
  assert.deepEqual(
    [1, 3, 5].map((index) => fixtureAskedOf(recorder, index)),
    [
      { contents: "write" },
      { contents: "write", workflows: "write" },
      { contents: "write", workflows: "write" },
    ],
  );
});

test("a forge that refuses this app is settled and everything else is a wait, each saying the status it answered", async (t) => {
  const refused: unknown[] = [];
  for (const status of [401, 403, 404, 422, 429, 500, 502, 503]) {
    const recorder = fixtureForge([
      new Response("{}", { status, headers: { "content-type": "text/plain" } }),
    ]);
    const minted = await fixtureAdapter(t, recorder).mint(fixtureRequest());
    refused.push([
      status,
      minted.minted,
      minted.minted === "Token" ? undefined : minted.evidence,
    ]);
  }
  assert.deepEqual(
    refused,
    [
      [401, "Denied"],
      [403, "Denied"],
      [404, "Denied"],
      [422, "Denied"],
      [429, "Unavailable"],
      [500, "Unavailable"],
      [502, "Unavailable"],
      [503, "Unavailable"],
    ].map(([status, minted]) => [status, minted, { mint: "Status", status }]),
  );
});

test("a throttle is a wait that says it was one, and the status it came as", async (t) => {
  for (const headers of [
    { "x-ratelimit-remaining": "0" },
    { "retry-after": "60" },
  ]) {
    const recorder = fixtureForge([
      new Response("{}", { status: 403, headers }),
    ]);
    assert.deepEqual(
      await fixtureAdapter(t, recorder).mint(fixtureRequest()),
      {
        minted: "Unavailable",
        evidence: { mint: "Throttle", status: 403 },
      },
      JSON.stringify(headers),
    );
  }
});

test("a refusal's body reaches nothing the mint answers", async (t) => {
  const marker = "forge-said-k7m2p9";
  for (const status of [401, 403, 404, 422]) {
    const recorder = fixtureForge([
      Response.json(
        { message: marker, errors: [{ message: marker }] },
        { status },
      ),
    ]);
    const minted = await fixtureAdapter(t, recorder).mint(fixtureRequest());
    assert.deepEqual(minted, {
      minted: "Denied",
      evidence: { mint: "Status", status },
    });
    assert.equal(JSON.stringify(minted).includes(marker), false);
  }
});

test("a fault, a redirect and an answer this side cannot read are all a wait", async (t) => {
  const answers: readonly (readonly [Response | Error, string])[] = [
    [new TypeError("the network went away"), "Request"],
    [
      new Response("", {
        status: 302,
        headers: { location: "https://elsewhere.invalid/" },
      }),
      "Request",
    ],
    [Response.json({ token: fixtureToken }, { status: 201 }), "Body"],
    [
      Response.json(
        { token: fixtureToken, expires_at: "never" },
        { status: 201 },
      ),
      "Expiry",
    ],
    [new Response("{", { status: 201 }), "Body"],
  ];
  for (const [answer, mint] of answers) {
    const recorder = fixtureForge([answer]);
    assert.deepEqual(
      await fixtureAdapter(t, recorder).mint(fixtureRequest()),
      { minted: "Unavailable", evidence: { mint } },
      String(answer instanceof Error ? answer.message : answer.status),
    );
  }
});

test("a redirect is refused rather than followed to whatever stands there", async (t) => {
  const recorder = fixtureForge([
    new Response("", {
      status: 302,
      headers: { location: "https://elsewhere.invalid/" },
    }),
    fixtureMinted(),
  ]);
  assert.deepEqual(await fixtureAdapter(t, recorder).mint(fixtureRequest()), {
    minted: "Unavailable",
    evidence: { mint: "Request" },
  });
  assert.equal(recorder.calls.length, 1, "the redirect was followed");
});

test("a key that is not a readable RSA private key is a wait rather than a refusal", async (t) => {
  const root = directory(t);
  const absent = join(root, "absent.pem");
  const notAKey = join(root, "not-a-key.pem");
  writeFileSync(notAKey, "not a key at all\n");
  const wrongKind = join(root, "ec.pem");
  writeFileSync(
    wrongKind,
    generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
  );
  for (const privateKeyPath of [absent, notAKey, wrongKind]) {
    const recorder = fixtureForge([fixtureMinted()]);
    const minted = await githubInstallationTokens({
      fetch: recorder.requestFetch,
      appId: fixtureAppId,
      privateKeyPath,
      apiUrl: fixtureApiUrl,
    }).mint(fixtureRequest());
    assert.deepEqual(
      minted,
      { minted: "Unavailable", evidence: { mint: "Key" } },
      privateKeyPath,
    );
    assert.equal(recorder.calls.length, 0, privateKeyPath);
  }
});

test("a key past its bound is refused rather than read as far as the bound allows", async (t) => {
  const path = join(directory(t), "app.pem");
  const pem = fixtureKeyPair.privateKey
    .export({ type: "pkcs1", format: "pem" })
    .toString();
  writeFileSync(path, pem);
  for (const privateKeyBytesMax of [
    Buffer.byteLength(pem) - 1,
    fixtureShortKeyBound,
  ]) {
    const recorder = fixtureForge([fixtureMinted()]);
    const minted = await githubInstallationTokens({
      fetch: recorder.requestFetch,
      appId: fixtureAppId,
      privateKeyPath: path,
      apiUrl: fixtureApiUrl,
      privateKeyBytesMax,
    }).mint(fixtureRequest());
    assert.deepEqual(
      minted,
      { minted: "Unavailable", evidence: { mint: "Key" } },
      String(privateKeyBytesMax),
    );
    assert.equal(recorder.calls.length, 0, String(privateKeyBytesMax));
  }
});

test("a token is handed out again until its own expiry less the margin, and minted again inside it", async (t) => {
  const clock = fixtureClock(Date.parse("2026-09-10T11:00:00Z"));
  const recorder = fixtureForge([fixtureMinted(), fixtureMinted()]);
  const tokens = fixtureAdapter(t, recorder, {
    currentTimeEpochMs: clock.now,
  });
  await tokens.mint(fixtureRequest());
  await tokens.mint(fixtureRequest());
  assert.equal(recorder.calls.length, 1, "a held token makes no request");
  assert.equal(
    githubInstallationTokensDefaults.tokenMarginMs,
    fixtureMarginMs,
    "the margin this case advances against is the one a deployment gets",
  );
  clock.advance(Date.parse(fixtureExpiry) - clock.now() - fixtureMarginMs + 1);
  await tokens.mint(fixtureRequest());
  assert.equal(
    recorder.calls.length,
    2,
    "a token the forge still honours but the margin does not is minted again",
  );
});

/** The token one mint answered, or how it was not answered. */
function fixtureTokenOf(
  minted: Awaited<ReturnType<ReturnType<typeof fixtureAdapter>["mint"]>>,
): string {
  return minted.minted === "Token" ? minted.token : minted.minted;
}

test("an unheld mint is a request of its own, holds nothing and leaves what is held", async (t) => {
  const first = "ghs-unheld-p3o4i5";
  const second = "ghs-unheld-u6y7t8";
  const recorder = fixtureForge([
    fixtureMinted({ token: first }),
    fixtureMinted(),
    fixtureMinted({ token: second }),
  ]);
  const tokens = fixtureAdapter(t, recorder);
  const answered: string[] = [];
  for (const unheld of [true, false, true, false])
    answered.push(
      fixtureTokenOf(
        await tokens.mint(fixtureRequest(unheld ? { unheld: true } : {})),
      ),
    );
  assert.deepEqual(answered, [first, fixtureToken, second, fixtureToken]);
  assert.equal(
    recorder.calls.length,
    3,
    "only the mint answered from what is held makes no request",
  );
  for (const call of recorder.calls)
    assert.deepEqual(
      JSON.parse(call.body ?? ""),
      { repositories: ["chuggy"], permissions: { contents: "read" } },
      "the forge is not told how a token is held",
    );
});

/**
 * The settling a case composes with. It is named here rather than read from
 * the adapter, so a window narrowed to nothing is a case that fails rather than
 * a case that narrows with it.
 */
const fixtureSettleMs = 5_000;

/** A settling this suite ends by hand, recording each wait asked of it, so a case can look at a mint while it waits. */
function fixtureSettling(): {
  readonly asked: number[];
  readonly wait: (ms: number) => Promise<unknown>;
  readonly reached: Promise<void>;
  readonly end: () => void;
} {
  const asked: number[] = [];
  const reached = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<void>();
  return {
    asked,
    wait: (ms) => {
      asked.push(ms);
      reached.resolve();
      return ended.promise;
    },
    reached: reached.promise,
    end: () => {
      ended.resolve();
    },
  };
}

/** One turn of the event loop, after which a mint no longer waiting on anything has been answered. */
function fixtureTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("a composition settling new tokens settles them for the forge's own window", () => {
  assert.equal(
    githubInstallationTokensSettled({
      fetch,
      appId: fixtureAppId,
      privateKeyPath: "app.pem",
    }).tokenSettleMs,
    fixtureSettleMs,
  );
});

test("a token the forge has just made is answered no earlier than its settling has run", async (t) => {
  const settling = fixtureSettling();
  const tokens = fixtureAdapter(t, fixtureForge([fixtureMinted()]), {
    tokenSettleMs: fixtureSettleMs,
    tokenSettleWait: settling.wait,
  });
  let answered = false;
  const minting = tokens.mint(fixtureRequest()).then((minted) => {
    answered = true;
    return minted;
  });
  await Promise.race([settling.reached, minting]);
  await fixtureTurn();
  assert.equal(answered, false, "a token is answered while it settles");
  assert.deepEqual(settling.asked, [fixtureSettleMs]);
  settling.end();
  assert.equal(fixtureTokenOf(await minting), fixtureToken);
});

test("a token is held only once it has settled, so a mint racing its settling sends its own", async (t) => {
  const racing = "ghs-racing-z9x8c7";
  const settling = fixtureSettling();
  const recorder = fixtureForge([
    fixtureMinted(),
    fixtureMinted({ token: racing }),
  ]);
  const tokens = fixtureAdapter(t, recorder, {
    tokenSettleMs: fixtureSettleMs,
    tokenSettleWait: settling.wait,
  });
  const first = tokens.mint(fixtureRequest());
  await Promise.race([settling.reached, first]);
  const second = tokens.mint(fixtureRequest());
  settling.end();
  assert.deepEqual(
    [fixtureTokenOf(await first), fixtureTokenOf(await second)],
    [fixtureToken, racing],
  );
  assert.equal(recorder.calls.length, 2, "a settling token answers no mint");
});

test("an answer from what is held waits for no settling", async (t) => {
  const settling = fixtureSettling();
  settling.end();
  const recorder = fixtureForge([fixtureMinted()]);
  const tokens = fixtureAdapter(t, recorder, {
    tokenSettleMs: fixtureSettleMs,
    tokenSettleWait: settling.wait,
  });
  await tokens.mint(fixtureRequest());
  assert.equal(
    fixtureTokenOf(await tokens.mint(fixtureRequest())),
    fixtureToken,
  );
  assert.equal(
    recorder.calls.length,
    1,
    "the second mint is answered from what is held",
  );
  assert.deepEqual(
    settling.asked,
    [fixtureSettleMs],
    "only the token just made settles",
  );
});

test("a refusal and an outage are answered at once, settling nothing", async (t) => {
  const settling = fixtureSettling();
  settling.end();
  const answered: string[] = [];
  for (const answer of [
    new Response("{}", { status: 401 }),
    new Response("{}", { status: 404 }),
    new Response("{}", { status: 503 }),
    new Error("the forge could not be reached"),
  ])
    answered.push(
      fixtureTokenOf(
        await fixtureAdapter(t, fixtureForge([answer]), {
          tokenSettleMs: fixtureSettleMs,
          tokenSettleWait: settling.wait,
        }).mint(fixtureRequest()),
      ),
    );
  assert.deepEqual(answered, [
    "Denied",
    "Denied",
    "Unavailable",
    "Unavailable",
  ]);
  assert.deepEqual(settling.asked, [], "no refusal or outage waits");
});

test("an unheld mint is new every time, and settles every time", async (t) => {
  const settling = fixtureSettling();
  settling.end();
  const tokens = fixtureAdapter(
    t,
    fixtureForge([fixtureMinted(), fixtureMinted()]),
    {
      tokenSettleMs: fixtureSettleMs,
      tokenSettleWait: settling.wait,
    },
  );
  for (let mint = 0; mint < 2; mint += 1)
    await tokens.mint(fixtureRequest({ unheld: true }));
  assert.deepEqual(settling.asked, [fixtureSettleMs, fixtureSettleMs]);
});

test("a composition naming no settling answers a token the forge has just made at once", async (t) => {
  const settling = fixtureSettling();
  settling.end();
  const tokens = fixtureAdapter(
    t,
    fixtureForge([fixtureMinted(), fixtureMinted()]),
    {
      tokenSettleWait: settling.wait,
    },
  );
  assert.equal(
    fixtureTokenOf(await tokens.mint(fixtureRequest())),
    fixtureToken,
  );
  assert.equal(
    fixtureTokenOf(await tokens.mint(fixtureRequest({ unheld: true }))),
    fixtureToken,
  );
  assert.deepEqual(settling.asked, [], "nothing waits");
});

test("a token held is keyed by everything it is good for", async (t) => {
  const recorder = fixtureForge([
    fixtureMinted(),
    fixtureMinted(),
    fixtureMinted(),
  ]);
  const tokens = fixtureAdapter(t, recorder);
  await tokens.mint(fixtureRequest());
  await tokens.mint(fixtureRequest({ permissions: "write" }));
  await tokens.mint(
    fixtureRequest({ repositories: [asForgeRepositoryName("other")] }),
  );
  assert.equal(recorder.calls.length, 3);
  await tokens.mint(
    fixtureRequest({
      repositories: [
        asForgeRepositoryName("chuggy"),
        asForgeRepositoryName("other"),
      ],
    }),
  );
  assert.equal(recorder.calls.length, 4, "two repositories are a third token");
});

/**
 * A binding that stopped allowing the pipeline definitions must not be handed
 * the token held from when it did, and one that started must not be handed
 * the token held from before: the allowance is a term of the key either way.
 */
test("a token held with the pipeline definitions never answers a mint its binding does not allow them, nor the other way", async (t) => {
  const withThem = "ghs-workflows-k1l2m3";
  const without = "ghs-contents-n4b5v6";
  const recorder = fixtureForge([
    fixtureInstallationRead(true),
    fixtureMinted({ token: withThem }),
    fixtureMinted({ token: without }),
  ]);
  const tokens = fixtureAdapter(t, recorder);
  const answered: string[] = [];
  for (const allowed of [true, false, true, false])
    answered.push(
      fixtureTokenOf(
        await tokens.mint(
          fixtureRequest({
            permissions: "write",
            ...(allowed ? { pipelinesAllowed: true } : {}),
          }),
        ),
      ),
    );
  assert.deepEqual(answered, [withThem, without, withThem, without]);
  assert.deepEqual(
    recorder.calls.map((call) => call.method),
    ["GET", "POST", "POST"],
    "each allowance is minted once and then held",
  );
  assert.deepEqual(
    [1, 2].map((index) => fixtureAskedOf(recorder, index)),
    [{ contents: "write", workflows: "write" }, { contents: "write" }],
  );
});

test("one repository name under two installations is two tokens", async (t) => {
  const second = "ghs-elsewhere-z7x8c9";
  const recorder = fixtureForge([
    fixtureMinted(),
    fixtureMinted({ token: second }),
  ]);
  const tokens = fixtureAdapter(t, recorder);
  const here = await tokens.mint(fixtureRequest());
  const elsewhere = await tokens.mint(
    fixtureRequest({
      installation: {
        ...fixtureRequest().installation,
        installationId: asForgeInstallationId("156786211"),
        account: asForgeAccount("otherco"),
      },
    }),
  );
  assert.equal(
    recorder.calls.length,
    2,
    "a bare repository name is one name on every account, so the installation is what tells the two apart",
  );
  assert.deepEqual(
    [
      here.minted === "Token" ? here.token : here.minted,
      elsewhere.minted === "Token" ? elsewhere.token : elsewhere.minted,
    ],
    [fixtureToken, second],
    "neither caller is handed the other's token",
  );
});

test("repositories name one token whichever order they arrive in", async (t) => {
  const recorder = fixtureForge([fixtureMinted(), fixtureMinted()]);
  const tokens = fixtureAdapter(t, recorder);
  const pair = [
    asForgeRepositoryName("chuggy"),
    asForgeRepositoryName("other"),
  ];
  await tokens.mint(fixtureRequest({ repositories: pair }));
  await tokens.mint(fixtureRequest({ repositories: [...pair].reverse() }));
  assert.equal(recorder.calls.length, 1);
});

test("a mint naming no repository is refused rather than asking for the installation", async (t) => {
  const recorder = fixtureForge([fixtureMinted()]);
  await assert.rejects(
    () =>
      fixtureAdapter(t, recorder).mint(fixtureRequest({ repositories: [] })),
    /names no repository/u,
  );
  assert.equal(recorder.calls.length, 0);
});

test("the startup precondition refuses the key every mint would fail on", async (t) => {
  const recorder = fixtureForge([]);
  const signal = new AbortController().signal;
  const usable = githubInstallationTokensPrecondition({
    fetch: recorder.requestFetch,
    appId: fixtureAppId,
    privateKeyPath: fixtureKeyFile(t, "pkcs8"),
  });
  assert.equal(usable.name, "forge-app-key-usable");
  assert.equal((await usable.check(signal)).met, "Met");
  const root = directory(t);
  const elliptic = join(root, "ec.pem");
  writeFileSync(
    elliptic,
    generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
  );
  for (const privateKeyPath of [join(root, "absent.pem"), elliptic])
    assert.equal(
      (
        await githubInstallationTokensPrecondition({
          fetch: recorder.requestFetch,
          appId: fixtureAppId,
          privateKeyPath,
        }).check(signal)
      ).met,
      "Refused",
      privateKeyPath,
    );
  assert.equal(recorder.calls.length, 0, "no precondition reaches the forge");
});

test("an app, a key path, an API URL and a settling this adapter could not serve are refused at construction", (t) => {
  const recorder = fixtureForge([]);
  const composed = {
    fetch: recorder.requestFetch,
    appId: fixtureAppId,
    privateKeyPath: fixtureKeyFile(t, "pkcs1"),
  };
  assert.throws(
    () => githubInstallationTokens({ ...composed, appId: "" }),
    /app id is empty/u,
  );
  assert.throws(
    () => githubInstallationTokens({ ...composed, privateKeyPath: "" }),
    /private key path is empty/u,
  );
  assert.throws(
    () =>
      githubInstallationTokens({ ...composed, apiUrl: "ftp://forge.invalid" }),
    /API URL is not HTTP/u,
  );
  assert.throws(
    () =>
      githubInstallationTokens({
        ...composed,
        apiUrl: "https://user:secret@forge.invalid",
      }),
    /API URL carries credentials/u,
  );
  assert.throws(
    () => githubInstallationTokens({ ...composed, requestTimeoutMs: 0 }),
    /not a positive bound/u,
  );
  assert.throws(
    () => githubInstallationTokens({ ...composed, tokenSettleMs: 0 }),
    /token settling is not a positive bound/u,
  );
});
