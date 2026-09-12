/**
 * The mint against a recording forge: what the app's own JWT claims, what one
 * request carries, what every way of not being answered comes to, and what a
 * second mint inside a token's life does not do.
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
} from "../../src/adapters/forge/githubInstallationTokens.ts";
import {
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

/** The adapter over one recorder, reading a key in the encoding the case names. */
function fixtureAdapter(
  t: TestContext,
  recorder: ForgeRecorder,
  options: {
    readonly type?: "pkcs1" | "pkcs8";
    readonly currentTimeEpochMs?: () => number;
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

test("a named permission set is the whole of what a body asks for", async (t) => {
  const asked: unknown[] = [];
  for (const permissions of ["read", "write"] as const) {
    const recorder = fixtureForge([fixtureMinted()]);
    await fixtureAdapter(t, recorder).mint(fixtureRequest({ permissions }));
    asked.push(
      (JSON.parse(recorder.calls[0]?.body ?? "") as { permissions: unknown })
        .permissions,
    );
  }
  assert.deepEqual(asked, [{ contents: "read" }, { contents: "write" }]);
});

test("a forge that refuses this app is settled and everything else is a wait", async (t) => {
  const refused: unknown[] = [];
  for (const status of [401, 403, 404, 422, 429, 500, 502, 503]) {
    const recorder = fixtureForge([
      new Response("{}", { status, headers: { "content-type": "text/plain" } }),
    ]);
    refused.push([
      status,
      (await fixtureAdapter(t, recorder).mint(fixtureRequest())).minted,
    ]);
  }
  assert.deepEqual(refused, [
    [401, "Denied"],
    [403, "Denied"],
    [404, "Denied"],
    [422, "Denied"],
    [429, "Unavailable"],
    [500, "Unavailable"],
    [502, "Unavailable"],
    [503, "Unavailable"],
  ]);
});

test("a fault, a redirect and an answer this side cannot read are all a wait", async (t) => {
  const answers: readonly (Response | Error)[] = [
    new TypeError("the network went away"),
    new Response("", {
      status: 302,
      headers: { location: "https://elsewhere.invalid/" },
    }),
    Response.json({ token: fixtureToken }, { status: 201 }),
    Response.json(
      { token: fixtureToken, expires_at: "never" },
      { status: 201 },
    ),
    new Response("{", { status: 201 }),
  ];
  for (const answer of answers) {
    const recorder = fixtureForge([answer]);
    assert.deepEqual(
      await fixtureAdapter(t, recorder).mint(fixtureRequest()),
      { minted: "Unavailable" },
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
    assert.deepEqual(minted, { minted: "Unavailable" }, privateKeyPath);
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
      { minted: "Unavailable" },
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

test("an app, a key path and an API URL this adapter could not serve are refused at construction", (t) => {
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
});
