/**
 * The six onboarding routes, driven end to end: the permit, the service, the
 * forge adapters and an injected fetch, with only the durable side held in
 * memory.
 *
 * IT IS COMPOSED AND NOT FAKED AT THE BOUNDARY. A suite that handed the routes
 * a stub service would prove the status codes and nothing about which permit
 * each route asks for, which forge request each makes, or that the claim a
 * listing answers is the one the claim route recorded.
 *
 * EVERY REFUSED PERMIT IS 404 AND NOT 403. A caller who may not administer a
 * tenant is not told which accounts it has claimed, and one who may not
 * administer a project is not told whether it exists; the cases assert the body
 * as well as the status, because an envelope naming the resource would give
 * that away while the status did not.
 *
 * AN AUTHORITY THAT CANNOT ANSWER IS A WAIT. Keto being down is 503 with a
 * `retry-after`, never a refusal, because a refusal would be this deployment
 * deciding a question the relation store never answered.
 *
 * THE CLAIM AND THE BIND ARE VERSIONED WRITES like every other, and the bind
 * carries the operation identity in the header, so a retry is one attempt.
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
  nativeHttpMediaType,
  type HttpErrorEnvelope,
} from "../../src/contract/http.ts";
import {
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
  type ForgeApp,
  type ForgeInstallationTokens,
} from "../../src/interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaimed,
  ForgeInstallationRecorded,
} from "../../src/interpreter/forgeInstallationClaim.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import type {
  ProjectRepositoryBound,
  RepositoryBindingOutcome,
} from "../../src/interpreter/repositoryBinding.ts";
import {
  repositoryOnboarding,
  type RepositoryOnboarding,
} from "../../src/interpreter/repositoryOnboarding.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { fixtureForge, type ForgeRecorder } from "./forgeFixtures.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const tenant = asTenantId("acme");
const partition = { tenant, project: asProjectId("atlas") };
const principal = asPrincipal("issuer geoff");
const forge = asForgeId("github");
const app = asForgeApp("portal");
const worker = asForgeApp("worker");
const bothApps = [app, worker] as const;
const installationId = asForgeInstallationId("156333284");
const repository = asRepositoryId("https://github.com/acme/atlas.git");
const epoch = asRecoveryEpoch("epoch-1");

const tenantRoot = `/api/v1/tenants/${tenant}`;
const installationsRoot = `${tenantRoot}/forge-installations`;
const repositoriesRoot = `${tenantRoot}/projects/${partition.project}/repositories`;
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };
const keyed = { ...versioned, "idempotency-key": "bind-atlas-1" };

/**
 * One App id per app, which is what tells the two halves apart: GitHub answers
 * an installation with the id of the App it belongs to, and the directory
 * refuses one that is not its own, so a service reading through the wrong
 * half's adapter is answered `Unknown` here rather than passing on the label it
 * recorded.
 */
const fixtureAppIds: Readonly<Record<ForgeApp, string>> = {
  portal: "4708055",
  worker: "4728465",
};

const fixtureSlugs: Readonly<Record<ForgeApp, string>> = {
  portal: "chuggy-portal",
  worker: "chuggy-worker",
};
const fixtureApiUrl = "https://forge.invalid";
const fixtureKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

const claimed: ForgeInstallationClaimed = {
  forge,
  app,
  account: asForgeAccount("acme"),
  accountKind: "Organization",
  installationId,
  claimedAt: "2026-09-11T00:00:00Z",
};

function keyFile(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-onboarding-key-"));
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

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * The three answers a case injects. Each is built per call because a `Response`
 * body is read once, and a shared one would answer the first case and be empty
 * for the next.
 */
function appAnswer(held: ForgeApp = app): Response {
  return answer(200, {
    id: Number(fixtureAppIds[held]),
    slug: fixtureSlugs[held],
    html_url: `https://github.com/apps/${fixtureSlugs[held]}`,
  });
}

function installationAnswer(held: ForgeApp = app): Response {
  return answer(200, {
    app_id: Number(fixtureAppIds[held]),
    account: { login: "acme", type: "Organization" },
  });
}

function repositoriesAnswer(): Response {
  return answer(200, {
    total_count: 1,
    repositories: [
      {
        name: "atlas",
        full_name: "acme/atlas",
        clone_url: repository,
        default_branch: "main",
        private: true,
      },
    ],
  });
}

/** The durable side, which this suite holds in memory so a case can read back what it wrote. */
interface OnboardingStore {
  readonly held: ForgeInstallationClaimed[];
  readonly bound: ProjectRepositoryBound[];
  recorded: ForgeInstallationRecorded;
  outcome: RepositoryBindingOutcome;
  resolved: CredentialResolved;
}

function fixtureStore(): OnboardingStore {
  return {
    held: [],
    bound: [],
    recorded: "Recorded",
    outcome: "Bound",
    resolved: {
      resolved: "Credential",
      credential: asRepositoryCredential("ghs-proof"),
    },
  };
}

/** The mint the repositories listing pages under, which needs no key of its own. */
const listingTokens: ForgeInstallationTokens = {
  mint: () =>
    Promise.resolve({
      minted: "Token",
      token: asForgeInstallationToken("ghs-listing"),
      expiresAtMs: 4_102_444_800_000,
    }),
};

function fixtureService(
  t: TestContext,
  store: OnboardingStore,
  recorder: ForgeRecorder,
  access: ReturnType<typeof memoryProjectAccess>,
  apps: readonly ForgeApp[],
): RepositoryOnboarding {
  const privateKeyPath = keyFile(t);
  const credentials: RepositoryCredentialPort = {
    credential: () => Promise.resolve(store.resolved),
  };
  const half = (held: ForgeApp) => {
    const options = {
      fetch: recorder.requestFetch,
      apiUrl: fixtureApiUrl,
      appId: fixtureAppIds[held],
      privateKeyPath,
    };
    return {
      forge,
      app: held,
      apps: githubApps(options),
      directory: githubInstallationDirectory(options),
      installationRepositories: githubInstallationRepositories({
        fetch: recorder.requestFetch,
        apiUrl: fixtureApiUrl,
        tokens: listingTokens,
      }),
    };
  };
  return repositoryOnboarding({
    access,
    credentials,
    forgeApps: apps.map(half),
    recording: {
      record: (claim) => {
        if (store.recorded !== "ClaimedElsewhere")
          store.held.push({
            forge: claim.forge,
            app: claim.app,
            account: claim.account,
            accountKind: claim.accountKind,
            installationId: claim.installationId,
            claimedAt: claimed.claimedAt,
          });
        return Promise.resolve(store.recorded);
      },
    },
    claims: {
      claims: () => Promise.resolve({ claims: store.held, truncated: false }),
      claim: (_tenant, askedInstallation) =>
        Promise.resolve(
          store.held.find((row) => row.installationId === askedInstallation),
        ),
    },
    bindings: { bindings: () => Promise.resolve(store.bound) },
    binding: {
      currentRecoveryEpoch: () => Promise.resolve(epoch),
      bind: (command) => {
        if (store.outcome === "Bound")
          store.bound.push({
            repository: command.repository,
            boundAt: "2026-09-11T01:00:00Z",
          });
        return Promise.resolve(store.outcome);
      },
    },
  });
}

/** One case: the server, what the forge was asked, and what the durable side holds. */
function fixtureCase(
  t: TestContext,
  given: {
    readonly answers?: readonly (Response | Error)[];
    readonly granted?: readonly ("AdministerTenant" | "Administer" | "Read")[];
    readonly store?: OnboardingStore;
    readonly apps?: readonly ForgeApp[];
  } = {},
) {
  const store = given.store ?? fixtureStore();
  const recorder = fixtureForge(given.answers ?? []);
  const access = memoryProjectAccess();
  const granted = given.granted ?? [];
  const project = granted.filter((kind) => kind !== "AdministerTenant");
  if (granted.includes("AdministerTenant"))
    access.grantTenant({
      tenant,
      principal,
      access: new Set(["AdministerTenant"]),
    });
  if (project.length > 0)
    access.grant({ partition, principal, access: new Set(project) });
  const app = servedNativeHttpApp(
    unservedNativeWeb,
    fixtureService(t, store, recorder, access, given.apps ?? bothApps),
  );
  t.after(() => app.close());
  return { app, store, recorder, access };
}

/** The app as the route answers it, which is that app's own identity and no other's. */
function describedApp(held: ForgeApp) {
  return {
    app: held,
    id: fixtureAppIds[held],
    slug: fixtureSlugs[held],
    installUrl: `https://github.com/apps/${fixtureSlugs[held]}/installations/new`,
  };
}

test("the apps route answers every bearer and asks each forge once", async (t) => {
  const one = fixtureCase(t, {
    answers: [appAnswer(app), appAnswer(worker)],
    apps: [app, worker],
  });
  const first = await one.app.inject({
    url: "/api/v1/forge/github",
    headers: authorized,
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), {
    apps: [describedApp(app), describedApp(worker)],
  });
  const second = await one.app.inject({
    url: "/api/v1/forge/github",
    headers: authorized,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(one.recorder.calls.length, 2);
});

test("a claim for an app this deployment holds no key for is not configured", async (t) => {
  const portalOnly = fixtureCase(t, {
    answers: [installationAnswer(worker)],
    granted: ["AdministerTenant"],
    apps: [app],
  });
  const served = await portalOnly.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "worker", installationId },
  });
  assert.equal(served.statusCode, 404);
  assert.equal(
    served.json<HttpErrorEnvelope>().error.code,
    "ForgeNotConfigured",
  );
  assert.deepEqual(portalOnly.recorder.calls, []);
  assert.deepEqual(portalOnly.store.held, []);
});

test("a worker installation is claimed through the worker's own app", async (t) => {
  const both = fixtureCase(t, {
    answers: [installationAnswer(worker)],
    granted: ["AdministerTenant"],
    apps: [app, worker],
  });
  const served = await both.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "worker", installationId },
  });
  assert.equal(served.statusCode, 201);
  assert.equal(both.store.held[0]?.app, worker);
});

test("a worker installation read through the portal's app is not the worker's", async (t) => {
  const both = fixtureCase(t, {
    answers: [installationAnswer(app)],
    granted: ["AdministerTenant"],
    apps: [app, worker],
  });
  const served = await both.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "worker", installationId },
  });
  assert.equal(served.statusCode, 404);
  assert.equal(
    served.json<HttpErrorEnvelope>().error.code,
    "InstallationUnknown",
  );
  assert.deepEqual(both.store.held, []);
});

test("a forge that could not be reached is a wait and not an app", async (t) => {
  const down = fixtureCase(t, { answers: [answer(503, {})] });
  const served = await down.app.inject({
    url: "/api/v1/forge/github",
    headers: authorized,
  });
  assert.equal(served.statusCode, 503);
  assert.equal(typeof served.headers["retry-after"], "string");
  assert.equal(served.json<HttpErrorEnvelope>().error.code, "ForgeUnavailable");
});

test("a claim without the tenant permit is not found and asks no forge", async (t) => {
  const refused = fixtureCase(t, { answers: [installationAnswer()] });
  const served = await refused.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(served.statusCode, 404);
  assert.deepEqual(served.json(), {
    error: { code: "NotFound", message: "Resource not found." },
  });
  assert.deepEqual(refused.recorder.calls, []);
  assert.deepEqual(refused.store.held, []);
});

test("a claim is created at its own address and read back by the listing", async (t) => {
  const claiming = fixtureCase(t, {
    answers: [installationAnswer()],
    granted: ["AdministerTenant"],
  });
  const served = await claiming.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(served.statusCode, 201);
  assert.equal(
    served.headers["location"],
    `${installationsRoot}/${installationId}`,
  );
  assert.deepEqual(served.json(), {
    forge,
    app,
    account: "acme",
    accountKind: "Organization",
    installationId,
  });
  const listed = await claiming.app.inject({
    url: installationsRoot,
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), {
    truncated: false,
    installations: [
      {
        forge,
        app,
        account: "acme",
        accountKind: "Organization",
        installationId,
        claimedAt: claimed.claimedAt,
      },
    ],
  });
});

test("a replayed claim is the claim as it stands and a taken one is a conflict", async (t) => {
  const store = fixtureStore();
  store.recorded = "AlreadyRecorded";
  const replay = fixtureCase(t, {
    answers: [installationAnswer()],
    granted: ["AdministerTenant"],
    store,
  });
  const replayed = await replay.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.headers["location"], undefined);

  const taken = fixtureStore();
  taken.recorded = "ClaimedElsewhere";
  const conflict = fixtureCase(t, {
    answers: [installationAnswer()],
    granted: ["AdministerTenant"],
    store: taken,
  });
  const refused = await conflict.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    "InstallationClaimed",
  );
});

test("an installation this app does not hold is unknown", async (t) => {
  const unknown = fixtureCase(t, {
    answers: [answer(404, {})],
    granted: ["AdministerTenant"],
  });
  const served = await unknown.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: versioned,
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(served.statusCode, 404);
  assert.equal(
    served.json<HttpErrorEnvelope>().error.code,
    "InstallationUnknown",
  );
  assert.deepEqual(unknown.store.held, []);
});

test("a claim sent as unversioned json is refused before it reaches the forge", async (t) => {
  const plain = fixtureCase(t, {
    answers: [installationAnswer()],
    granted: ["AdministerTenant"],
  });
  const served = await plain.app.inject({
    method: "POST",
    url: installationsRoot,
    headers: { ...authorized, "content-type": "application/json" },
    payload: { forge: "github", app: "portal", installationId },
  });
  assert.equal(served.statusCode, 415);
  assert.deepEqual(plain.recorder.calls, []);
});

test("an authority that cannot answer is a wait at every onboarding route", async (t) => {
  const broken = fixtureCase(t, { granted: ["AdministerTenant", "Read"] });
  broken.access.breaks();
  for (const url of [installationsRoot, repositoriesRoot]) {
    const served = await broken.app.inject({ url, headers: authorized });
    assert.equal(served.statusCode, 503, url);
    assert.equal(typeof served.headers["retry-after"], "string", url);
  }
});

test("what an installation grants is read through the tenant's own claim", async (t) => {
  const store = fixtureStore();
  store.held.push(claimed);
  const listing = fixtureCase(t, {
    answers: [repositoriesAnswer()],
    granted: ["AdministerTenant"],
    store,
  });
  const served = await listing.app.inject({
    url: `${installationsRoot}/${installationId}/repositories`,
    headers: authorized,
  });
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.json(), {
    truncated: false,
    repositories: [
      {
        name: "atlas",
        fullName: "acme/atlas",
        url: repository,
        defaultBranch: "main",
        private: true,
      },
    ],
  });
  assert.equal(
    listing.recorder.calls[0]?.url,
    `${fixtureApiUrl}/installation/repositories?per_page=100&page=1`,
  );
});

test("an installation this tenant has not claimed is not found and asks no forge", async (t) => {
  const other = fixtureCase(t, {
    answers: [repositoriesAnswer()],
    granted: ["AdministerTenant"],
  });
  const served = await other.app.inject({
    url: `${installationsRoot}/${installationId}/repositories`,
    headers: authorized,
  });
  assert.equal(served.statusCode, 404);
  assert.deepEqual(other.recorder.calls, []);
});

test("a bind without the project permit is not found and writes nothing", async (t) => {
  const refused = fixtureCase(t, { granted: ["Read"] });
  const served = await refused.app.inject({
    method: "POST",
    url: repositoriesRoot,
    headers: keyed,
    payload: { repository },
  });
  assert.equal(served.statusCode, 404);
  assert.deepEqual(refused.store.bound, []);
});

test("a bind is created at its own address and read back by the listing", async (t) => {
  const binding = fixtureCase(t, { granted: ["Administer", "Read"] });
  const served = await binding.app.inject({
    method: "POST",
    url: repositoriesRoot,
    headers: keyed,
    payload: { repository },
  });
  assert.equal(served.statusCode, 201);
  assert.equal(
    served.headers["location"],
    `${repositoriesRoot}/${encodeURIComponent(repository)}`,
  );
  assert.deepEqual(served.json(), { repository });
  const listed = await binding.app.inject({
    url: repositoriesRoot,
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), {
    repositories: [{ repository, boundAt: "2026-09-11T01:00:00Z" }],
  });
});

test("a repository no source can reach is the request's own fault", async (t) => {
  const store = fixtureStore();
  store.resolved = { resolved: "Denied" };
  const denied = fixtureCase(t, { granted: ["Administer"], store });
  const served = await denied.app.inject({
    method: "POST",
    url: repositoriesRoot,
    headers: keyed,
    payload: { repository },
  });
  assert.equal(served.statusCode, 422);
  assert.equal(
    served.json<HttpErrorEnvelope>().error.code,
    "RepositoryNotInstalled",
  );
  assert.deepEqual(store.bound, []);
});

test("each outcome the bind door answers with reaches the wire as its own", async (t) => {
  const expected: readonly (readonly [
    RepositoryBindingOutcome,
    number,
    string | undefined,
  ])[] = [
    ["AlreadyBound", 200, undefined],
    ["OperationConflict", 409, "OperationConflict"],
    ["RepositoryBoundElsewhere", 409, "RepositoryBound"],
    ["RecoveryEpochMismatch", 503, "RecoveryEpochChanged"],
    ["ProjectAbsent", 404, "NotFound"],
  ];
  for (const [outcome, status, error] of expected) {
    const store = fixtureStore();
    store.outcome = outcome;
    const bound = fixtureCase(t, { granted: ["Administer"], store });
    const served = await bound.app.inject({
      method: "POST",
      url: repositoriesRoot,
      headers: keyed,
      payload: { repository },
    });
    assert.equal(served.statusCode, status, outcome);
    if (error !== undefined)
      assert.equal(served.json<HttpErrorEnvelope>().error.code, error, outcome);
  }
});

test("a bind naming no operation identity is refused", async (t) => {
  const unkeyed = fixtureCase(t, { granted: ["Administer"] });
  const served = await unkeyed.app.inject({
    method: "POST",
    url: repositoriesRoot,
    headers: versioned,
    payload: { repository },
  });
  assert.equal(served.statusCode, 400);
  assert.deepEqual(unkeyed.store.bound, []);
});

test("what a project binds is its readers' and nobody else's", async (t) => {
  const refused = fixtureCase(t, { granted: ["Administer"] });
  const served = await refused.app.inject({
    url: repositoriesRoot,
    headers: authorized,
  });
  assert.equal(served.statusCode, 404);
});
