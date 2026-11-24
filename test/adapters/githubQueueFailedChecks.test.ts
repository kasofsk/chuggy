/**
 * The GitHub failed-checks adapter against a forge that answers by address,
 * minted for through the real installation-token adapter: what the token is
 * asked for, which endpoints are read under it, and what every way of not
 * answering keeps.
 *
 * THE MINT IS THE ASSERTION AS MUCH AS THE READ. An endpoint the installation
 * does not grant is one the token never asks for and the adapter never reads,
 * and the recorder is what proves both.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { githubInstallationTokens } from "../../src/adapters/forge/githubInstallationTokens.ts";
import {
  githubQueueFailedChecks,
  githubQueueFailedChecksPagesMax,
  githubQueueFailedChecksPerPage,
} from "../../src/adapters/forge/githubQueueFailedChecks.ts";
import type { QueueFailedChecksPort } from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asForgeAccount,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
  type ForgeRepositoryTokens,
  type ForgeTokenMinted,
} from "../../src/interpreter/forgeInstallation.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { fixtureUrlOf, type ForgeCall } from "./forgeFixtures.ts";

const fixtureApiUrl = "https://forge.invalid";
const fixtureInstallationId = "156333284";
const fixtureToken = "ghs-checks-t1y2u3";
const fixtureCommit = asGitObjectId("a".repeat(40));
const fixtureCommitPath = `/repos/kasofsk/chuggy/commits/${fixtureCommit}`;

/** The app's key pair, generated once because generating one is the slow part. */
const fixtureKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

function fixtureKeyFile(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-forge-checks-"));
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

/** One check run as the forge lists it. */
function fixtureRun(name: string, conclusion: string | null) {
  return { id: 1, name, status: "completed", conclusion };
}

/** One status as the forge lists it. */
function fixtureStatus(context: string, state: string) {
  return { id: 1, context, state };
}

/** What the forge answers each endpoint with, page by page, or how it fails. */
interface FixtureForgeScript {
  readonly grants: Readonly<Record<string, string>>;
  readonly mint?: () => Response;
  readonly checkRuns?: (page: number) => Response;
  readonly statuses?: (page: number) => Response;
}

/** The forge, answering by address and recording every request in order. */
function fixtureForgeOf(script: FixtureForgeScript): {
  readonly requestFetch: typeof fetch;
  readonly calls: ForgeCall[];
} {
  const calls: ForgeCall[] = [];
  const requestFetch: typeof fetch = (input, init) => {
    const url = new URL(fixtureUrlOf(input));
    calls.push({
      url: url.href,
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === "string" ? init.body : undefined,
      redirect: init?.redirect,
    });
    const page = Number(url.searchParams.get("page") ?? "1");
    if (url.pathname === `/app/installations/${fixtureInstallationId}`)
      return Promise.resolve(
        Response.json({
          id: Number(fixtureInstallationId),
          permissions: { contents: "write", ...script.grants },
        }),
      );
    if (
      url.pathname ===
      `/app/installations/${fixtureInstallationId}/access_tokens`
    )
      return Promise.resolve(
        script.mint?.() ??
          Response.json(
            { token: fixtureToken, expires_at: "2099-09-10T12:00:00Z" },
            { status: 201 },
          ),
      );
    if (url.pathname === `${fixtureCommitPath}/check-runs` && script.checkRuns)
      return Promise.resolve(script.checkRuns(page));
    if (url.pathname === `${fixtureCommitPath}/status` && script.statuses)
      return Promise.resolve(script.statuses(page));
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  return { requestFetch, calls };
}

/** Per repository, the installation the fixture claims, minting through the real adapter. */
function fixtureRepositoryTokens(
  t: TestContext,
  requestFetch: typeof fetch,
): ForgeRepositoryTokens {
  const tokens = githubInstallationTokens({
    fetch: requestFetch,
    appId: "4708055",
    privateKeyPath: fixtureKeyFile(t),
    apiUrl: fixtureApiUrl,
  });
  return {
    token: (_repository, _partition, permissions): Promise<ForgeTokenMinted> =>
      tokens.mint({
        installation: {
          forge: asForgeId("github"),
          app: "worker",
          account: asForgeAccount("kasofsk"),
          installationId: asForgeInstallationId(fixtureInstallationId),
        },
        repositories: [asForgeRepositoryName("chuggy")],
        permissions,
      }),
  };
}

function fixtureAdapter(
  requestFetch: typeof fetch,
  tokens: ForgeRepositoryTokens,
): QueueFailedChecksPort {
  return githubQueueFailedChecks({
    fetch: requestFetch,
    apiUrl: fixtureApiUrl,
    tokens,
  });
}

const fixtureRequest = {
  repository: asRepositoryId("https://github.com/kasofsk/chuggy"),
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  commit: fixtureCommit,
};

/** The run and status pages one case answers, each a single page. */
const fixtureRunsPage = () =>
  Response.json({
    total_count: 7,
    check_runs: [
      fixtureRun("check", "failure"),
      fixtureRun("e2e", "timed_out"),
      fixtureRun("lint", "success"),
      fixtureRun("deploy", "cancelled"),
      fixtureRun("approve", "action_required"),
      fixtureRun("docs", "neutral"),
      fixtureRun("slow", null),
    ],
  });
const fixtureStatusesPage = () =>
  Response.json({
    state: "failure",
    total_count: 4,
    statuses: [
      fixtureStatus("check", "failure"),
      fixtureStatus("ci/broken", "error"),
      fixtureStatus("ci/fine", "success"),
      fixtureStatus("ci/waiting", "pending"),
    ],
  });

/** What one recorded mint asked the forge for. */
function fixtureMintAsked(calls: readonly ForgeCall[]): unknown {
  const mint = calls.find((call) => call.method === "POST");
  return (JSON.parse(mint?.body ?? "{}") as { permissions?: unknown })
    .permissions;
}

/** The commit endpoints the adapter read, in order. */
function fixtureEndpointsRead(calls: readonly ForgeCall[]): readonly string[] {
  return calls
    .map((call) => new URL(call.url).pathname)
    .filter((path) => path.startsWith(fixtureCommitPath))
    .map((path) => path.slice(fixtureCommitPath.length + 1));
}

test("with both granted, a token asking for both reads both and keeps the failed runs and statuses alone, a name failed on both kept once", async (t) => {
  const forge = fixtureForgeOf({
    grants: { checks: "read", statuses: "read" },
    checkRuns: fixtureRunsPage,
    statuses: fixtureStatusesPage,
  });
  const read = await fixtureAdapter(
    forge.requestFetch,
    fixtureRepositoryTokens(t, forge.requestFetch),
  ).read(fixtureRequest);
  assert.deepEqual(read, {
    names: ["check", "e2e", "deploy", "approve", "ci/broken"],
    truncated: false,
  });
  assert.deepEqual(fixtureMintAsked(forge.calls), {
    contents: "read",
    checks: "read",
    statuses: "read",
  });
  assert.deepEqual(fixtureEndpointsRead(forge.calls), ["check-runs", "status"]);
  for (const call of forge.calls.filter((one) =>
    one.url.includes(fixtureCommitPath),
  )) {
    assert.equal(call.method, "GET");
    assert.equal(call.headers["authorization"], `Bearer ${fixtureToken}`);
    assert.equal(
      new URL(call.url).searchParams.get("per_page"),
      String(githubQueueFailedChecksPerPage),
    );
  }
});

test("with one granted, no mint asks for the other and only its endpoint is read", async (t) => {
  const cases = [
    [{ checks: "read" }, { contents: "read", checks: "read" }, ["check-runs"]],
    [{ statuses: "read" }, { contents: "read", statuses: "read" }, ["status"]],
  ] as const;
  for (const [grants, asked, endpoints] of cases) {
    const forge = fixtureForgeOf({
      grants,
      checkRuns: fixtureRunsPage,
      statuses: fixtureStatusesPage,
    });
    const read = await fixtureAdapter(
      forge.requestFetch,
      fixtureRepositoryTokens(t, forge.requestFetch),
    ).read(fixtureRequest);
    const which = JSON.stringify(grants);
    assert.deepEqual(fixtureMintAsked(forge.calls), asked, which);
    assert.deepEqual(fixtureEndpointsRead(forge.calls), endpoints, which);
    assert.deepEqual(
      read?.names,
      endpoints[0] === "check-runs"
        ? ["check", "e2e", "deploy", "approve"]
        : ["check", "ci/broken"],
      which,
    );
  }
});

test("with neither granted, no mint asks for either, nothing is read and nothing is kept", async (t) => {
  const forge = fixtureForgeOf({
    grants: {},
    checkRuns: fixtureRunsPage,
    statuses: fixtureStatusesPage,
  });
  const read = await fixtureAdapter(
    forge.requestFetch,
    fixtureRepositoryTokens(t, forge.requestFetch),
  ).read(fixtureRequest);
  assert.equal(read, undefined);
  assert.deepEqual(fixtureMintAsked(forge.calls), { contents: "read" });
  assert.deepEqual(fixtureEndpointsRead(forge.calls), []);
});

test("a refused or failing mint keeps nothing and reads no endpoint", async (t) => {
  for (const mint of [
    () => Response.json({ message: "no" }, { status: 403 }),
    () => new Response("{}", { status: 500 }),
  ]) {
    const forge = fixtureForgeOf({
      grants: { checks: "read", statuses: "read" },
      mint,
      checkRuns: fixtureRunsPage,
      statuses: fixtureStatusesPage,
    });
    const read = await fixtureAdapter(
      forge.requestFetch,
      fixtureRepositoryTokens(t, forge.requestFetch),
    ).read(fixtureRequest);
    assert.equal(read, undefined);
    assert.deepEqual(fixtureEndpointsRead(forge.calls), []);
  }
  const raising: ForgeRepositoryTokens = {
    token: () => Promise.reject(new Error("the store went away")),
  };
  const forge = fixtureForgeOf({ grants: {} });
  assert.equal(
    await fixtureAdapter(forge.requestFetch, raising).read(fixtureRequest),
    undefined,
  );
  assert.deepEqual(forge.calls, []);
});

test("an endpoint refused, failing or unreadable keeps nothing of its own and leaves the other's names", async (t) => {
  const failing = [
    () =>
      Response.json({ message: "Resource not accessible" }, { status: 403 }),
    () => new Response("{}", { status: 500 }),
    () => new Response("{", { status: 200 }),
    () => Response.json({ total_count: 1 }),
  ];
  for (const fail of failing) {
    for (const side of ["checkRuns", "statuses"] as const) {
      const forge = fixtureForgeOf({
        grants: { checks: "read", statuses: "read" },
        checkRuns: side === "checkRuns" ? fail : fixtureRunsPage,
        statuses: side === "statuses" ? fail : fixtureStatusesPage,
      });
      const read = await fixtureAdapter(
        forge.requestFetch,
        fixtureRepositoryTokens(t, forge.requestFetch),
      ).read(fixtureRequest);
      assert.deepEqual(
        read?.names,
        side === "checkRuns"
          ? ["check", "ci/broken"]
          : ["check", "e2e", "deploy", "approve"],
        side,
      );
    }
  }
});

test("a token held from an earlier mint reads what was granted when it was minted", async (t) => {
  const grants: Record<string, string> = { checks: "read" };
  const forge = fixtureForgeOf({
    grants,
    checkRuns: fixtureRunsPage,
    statuses: fixtureStatusesPage,
  });
  const adapter = fixtureAdapter(
    forge.requestFetch,
    fixtureRepositoryTokens(t, forge.requestFetch),
  );
  await adapter.read(fixtureRequest);
  grants["statuses"] = "read";
  forge.calls.length = 0;
  const read = await adapter.read(fixtureRequest);
  assert.deepEqual(
    forge.calls.map((call) => call.method),
    ["GET"],
    "the held token mints nothing and reads one endpoint",
  );
  assert.deepEqual(fixtureEndpointsRead(forge.calls), ["check-runs"]);
  assert.deepEqual(read?.names, ["check", "e2e", "deploy", "approve"]);
});

test("a name that is not a briefing line, or past its bound, is left out as a cut", async (t) => {
  const forge = fixtureForgeOf({
    grants: { checks: "read" },
    checkRuns: () =>
      Response.json({
        total_count: 4,
        check_runs: [
          fixtureRun("check", "failure"),
          fixtureRun("two\nlines", "failure"),
          fixtureRun("x".repeat(1_000), "failure"),
          fixtureRun("check", "failure"),
        ],
      }),
  });
  const read = await fixtureAdapter(
    forge.requestFetch,
    fixtureRepositoryTokens(t, forge.requestFetch),
  ).read(fixtureRequest);
  assert.deepEqual(read, { names: ["check"], truncated: true });
});

test("pages are read until the forge's count is met, and a read stopped at the page bound says it was cut", async (t) => {
  const full = (page: number) =>
    Array.from({ length: githubQueueFailedChecksPerPage }, (_none, at) =>
      fixtureRun(
        `run ${String(page)}-${String(at)}`,
        at === 0 ? "failure" : "success",
      ),
    );
  for (const [total, cut] of [
    [githubQueueFailedChecksPagesMax * githubQueueFailedChecksPerPage, false],
    [
      githubQueueFailedChecksPagesMax * githubQueueFailedChecksPerPage + 1,
      true,
    ],
  ] as const) {
    const forge = fixtureForgeOf({
      grants: { checks: "read" },
      checkRuns: (page) =>
        Response.json({ total_count: total, check_runs: full(page) }),
    });
    const read = await fixtureAdapter(
      forge.requestFetch,
      fixtureRepositoryTokens(t, forge.requestFetch),
    ).read(fixtureRequest);
    assert.equal(
      fixtureEndpointsRead(forge.calls).length,
      githubQueueFailedChecksPagesMax,
      String(total),
    );
    assert.deepEqual(
      read,
      {
        names: Array.from(
          { length: githubQueueFailedChecksPagesMax },
          (_none, at) => `run ${String(at + 1)}-0`,
        ),
        truncated: cut,
      },
      String(total),
    );
  }
});

test("a repository this forge does not address is read for nothing, and mints nothing", async (t) => {
  const forge = fixtureForgeOf({ grants: { checks: "read" } });
  const read = await fixtureAdapter(
    forge.requestFetch,
    fixtureRepositoryTokens(t, forge.requestFetch),
  ).read({
    ...fixtureRequest,
    repository: asRepositoryId("https://example.invalid/kasofsk/chuggy"),
  });
  assert.equal(read, undefined);
  assert.deepEqual(forge.calls, []);
});
