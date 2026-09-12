/**
 * What GitHub tells this app about itself, about one installation, and about
 * what an installation grants.
 *
 * THE SECOND READ OF THE APP MAKES NO REQUEST, which is the whole point of
 * holding it: a route every authenticated reader may call would otherwise spend
 * this deployment's rate limit once per caller. The recorded calls are what
 * proves it, so an implementation that cached the value and asked anyway fails
 * here.
 *
 * AN OUTAGE IS NOT HELD. A process that could not reach the forge once must ask
 * again, so the case that observes the hold also observes that a failure was
 * not the thing held.
 *
 * THE INSTALLATION OF ANOTHER APP IS THE ONE THAT LOOKS FINE. The forge answers
 * 200 with a complete installation whose `app_id` is somebody else's, which is
 * the only way the second term of that comparison can be shown to matter.
 *
 * THE PAGING IS DRIVEN BY WHAT THE FORGE SAYS AND BY THE BOUND, and the two are
 * asserted apart: a listing that ends because a short page arrived, one that
 * ends because the bound was reached, and one whose total exceeds what was
 * collected are three different cases.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  githubApps,
  githubInstallationDirectory,
} from "../../src/adapters/forge/githubApp.ts";
import { githubInstallationRepositories } from "../../src/adapters/forge/githubInstallationRepositories.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
  type ForgeInstallation,
  type ForgeInstallationTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import { fixtureForge, type ForgeRecorder } from "./forgeFixtures.ts";

const fixtureAppId = "4708055";
const fixtureApiUrl = "https://forge.invalid";
const fixtureInstallationId = asForgeInstallationId("156333284");
const fixtureToken = "ghs-listing-w7e8r9";

/** The app's key pair, generated once because generating one is the slow part. */
const fixtureKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

const fixtureInstallation: ForgeInstallation = {
  forge: asForgeId("github"),
  app: asForgeApp("portal"),
  account: asForgeAccount("kasofsk"),
  installationId: fixtureInstallationId,
};

function fixtureKeyFile(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-directory-key-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, "app.pem");
  writeFileSync(
    path,
    fixtureKeyPair.privateKey.export({ type: "pkcs1", format: "pem" }),
  );
  return path;
}

function fixtureAppOptions(t: TestContext, recorder: ForgeRecorder) {
  return {
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    appId: fixtureAppId,
    privateKeyPath: fixtureKeyFile(t),
  };
}

function fixtureAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** The app as the forge describes it, with whichever address the case is about. */
function fixtureApp(htmlUrl: string): Response {
  return fixtureAnswer(200, {
    id: Number(fixtureAppId),
    slug: "chuggy-portal",
    html_url: htmlUrl,
  });
}

/** One installation as the forge describes it, under whichever app the case is about. */
function fixtureInstallationAnswer(appId: string): Response {
  return fixtureAnswer(200, {
    app_id: Number(appId),
    account: { login: "kasofsk", type: "Organization" },
  });
}

/**
 * How many rows a full page holds, which is what tells the adapter to ask for
 * another. It is the adapter's own page size, and a case naming fewer would
 * observe a short page rather than the paging.
 */
const fixturePageSize = 100;

/** One page of a listing: `count` rows named apart, out of `total` in all. */
function fixturePage(from: number, count: number, total: number): Response {
  return fixtureAnswer(200, {
    total_count: total,
    repositories: Array.from({ length: count }, (_row, index) => ({
      name: `repo-${String(from + index)}`,
      full_name: `kasofsk/repo-${String(from + index)}`,
      clone_url: `https://github.com/kasofsk/repo-${String(from + index)}.git`,
      default_branch: "main",
      private: false,
    })),
  });
}

/** The mint the listing pages under, recording what it was asked for. */
function fixtureTokens(
  minted: ForgeTokenMinted,
  asked: ForgeTokenRequest[] = [],
): ForgeInstallationTokens {
  return {
    mint: (request) => {
      asked.push(request);
      return Promise.resolve(minted);
    },
  };
}

const fixtureGranted: ForgeTokenMinted = {
  minted: "Token",
  token: asForgeInstallationToken(fixtureToken),
  expiresAtMs: 4_102_444_800_000,
};

test("the app is read once and then answered from memory", async (t) => {
  const recorder = fixtureForge([
    fixtureApp("https://github.com/apps/chuggy-portal"),
  ]);
  const apps = githubApps(fixtureAppOptions(t, recorder));
  const first = await apps.app();
  assert.deepEqual(first, {
    described: "App",
    app: {
      id: fixtureAppId,
      slug: "chuggy-portal",
      installUrl: "https://github.com/apps/chuggy-portal/installations/new",
    },
  });
  assert.deepEqual(await apps.app(), first);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.url, `${fixtureApiUrl}/app`);
  assert.equal(recorder.calls[0]?.method, "GET");
});

test("an outage is not what is held, so the next read asks again", async (t) => {
  const recorder = fixtureForge([
    fixtureAnswer(500, {}),
    fixtureApp("https://github.com/apps/chuggy-portal"),
  ]);
  const apps = githubApps(fixtureAppOptions(t, recorder));
  assert.deepEqual(await apps.app(), { described: "Unavailable" });
  assert.equal((await apps.app()).described, "App");
  assert.equal(recorder.calls.length, 2);
});

test("an app address the install path cannot be built on is an outage", async (t) => {
  const recorder = fixtureForge([fixtureApp("not a url")]);
  const apps = githubApps(fixtureAppOptions(t, recorder));
  assert.deepEqual(await apps.app(), { described: "Unavailable" });
});

test("one installation of this app is read, and one of another is unknown", async (t) => {
  const ours = fixtureForge([fixtureInstallationAnswer(fixtureAppId)]);
  assert.deepEqual(
    await githubInstallationDirectory(fixtureAppOptions(t, ours)).installation(
      fixtureInstallationId,
    ),
    {
      read: "Installation",
      installation: {
        account: asForgeAccount("kasofsk"),
        accountKind: "Organization",
      },
    },
  );
  assert.equal(
    ours.calls[0]?.url,
    `${fixtureApiUrl}/app/installations/${fixtureInstallationId}`,
  );
  const theirs = fixtureForge([fixtureInstallationAnswer("999999")]);
  assert.deepEqual(
    await githubInstallationDirectory(
      fixtureAppOptions(t, theirs),
    ).installation(fixtureInstallationId),
    { read: "Unknown" },
  );
});

test("an installation the forge does not hold is unknown and an outage is not", async (t) => {
  const absent = fixtureForge([fixtureAnswer(404, {})]);
  assert.deepEqual(
    await githubInstallationDirectory(
      fixtureAppOptions(t, absent),
    ).installation(fixtureInstallationId),
    { read: "Unknown" },
  );
  const down = fixtureForge([fixtureAnswer(503, {})]);
  assert.deepEqual(
    await githubInstallationDirectory(fixtureAppOptions(t, down)).installation(
      fixtureInstallationId,
    ),
    { read: "Unavailable" },
  );
});

test("an account kind this tree does not declare is an outage and never a claim", async (t) => {
  const strange = fixtureForge([
    fixtureAnswer(200, {
      app_id: Number(fixtureAppId),
      account: { login: "kasofsk", type: "Enterprise" },
    }),
  ]);
  assert.deepEqual(
    await githubInstallationDirectory(
      fixtureAppOptions(t, strange),
    ).installation(fixtureInstallationId),
    { read: "Unavailable" },
  );
});

test("the listing mints for the whole installation and names no repository", async () => {
  const asked: ForgeTokenRequest[] = [];
  const recorder = fixtureForge([fixturePage(1, 2, 2)]);
  const read = await githubInstallationRepositories({
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    tokens: fixtureTokens(fixtureGranted, asked),
  }).repositories(fixtureInstallation);
  assert.equal(read.read, "Repositories");
  assert.deepEqual(asked, [
    { installation: fixtureInstallation, permissions: "read" },
  ]);
  assert.equal(
    recorder.calls[0]?.headers["authorization"],
    `Bearer ${fixtureToken}`,
  );
  assert.equal(
    recorder.calls[0]?.url,
    `${fixtureApiUrl}/installation/repositories?per_page=100&page=1`,
  );
});

test("a short page ends the listing and the clone address is the identity", async () => {
  const recorder = fixtureForge([fixturePage(1, 2, 2)]);
  const read = await githubInstallationRepositories({
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    tokens: fixtureTokens(fixtureGranted),
  }).repositories(fixtureInstallation);
  assert.deepEqual(read, {
    read: "Repositories",
    truncated: false,
    repositories: [
      {
        name: "repo-1",
        fullName: "kasofsk/repo-1",
        url: "https://github.com/kasofsk/repo-1.git",
        defaultBranch: "main",
        private: false,
      },
      {
        name: "repo-2",
        fullName: "kasofsk/repo-2",
        url: "https://github.com/kasofsk/repo-2.git",
        defaultBranch: "main",
        private: false,
      },
    ],
  });
  assert.equal(recorder.calls.length, 1);
});

test("a full page is followed by the next, and the bound stops the paging", async () => {
  const recorder = fixtureForge([
    fixturePage(1, fixturePageSize, 400),
    fixturePage(101, fixturePageSize, 400),
    fixturePage(201, fixturePageSize, 400),
    fixturePage(301, fixturePageSize, 400),
  ]);
  const read = await githubInstallationRepositories({
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    tokens: fixtureTokens(fixtureGranted),
    repositoriesMax: 250,
  }).repositories(fixtureInstallation);
  assert.equal(read.read === "Repositories" && read.repositories.length, 250);
  assert.equal(read.read === "Repositories" && read.truncated, true);
  assert.equal(recorder.calls.length, 3);
  assert.equal(
    recorder.calls[1]?.url,
    `${fixtureApiUrl}/installation/repositories?per_page=100&page=2`,
  );
});

test("a listing that is all of it is not truncated even at the bound", async () => {
  const recorder = fixtureForge([fixturePage(1, 2, 2)]);
  const read = await githubInstallationRepositories({
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    tokens: fixtureTokens(fixtureGranted),
    repositoriesMax: 2,
  }).repositories(fixtureInstallation);
  assert.equal(read.read === "Repositories" && read.truncated, false);
});

test("a refused mint is denied and an unreachable forge is not", async () => {
  const denied = fixtureForge([]);
  assert.deepEqual(
    await githubInstallationRepositories({
      fetch: denied.requestFetch,
      apiUrl: fixtureApiUrl,
      tokens: fixtureTokens({ minted: "Denied" }),
    }).repositories(fixtureInstallation),
    { read: "Denied" },
  );
  assert.deepEqual(denied.calls, []);
  const down = fixtureForge([]);
  assert.deepEqual(
    await githubInstallationRepositories({
      fetch: down.requestFetch,
      apiUrl: fixtureApiUrl,
      tokens: fixtureTokens({ minted: "Unavailable" }),
    }).repositories(fixtureInstallation),
    { read: "Unavailable" },
  );
});

test("an installation the forge refuses mid-listing is denied and a fault is not", async () => {
  const refused = fixtureForge([
    fixturePage(1, fixturePageSize, 400),
    fixtureAnswer(403, {}),
  ]);
  assert.deepEqual(
    await githubInstallationRepositories({
      fetch: refused.requestFetch,
      apiUrl: fixtureApiUrl,
      tokens: fixtureTokens(fixtureGranted),
      repositoriesMax: 250,
    }).repositories(fixtureInstallation),
    { read: "Denied" },
  );
  const broken = fixtureForge([fixtureAnswer(200, { total_count: "many" })]);
  assert.deepEqual(
    await githubInstallationRepositories({
      fetch: broken.requestFetch,
      apiUrl: fixtureApiUrl,
      tokens: fixtureTokens(fixtureGranted),
    }).repositories(fixtureInstallation),
    { read: "Unavailable" },
  );
});
