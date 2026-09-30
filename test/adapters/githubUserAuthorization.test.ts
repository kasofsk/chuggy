/**
 * A person's authorization redeemed at GitHub, against a recording forge whose
 * web and API hosts are apart, so which host each secret reaches is observable.
 * The token is a sentinel nothing else contains.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  githubClientSecretPresence,
  githubUserAuthorization,
  type GithubUserAuthorizationOptions,
} from "../../src/adapters/forge/githubUserAuthorization.ts";
import type { ForgeApps } from "../../src/interpreter/forgeDirectory.ts";
import {
  asForgeAccount,
  asForgeAccountId,
  asForgeInstallationId,
} from "../../src/interpreter/forgeInstallation.ts";
import { fixtureForge, type ForgeRecorder } from "./forgeFixtures.ts";

const fixtureAppId = "4708055";
const fixtureApiUrl = "https://api.forge.invalid";
const fixtureWebUrl = "https://forge.invalid";
const fixtureToken = "ghu_person-token-sentinel-q4w5e6";
const fixtureSecret = "client-secret-sentinel-r7t8y9";

const fixtureGrant = {
  code: "code-from-the-forge",
  redirectUri: "https://console.invalid/forge/github/callback",
  codeVerifier: "v".repeat(43),
};

/** The portal app as its own key describes it, its web host apart from its API host. */
const fixtureApps: ForgeApps = {
  app: () =>
    Promise.resolve({
      described: "App",
      app: {
        id: fixtureAppId,
        slug: "chuggy-portal",
        installUrl: `${fixtureWebUrl}/apps/chuggy-portal/installations/new`,
        clientId: "Iv1.portal",
        authorizeUrl: `${fixtureWebUrl}/login/oauth/authorize`,
      },
    }),
};

function fixtureSecretFile(t: TestContext, contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-client-secret-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, "client-secret");
  writeFileSync(path, contents);
  return path;
}

function fixtureOptions(
  t: TestContext,
  recorder: ForgeRecorder,
  overrides: Partial<GithubUserAuthorizationOptions> = {},
): GithubUserAuthorizationOptions {
  return {
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    app: fixtureApps,
    appId: fixtureAppId,
    clientSecretPath: fixtureSecretFile(t, `${fixtureSecret}\n`),
    ...overrides,
  };
}

function fixtureAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A rate limit as GitHub answers one, a `403` told apart only by its headers. */
function fixtureThrottled(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
    status: 403,
    headers,
  });
}

/** A fresh answer per call, because a body is read once. */
function fixtureRedeemed(): Response {
  return fixtureAnswer(200, {
    access_token: fixtureToken,
    token_type: "bearer",
  });
}

function fixturePerson(): Response {
  return fixtureAnswer(200, { id: 7, login: "geoff" });
}

/** The adapter's own page size, which a full page must fill for it to ask for another. */
const fixturePageSize = 100;

interface FixtureRow {
  readonly id: number;
  readonly appId?: string;
  readonly login: string;
  readonly accountId: number;
  readonly type: string;
}

function fixtureInstallations(
  rows: readonly FixtureRow[],
  total: number = rows.length,
): Response {
  return fixtureAnswer(200, {
    total_count: total,
    installations: rows.map((row) => ({
      id: row.id,
      app_id: Number(row.appId ?? fixtureAppId),
      account: { login: row.login, id: row.accountId, type: row.type },
    })),
  });
}

const ownRow: FixtureRow = {
  id: 8001,
  login: "geoff",
  accountId: 7,
  type: "User",
};

const organizationRow: FixtureRow = {
  id: 8101,
  login: "kasofsk",
  accountId: 500,
  type: "Organization",
};

test("a code is redeemed at the web host and the token presented to the API host alone", async (t) => {
  const recorder = fixtureForge([
    fixtureRedeemed(),
    fixturePerson(),
    fixtureInstallations([ownRow, organizationRow]),
    fixtureAnswer(200, {
      state: "active",
      role: "admin",
      organization: { id: 500 },
    }),
  ]);
  const answered = await githubUserAuthorization(
    fixtureOptions(t, recorder),
  ).authorized(fixtureGrant);
  assert.deepEqual(answered, {
    authorized: "User",
    user: { id: asForgeAccountId("7"), login: asForgeAccount("geoff") },
    installations: [
      {
        accountKind: "User",
        installationId: asForgeInstallationId("8001"),
        account: asForgeAccount("geoff"),
        accountId: asForgeAccountId("7"),
      },
      {
        accountKind: "Organization",
        installationId: asForgeInstallationId("8101"),
        account: asForgeAccount("kasofsk"),
        accountId: asForgeAccountId("500"),
        membership: {
          read: "Membership",
          organizationId: asForgeAccountId("500"),
          active: true,
          owner: true,
        },
      },
    ],
    truncated: false,
  });
  const [redemption, ...reads] = recorder.calls;
  assert.equal(redemption?.url, `${fixtureWebUrl}/login/oauth/access_token`);
  assert.equal(redemption.method, "POST");
  assert.equal(redemption.headers["accept"], "application/json");
  assert.equal(redemption.headers["authorization"], undefined);
  assert.deepEqual(JSON.parse(redemption.body ?? "null"), {
    client_id: "Iv1.portal",
    client_secret: fixtureSecret,
    code: fixtureGrant.code,
    redirect_uri: fixtureGrant.redirectUri,
    code_verifier: fixtureGrant.codeVerifier,
  });
  assert.deepEqual(
    reads.map((call) => call.url),
    [
      `${fixtureApiUrl}/user`,
      `${fixtureApiUrl}/user/installations?per_page=64&page=1`,
      `${fixtureApiUrl}/user/memberships/orgs/kasofsk`,
    ],
  );
  for (const call of reads) {
    assert.equal(call.headers["authorization"], `Bearer ${fixtureToken}`);
    assert.equal(call.body, undefined);
  }
  for (const call of recorder.calls) assert.equal(call.redirect, "error");
  assert.equal(JSON.stringify(answered).includes(fixtureToken), false);
});

test("a redemption the web host refuses is refused, and one it cannot read is an outage", async (t) => {
  const cases: readonly (readonly [Response, string])[] = [
    [fixtureAnswer(200, { error: "bad_verification_code" }), "Refused"],
    [fixtureAnswer(401, { message: "no" }), "Refused"],
    [fixtureAnswer(200, { token_type: "bearer" }), "Unavailable"],
    [fixtureAnswer(500, {}), "Unavailable"],
    [new Response("not json", { status: 200 }), "Unavailable"],
  ];
  for (const [answer, authorized] of cases) {
    const recorder = fixtureForge([answer]);
    assert.deepEqual(
      await githubUserAuthorization(fixtureOptions(t, recorder)).authorized(
        fixtureGrant,
      ),
      { authorized },
    );
    assert.equal(recorder.calls.length, 1);
  }
});

test("a client secret the web host refuses is the deployment's outage, said once to the operator", async (t) => {
  let told = 0;
  const refusing = fixtureForge([
    fixtureAnswer(200, { error: "incorrect_client_credentials" }),
  ]);
  assert.deepEqual(
    await githubUserAuthorization(
      fixtureOptions(t, refusing, {
        credentialsRefused: () => {
          told += 1;
        },
      }),
    ).authorized(fixtureGrant),
    { authorized: "Unavailable" },
  );
  assert.equal(told, 1);
  const spent = fixtureForge([
    fixtureAnswer(200, { error: "bad_verification_code" }),
  ]);
  await githubUserAuthorization(
    fixtureOptions(t, spent, {
      credentialsRefused: () => {
        told += 1;
      },
    }),
  ).authorized(fixtureGrant);
  assert.equal(told, 1);
  const written = t.mock.method(process.stderr, "write", () => true);
  await githubUserAuthorization(
    fixtureOptions(
      t,
      fixtureForge([
        fixtureAnswer(200, { error: "incorrect_client_credentials" }),
      ]),
    ),
  ).authorized(fixtureGrant);
  const lines = written.mock.calls.map((call) => String(call.arguments[0]));
  written.mock.restore();
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /client id and secret/u);
  assert.equal(lines[0]?.includes(fixtureSecret), false);
});

test("a client secret that cannot be read is an outage and nothing is sent", async (t) => {
  const paths = [
    join(tmpdir(), "chuggy-client-secret-absent", "client-secret"),
    fixtureSecretFile(t, "\n"),
    fixtureSecretFile(t, "s".repeat(65)),
  ];
  for (const clientSecretPath of paths) {
    const recorder = fixtureForge([fixtureRedeemed()]);
    assert.deepEqual(
      await githubUserAuthorization(
        fixtureOptions(t, recorder, {
          clientSecretPath,
          clientSecretBytesMax: 64,
        }),
      ).authorized(fixtureGrant),
      { authorized: "Unavailable" },
    );
    assert.equal(recorder.calls.length, 0);
  }
});

test("a person or listing not read once the code is redeemed spends it, a rate limit included", async (t) => {
  const cases: readonly (readonly Response[])[] = [
    [fixtureAnswer(401, {})],
    [fixtureThrottled({ "x-ratelimit-remaining": "0" })],
    [fixturePerson(), fixtureAnswer(502, {})],
    [fixturePerson(), fixtureThrottled({ "retry-after": "60" })],
  ];
  for (const unread of cases) {
    const recorder = fixtureForge([fixtureRedeemed(), ...unread]);
    assert.deepEqual(
      await githubUserAuthorization(fixtureOptions(t, recorder)).authorized(
        fixtureGrant,
      ),
      { authorized: "Spent" },
    );
    assert.equal(recorder.calls.length, 1 + unread.length);
  }
});

test("another app's installation is dropped, and an account this side cannot read spends the code", async (t) => {
  const mixed = fixtureForge([
    fixtureRedeemed(),
    fixturePerson(),
    fixtureInstallations([ownRow, { ...ownRow, id: 9001, appId: "999999" }]),
  ]);
  const answered = await githubUserAuthorization(
    fixtureOptions(t, mixed),
  ).authorized(fixtureGrant);
  assert.deepEqual(
    answered.authorized === "User"
      ? answered.installations.map((row) => row.installationId)
      : [],
    [asForgeInstallationId("8001")],
  );
  for (const unreadable of [
    { ...organizationRow, type: "Enterprise" },
    { ...organizationRow, login: "not a segment" },
  ]) {
    const strange = fixtureForge([
      fixtureRedeemed(),
      fixturePerson(),
      fixtureInstallations([unreadable]),
    ]);
    assert.deepEqual(
      await githubUserAuthorization(fixtureOptions(t, strange)).authorized(
        fixtureGrant,
      ),
      { authorized: "Spent" },
    );
    assert.equal(strange.calls.length, 3);
  }
});

test("the listing pages to its bound and says when the person reaches more", async (t) => {
  const bounded = fixtureForge([
    fixtureRedeemed(),
    fixturePerson(),
    fixtureInstallations(
      [ownRow, { ...ownRow, id: 8002, login: "other", accountId: 8 }],
      3,
    ),
  ]);
  const answered = await githubUserAuthorization(
    fixtureOptions(t, bounded, { installationsMax: 2 }),
  ).authorized(fixtureGrant);
  assert.equal(answered.authorized === "User" && answered.truncated, true);
  assert.deepEqual(bounded.calls.map((call) => call.url).slice(2), [
    `${fixtureApiUrl}/user/installations?per_page=2&page=1`,
  ]);
  const fullPage = Array.from({ length: fixturePageSize }, (_row, index) => ({
    ...ownRow,
    id: ownRow.id + index,
  }));
  const paged = fixtureForge([
    fixtureRedeemed(),
    fixturePerson(),
    fixtureInstallations(fullPage, fixturePageSize + 1),
    fixtureInstallations([{ ...ownRow, id: 9999 }], fixturePageSize + 1),
  ]);
  const both = await githubUserAuthorization(
    fixtureOptions(t, paged, { installationsMax: fixturePageSize * 2 }),
  ).authorized(fixtureGrant);
  assert.equal(both.authorized === "User" && both.truncated, false);
  assert.equal(
    both.authorized === "User" ? both.installations.length : 0,
    fixturePageSize + 1,
  );
  assert.equal(
    paged.calls[3]?.url,
    `${fixtureApiUrl}/user/installations?per_page=${String(fixturePageSize)}&page=2`,
  );
});

test("a membership the forge refuses, cannot answer, or holds pending is carried as such", async (t) => {
  const cases = [
    [fixtureAnswer(404, {}), { read: "Refused" }],
    [fixtureAnswer(403, { message: "Forbidden" }), { read: "Refused" }],
    [
      new Response("{}", {
        status: 404,
        headers: { "x-ratelimit-remaining": "0" },
      }),
      { read: "Refused" },
    ],
    [fixtureAnswer(503, {}), { read: "Unavailable" }],
    [fixtureAnswer(502, {}), { read: "Unavailable" }],
    [fixtureAnswer(429, {}), { read: "Unavailable" }],
    [
      fixtureThrottled({ "x-ratelimit-remaining": "0" }),
      { read: "Unavailable" },
    ],
    [fixtureThrottled({ "retry-after": "60" }), { read: "Unavailable" }],
    [
      fixtureAnswer(200, {
        state: "pending",
        role: "member",
        organization: { id: 500 },
      }),
      {
        read: "Membership",
        organizationId: asForgeAccountId("500"),
        active: false,
        owner: false,
      },
    ],
  ] as const;
  for (const [answer, membership] of cases) {
    const recorder = fixtureForge([
      fixtureRedeemed(),
      fixturePerson(),
      fixtureInstallations([organizationRow]),
      answer,
    ]);
    const answered = await githubUserAuthorization(
      fixtureOptions(t, recorder),
    ).authorized(fixtureGrant);
    const [organization] =
      answered.authorized === "User" ? answered.installations : [];
    assert.deepEqual(
      organization?.accountKind === "Organization"
        ? organization.membership
        : undefined,
      membership,
    );
  }
});

test("a deployment's client secret is present, absent, or unreadable", async (t) => {
  assert.equal(
    await githubClientSecretPresence({
      clientSecretPath: fixtureSecretFile(t, `  ${fixtureSecret}\n`),
    }),
    "Present",
  );
  for (const clientSecretPath of [
    fixtureSecretFile(t, ""),
    fixtureSecretFile(t, " \n\t\n"),
    join(tmpdir(), "chuggy-client-secret-absent", "client-secret"),
  ])
    assert.equal(
      await githubClientSecretPresence({ clientSecretPath }),
      "Absent",
    );
  assert.equal(
    await githubClientSecretPresence({
      clientSecretPath: fixtureSecretFile(t, "s".repeat(65)),
      clientSecretBytesMax: 64,
    }),
    "Unreadable",
  );
  assert.equal(
    await githubClientSecretPresence({ clientSecretPath: tmpdir() }),
    "Unreadable",
  );
});

test("a secret with whitespace around it is sent without it", async (t) => {
  const recorder = fixtureForge([fixtureAnswer(200, { error: "bad" })]);
  await githubUserAuthorization(
    fixtureOptions(t, recorder, {
      clientSecretPath: fixtureSecretFile(t, `\n ${fixtureSecret} \r\n`),
    }),
  ).authorized(fixtureGrant);
  assert.equal(
    (JSON.parse(recorder.calls[0]?.body ?? "{}") as Record<string, unknown>)[
      "client_secret"
    ],
    fixtureSecret,
  );
});
