import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import type {
  TicketExecutionAccess,
  TicketExecutionCredentialSubject,
} from "../../src/interpreter/ticketExecution.ts";
import type {
  WorkerPlaneCredentialMinted,
  WorkerPlaneCredentialMinting,
} from "../../src/interpreter/workerPlaneCredentials.ts";
import { inertWorkerPlane } from "./workerPlaneFixtures.ts";

const partition: Partition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};

const view = {
  workload: { runner: "script", command: ["just", "check"] },
  inputs: {},
  resultContract: { type: "object" },
  requiredCapabilities: [],
  context: [],
  repository: "https://git.invalid/owner/repository.git",
  commit: "0123456789012345678901234567890123456789",
  access: "ReadRepository",
};

/** What the row this bearer names says the attempt is, which is the whole of what it may be minted. */
function attemptSubject(
  access: TicketExecutionAccess,
): TicketExecutionCredentialSubject {
  return { partition, repository: asRepositoryId(view.repository), access };
}

/** A plane whose attempt half answers one bearer and nothing else. */
function attemptPlane(
  bearer: string,
  credentials?: WorkerPlaneCredentialMinting,
  access: TicketExecutionAccess = "ReadRepository",
): ReturnType<typeof createWorkerPlaneApp> {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(1_024),
    ...(credentials === undefined ? {} : { credentials }),
    ticketExecutions: {
      report: (secret) =>
        Promise.resolve(secret === bearer ? "Recorded" : "Fenced"),
      view: (secret) => Promise.resolve(secret === bearer ? view : undefined),
      credential: (secret) =>
        Promise.resolve(secret === bearer ? attemptSubject(access) : undefined),
    },
  });
}

const attemptCredential = {
  username: "x-access-token",
  password: asForgeInstallationToken("ghs_0123456789abcdefghij"),
  expiresAtMs: 1_700_000_000_000,
};

/** A minting that records what the plane asked it for, so a case can say the harness widened nothing. */
function mintingOf(
  minted: WorkerPlaneCredentialMinted,
  asked: unknown[] = [],
): WorkerPlaneCredentialMinting {
  return {
    session: () => Promise.resolve(minted),
    attempt: (askedPartition, repository, access) => {
      asked.push({ partition: askedPartition, repository, access });
      return Promise.resolve(minted);
    },
  };
}

test("a harness fetches its own view under the bearer its terminal is written with", async () => {
  const app = attemptPlane("attempt-secret");
  const served = await app.inject({
    method: "GET",
    url: "/v1/ticket-execution/view",
    headers: { authorization: "Bearer attempt-secret" },
  });
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.json(), view);
  const reported = await app.inject({
    method: "POST",
    url: "/v1/ticket-execution/terminal",
    headers: { authorization: "Bearer attempt-secret" },
    payload: { taskKey: "work:1:1", outcome: { type: "result" } },
  });
  assert.equal(reported.statusCode, 204);
});

for (const [why, headers] of [
  ["no bearer at all", {}],
  ["a bearer no live attempt is bound to", { authorization: "Bearer other" }],
] as const)
  test(`a view is refused to ${why}`, async () => {
    const response = await attemptPlane("attempt-secret").inject({
      method: "GET",
      url: "/v1/ticket-execution/view",
      headers,
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { action: "stop" });
  });

test("a plane composed with no attempt half serves no ticket route", async () => {
  const app = createWorkerPlaneApp(inertWorkerPlane(1_024));
  for (const [method, url] of [
    ["GET", "/v1/ticket-execution/view"],
    ["POST", "/v1/ticket-execution/terminal"],
    ["POST", "/v1/ticket-execution/credentials"],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: "Bearer attempt-secret" },
    });
    assert.equal(response.statusCode, 404);
  }
});

/**
 * The access is the row's and the request has nowhere to carry one: a work
 * attempt that publishes is minted write and everything else read, whatever
 * the harness sends.
 */
for (const [access, permitted] of [
  ["PublishRepositoryResult", "a publishing work attempt"],
  ["ReadRepository", "a read-only attempt"],
] as const)
  test(`${permitted} is minted for the repository and access its own row names`, async () => {
    const asked: unknown[] = [];
    const app = attemptPlane(
      "attempt-secret",
      mintingOf({ minted: "Credential", value: attemptCredential }, asked),
      access,
    );
    const answered = await app.inject({
      method: "POST",
      url: "/v1/ticket-execution/credentials",
      headers: { authorization: "Bearer attempt-secret" },
      payload: { access: "PublishRepositoryResult", repository: "other" },
    });
    assert.equal(answered.statusCode, 200);
    assert.deepEqual(answered.json(), attemptCredential);
    assert.deepEqual(asked, [
      { partition, repository: view.repository, access },
    ]);
  });

test("a credential refused for the attempt's repository is not an outage", async () => {
  const answered = await attemptPlane(
    "attempt-secret",
    mintingOf({ minted: "NotFound" }),
  ).inject({
    method: "POST",
    url: "/v1/ticket-execution/credentials",
    headers: { authorization: "Bearer attempt-secret" },
  });
  assert.equal(answered.statusCode, 404);
  assert.deepEqual(answered.json(), { reason: "NotMinted" });
});

test("a forge the plane could not reach is answered as one to ask again", async () => {
  const answered = await attemptPlane(
    "attempt-secret",
    mintingOf({ minted: "Unavailable" }),
  ).inject({
    method: "POST",
    url: "/v1/ticket-execution/credentials",
    headers: { authorization: "Bearer attempt-secret" },
  });
  assert.equal(answered.statusCode, 503);
  assert.deepEqual(answered.json(), { action: "retry" });
});

test("a plane holding no app key mints nothing for an attempt", async () => {
  const answered = await attemptPlane("attempt-secret").inject({
    method: "POST",
    url: "/v1/ticket-execution/credentials",
    headers: { authorization: "Bearer attempt-secret" },
  });
  assert.equal(answered.statusCode, 404);
  assert.deepEqual(answered.json(), { reason: "ForgeNotConfigured" });
});

for (const [why, headers] of [
  ["no bearer at all", {}],
  ["a bearer no live attempt is bound to", { authorization: "Bearer other" }],
] as const)
  test(`a credential is refused to ${why}`, async () => {
    const answered = await attemptPlane(
      "attempt-secret",
      mintingOf({ minted: "Credential", value: attemptCredential }),
    ).inject({
      method: "POST",
      url: "/v1/ticket-execution/credentials",
      headers,
    });
    assert.equal(answered.statusCode, 401);
    assert.deepEqual(answered.json(), { action: "stop" });
  });
