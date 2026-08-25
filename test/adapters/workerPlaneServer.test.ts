import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerPlaneApp,
  workerPlaneRoutes,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";

const authority = {
  live: true,
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  execution: asExecutionId("execution"),
  attempt: asAttemptId("attempt"),
  generation: 1,
  manifest: asResultManifestId("manifest"),
  inputBundle: "bundle",
  inputBundleDigest: "digest",
  inputs: [
    { ordinal: 1, kind: "Repository", reference: "source", digest: "pin" },
  ],
} as const;

test("the worker plane has no tenant-shaped or project-shaped route", () => {
  for (const route of workerPlaneRoutes) {
    assert.doesNotMatch(route, /tenant|project/u);
    assert.doesNotMatch(route, /:[^/]+/u);
  }
});

test("one live bearer scopes input, upload and report to its attempt", async () => {
  const uploaded: unknown[] = [];
  const reported: unknown[] = [];
  const app = createWorkerPlaneApp({
    authority: {
      authenticate: (secret) =>
        Promise.resolve(
          secret === asAttemptCapabilitySecret("held") ? authority : undefined,
        ),
    },
    artifacts: {
      store: (input) => {
        uploaded.push(input);
        return Promise.resolve({ stored: "Stored" });
      },
    },
    reports: {
      report: (_secret, submission) => {
        reported.push(submission);
        return Promise.resolve({ ingested: "Fenced" });
      },
    },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const headers = { authorization: "Bearer held" };
  const input = await app.inject({ method: "GET", url: "/v1/input", headers });
  assert.equal(input.statusCode, 200);
  assert.deepEqual(
    (JSON.parse(input.body) as { references: unknown }).references,
    authority.inputs,
  );
  const upload = await app.inject({
    method: "PUT",
    url: "/v1/artifacts/out.txt",
    headers: { ...headers, "content-type": "application/octet-stream" },
    payload: Buffer.from("result"),
  });
  assert.equal(upload.statusCode, 204);
  assert.equal(uploaded.length, 1);
  const report = await app.inject({
    method: "POST",
    url: "/v1/report",
    headers: { ...headers, "content-type": "text/plain" },
    payload: "{}",
  });
  assert.equal(report.statusCode, 409);
  assert.equal(reported.length, 1);
  assert.equal(
    (reported[0] as { manifest: string }).manifest,
    authority.manifest,
  );
  await app.close();
});

test("an unknown or oversized bearer reaches no attempt act", async () => {
  let acts = 0;
  const app = createWorkerPlaneApp({
    authority: { authenticate: () => Promise.resolve(undefined) },
    artifacts: {
      store: () => {
        acts += 1;
        return Promise.resolve({ stored: "Stored" });
      },
    },
    reports: {
      report: () => {
        acts += 1;
        return Promise.resolve({ ingested: "Fenced" });
      },
    },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  for (const token of ["missing", "x".repeat(257)]) {
    const response = await app.inject({
      method: "GET",
      url: "/v1/input",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(acts, 0);
  await app.close();
});
