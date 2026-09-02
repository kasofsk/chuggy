import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createWorkerPlaneApp,
  workerPlaneRoutes,
  type WorkerRunEvidencePorts,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  runConfigurationBytesMax,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  runTurnSeriesMax,
} from "../../src/contract/http.ts";
import {
  asAttemptCapabilitySecret,
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import type { ReportIngested } from "../../src/interpreter/executionSchedulerReport.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import { inertRunEvidence } from "./workerPlaneFixtures.ts";

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

const heartbeatService = {
  heartbeats: { heartbeat: () => Promise.resolve(true) },
  heartbeatLeaseSecs: 300,
} as const;

/** The evidence ports a case about something else never reaches. */
const runEvidenceService = { runEvidence: inertRunEvidence } as const;

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
    ...heartbeatService,
    ...runEvidenceService,
    authority: {
      authenticate: (secret) =>
        Promise.resolve(
          secret === asAttemptCapabilitySecret("held") ? authority : undefined,
        ),
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
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
    ...heartbeatService,
    ...runEvidenceService,
    authority: { authenticate: () => Promise.resolve(undefined) },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
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

test("a bearer written in the session language is never offered to the attempt authority", async () => {
  const offered: string[] = [];
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: {
      authenticate: (secret) => {
        offered.push(secret);
        return Promise.resolve(authority);
      },
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const session = { authorization: `Bearer chgs_${"a".repeat(32)}` };
  for (const [method, url, body, kind] of [
    ["GET", "/v1/input", undefined, {}],
    ["POST", "/v1/heartbeat", undefined, {}],
    ["PUT", "/v1/artifacts/out.txt", Buffer.from("x"), octets],
    ["POST", "/v1/report", "{}", { "content-type": "text/plain" }],
    ["PUT", "/v1/run/configuration", Buffer.from("{}\n"), octets],
    ["PUT", "/v1/run/transcript/1", Buffer.from("{}\n"), octets],
    ["POST", "/v1/run/totals", {}, {}],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { ...session, ...kind },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(response.statusCode, 401, url);
  }
  assert.deepEqual(offered, []);
  await app.close();
});

test("a live bearer renews only its fenced attempt generation", async () => {
  const calls: unknown[] = [];
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: { authenticate: () => Promise.resolve(authority) },
    heartbeats: {
      heartbeat: (secret, generation, leaseSecs) => {
        calls.push({ secret, generation, leaseSecs });
        return Promise.resolve(true);
      },
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/heartbeat",
    headers: { authorization: "Bearer held" },
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(calls, [
    {
      secret: asAttemptCapabilitySecret("held"),
      generation: authority.generation,
      leaseSecs: 300,
    },
  ]);
  await app.close();
});

test("an invalid worker-controlled artifact path is a predictable client refusal", async () => {
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: { authenticate: () => Promise.resolve(authority) },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: {
      store: () =>
        Promise.resolve({ stored: "Refused", reason: "InvalidPath" }),
    },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const response = await app.inject({
    method: "PUT",
    url: "/v1/artifacts/%2E%2E%2Fescape",
    headers: {
      authorization: "Bearer held",
      "content-type": "application/octet-stream",
    },
    payload: Buffer.from("result"),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    action: "stop",
    reason: "InvalidPath",
  });
  await app.close();
});

test("an exhausted attempt artifact quota is a terminal payload refusal", async () => {
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: { authenticate: () => Promise.resolve(authority) },
    reservations: {
      reserve: () => Promise.resolve({ reserved: "QuotaExceeded" }),
    },
    artifacts: {
      store: () => Promise.resolve({ stored: "Stored" }),
    },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const response = await app.inject({
    method: "PUT",
    url: "/v1/artifacts/result.txt",
    headers: {
      authorization: "Bearer held",
      "content-type": "application/octet-stream",
    },
    payload: Buffer.from("result"),
  });
  assert.equal(response.statusCode, 413);
  assert.deepEqual(JSON.parse(response.body), {
    action: "stop",
    reason: "QuotaExceeded",
  });
  await app.close();
});

/** Injects one report against a plane whose ingest always answers this, and reads the reply. */
async function refusedReport(
  ingested: ReportIngested,
): Promise<{ readonly statusCode: number; readonly body: unknown }> {
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: { authenticate: () => Promise.resolve(authority) },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    reports: { report: () => Promise.resolve(ingested) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/report",
    headers: { authorization: "Bearer held", "content-type": "text/plain" },
    payload: "{}",
  });
  await app.close();
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

test("a refused report carries why it was refused, from the closed rosters", async () => {
  const malformed = await refusedReport({
    ingested: "Malformed",
    code: "MissingField",
  });
  assert.equal(malformed.statusCode, 409);
  assert.deepEqual(malformed.body, { action: "stop", reason: "MissingField" });
  const at = { role: "Handoff", index: 2 } as const;
  const sited = await refusedReport({
    ingested: "Malformed",
    code: "PathAbsolute",
    at,
  });
  assert.deepEqual(sited.body, {
    action: "stop",
    reason: "PathAbsolute",
    at,
  });
  const unconfirmed = await refusedReport({
    ingested: "Unconfirmed",
    failure: "DigestMismatch",
    at,
  });
  assert.equal(unconfirmed.statusCode, 409);
  assert.deepEqual(unconfirmed.body, {
    action: "stop",
    reason: "DigestMismatch",
    at,
  });
});

test("a refusal that is not about the report itself names nothing further", async () => {
  for (const ingested of ["Fenced", "Stale", "NotAdmitted"] as const) {
    const response = await refusedReport({ ingested });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, { action: "stop" });
  }
  const conflicting = await refusedReport({
    ingested: "Conflicting",
    incident: "two results for one attempt",
  });
  assert.deepEqual(conflicting.body, { action: "stop" });
});

test("identical terminal report redelivery reaches its absorbed operation", async () => {
  let reports = 0;
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    authority: {
      authenticate: () =>
        Promise.resolve({ ...authority, live: reports === 0 }),
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    reports: {
      report: () => {
        reports += 1;
        return Promise.resolve(
          reports === 1
            ? {
                ingested: "Terminalized",
                outcome: "Passed",
                operation: asOperationId("operation-one"),
              }
            : {
                ingested: "Absorbed",
                outcome: "Passed",
                operation: asOperationId("operation-one"),
              },
        );
      },
    },
    ready: () => Promise.resolve(true),
    uploadBytesMax: 64,
  });
  for (let delivery = 0; delivery < 2; delivery += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/report",
      headers: { authorization: "Bearer held", "content-type": "text/plain" },
      payload: "{}",
    });
    assert.equal(response.statusCode, 202);
  }
  assert.equal(reports, 2);
  await app.close();
});

/** One plane whose evidence ports are the ones a case is about, everything else inert. */
function runEvidencePlane(
  evidence: Partial<WorkerRunEvidencePorts>,
  stored: unknown[] = [],
  trace: string[] = [],
) {
  return createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    runEvidence: { ...runEvidenceService.runEvidence, ...evidence },
    authority: {
      authenticate: (secret) =>
        Promise.resolve(
          secret === asAttemptCapabilitySecret("held") ? authority : undefined,
        ),
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: {
      store: (input) => {
        trace.push("bytes");
        stored.push({ path: input.path, bytes: input.content.byteLength });
        return Promise.resolve({ stored: "Stored" });
      },
    },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: workerPlaneUploadBytesMax,
  });
}

/** The transport's own body ceiling, above every bound a run's own route holds. */
const workerPlaneUploadBytesMax = runConfigurationBytesMax * 2;

const octets = { "content-type": "application/octet-stream" };
const held = { authorization: "Bearer held" };

test("no run evidence route answers a bearer that is not a live attempt", async () => {
  let reached = 0;
  const counted = () => {
    reached += 1;
    return Promise.resolve("Stored" as const);
  };
  const app = runEvidencePlane({
    configurations: { record: counted },
    transcripts: { record: counted },
    turns: {
      record: () => {
        reached += 1;
        return Promise.resolve({ recorded: "Recorded", turnsRecorded: 0 });
      },
    },
    totals: { record: counted },
    endings: {
      end: () => {
        reached += 1;
        return Promise.resolve(true);
      },
    },
  });
  const stranger = { authorization: "Bearer stranger" };
  for (const [method, url, body, kind] of [
    ["PUT", "/v1/run/configuration", Buffer.from("{}"), octets],
    ["PUT", "/v1/run/transcript/1", Buffer.from("{}"), octets],
    ["POST", "/v1/run/turns", { turns: [] }, {}],
    ["POST", "/v1/run/totals", {}, {}],
    ["POST", "/v1/run/ended", { evidence: "RunFailed" }, {}],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { ...stranger, ...kind },
      payload: body,
    });
    assert.equal(response.statusCode, 401, url);
  }
  assert.equal(reached, 0);
  await app.close();
});

test("a reported attempt writes no evidence, its bearer still resolving", async () => {
  let reached = 0;
  const counted = () => {
    reached += 1;
    return Promise.resolve("Stored" as const);
  };
  const app = createWorkerPlaneApp({
    ...heartbeatService,
    ...runEvidenceService,
    runEvidence: {
      ...runEvidenceService.runEvidence,
      configurations: { record: counted },
      transcripts: { record: counted },
      totals: { record: counted },
    },
    authority: {
      authenticate: () => Promise.resolve({ ...authority, live: false }),
    },
    reservations: { reserve: () => Promise.resolve({ reserved: "Reserved" }) },
    artifacts: { store: () => Promise.resolve({ stored: "Stored" }) },
    reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
    ready: () => Promise.resolve(true),
    uploadBytesMax: workerPlaneUploadBytesMax,
  });
  for (const [method, url, body, kind] of [
    ["PUT", "/v1/run/configuration", Buffer.from("{}"), octets],
    ["PUT", "/v1/run/transcript/1", Buffer.from("{}"), octets],
    ["POST", "/v1/run/totals", {}, {}],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { ...held, ...kind },
      payload: body,
    });
    assert.equal(response.statusCode, 401, url);
  }
  assert.equal(reached, 0);
  await app.close();
});

test("a recorded snapshot and batch are stored at the path the server derived", async () => {
  const stored: unknown[] = [];
  const offered: unknown[] = [];
  const app = runEvidencePlane(
    {
      configurations: {
        record: (input) => {
          offered.push({ bytes: input.bytes, digest: input.digest });
          return Promise.resolve("Stored");
        },
      },
      transcripts: {
        record: (input) => {
          offered.push({ batch: input.batch, events: input.events });
          return Promise.resolve("Stored");
        },
      },
    },
    stored,
  );
  const snapshot = await app.inject({
    method: "PUT",
    url: "/v1/run/configuration",
    headers: { ...held, ...octets },
    payload: Buffer.from("{}\n"),
  });
  assert.equal(snapshot.statusCode, 204);
  const batch = await app.inject({
    method: "PUT",
    url: "/v1/run/transcript/3",
    headers: { ...held, ...octets },
    payload: Buffer.from('{"one":1}\n{"two":2}\n'),
  });
  assert.equal(batch.statusCode, 204);
  assert.deepEqual(stored, [
    { path: ".chuggy/run/configuration.json", bytes: 3 },
    { path: ".chuggy/run/transcript/3.jsonl", bytes: 20 },
  ]);
  assert.deepEqual(offered, [
    {
      bytes: 3,
      digest: createHash("sha256").update("{}\n").digest("hex"),
    },
    { batch: 3, events: 2 },
  ]);
  await app.close();
});

test("a durable refusal is answered with what refused it", async () => {
  for (const [verdict, status] of [
    ["Conflict", 409],
    ["OutOfOrder", 409],
    ["Fenced", 409],
    ["QuotaExceeded", 413],
  ] as const) {
    const app = runEvidencePlane({
      transcripts: { record: () => Promise.resolve(verdict) },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/run/transcript/1",
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, status, verdict);
    assert.equal(response.json<{ reason: string }>().reason, verdict);
    await app.close();
  }
});

test("the bytes are stored before the row that points at them", async () => {
  for (const [url, port] of [
    ["/v1/run/configuration", "configurations"],
    ["/v1/run/transcript/1", "transcripts"],
  ] as const) {
    const trace: string[] = [];
    const app = runEvidencePlane(
      {
        [port]: {
          record: () => {
            trace.push("row");
            return Promise.resolve("Stored" as const);
          },
        },
      },
      [],
      trace,
    );
    const response = await app.inject({
      method: "PUT",
      url,
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, 204, url);
    assert.deepEqual(trace, ["bytes", "row"], url);
    await app.close();
  }
});

test("a store that could not keep the bytes records no row", async () => {
  for (const url of [
    "/v1/run/configuration",
    "/v1/run/transcript/1",
  ] as const) {
    const trace: string[] = [];
    const counted = () => {
      trace.push("row");
      return Promise.resolve("Stored" as const);
    };
    const app = createWorkerPlaneApp({
      ...heartbeatService,
      ...runEvidenceService,
      runEvidence: {
        ...runEvidenceService.runEvidence,
        configurations: { record: counted },
        transcripts: { record: counted },
      },
      authority: { authenticate: () => Promise.resolve(authority) },
      reservations: {
        reserve: () => Promise.resolve({ reserved: "Reserved" }),
      },
      artifacts: {
        store: () => {
          trace.push("bytes");
          return Promise.resolve({
            stored: "Unavailable",
            retryAfterSeconds: 30,
          });
        },
      },
      reports: { report: () => Promise.resolve({ ingested: "Fenced" }) },
      ready: () => Promise.resolve(true),
      uploadBytesMax: workerPlaneUploadBytesMax,
    });
    const response = await app.inject({
      method: "PUT",
      url,
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, 503, url);
    assert.equal(response.headers["retry-after"], "30", url);
    assert.deepEqual(trace, ["bytes"], url);
    await app.close();
  }
});

test("a batch outside the run's bound never reaches the durable boundary", async () => {
  let reached = 0;
  const app = runEvidencePlane({
    transcripts: {
      record: () => {
        reached += 1;
        return Promise.resolve("Stored");
      },
    },
  });
  for (const named of ["0", "x", "-1", String(runTranscriptBatchesMax + 1)]) {
    const response = await app.inject({
      method: "PUT",
      url: `/v1/run/transcript/${named}`,
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, 400, named);
  }
  assert.equal(reached, 0);
  await app.close();
});

test("a body past the bound its own route holds is refused before it is stored", async () => {
  const stored: unknown[] = [];
  let reached = 0;
  const app = runEvidencePlane(
    {
      configurations: {
        record: () => {
          reached += 1;
          return Promise.resolve("Stored");
        },
      },
      transcripts: {
        record: () => {
          reached += 1;
          return Promise.resolve("Stored");
        },
      },
    },
    stored,
  );
  for (const [url, bytes] of [
    ["/v1/run/configuration", runConfigurationBytesMax + 1],
    ["/v1/run/transcript/1", runTranscriptBatchBytesMax + 1],
  ] as const) {
    const response = await app.inject({
      method: "PUT",
      url,
      headers: { ...held, ...octets },
      payload: Buffer.alloc(bytes),
    });
    assert.equal(response.statusCode, 413, url);
  }
  assert.equal(reached, 0);
  assert.deepEqual(stored, []);
  await app.close();
});

test("a turn page answers with the high-water the boundary stored", async () => {
  const offered: unknown[] = [];
  const app = runEvidencePlane({
    turns: {
      record: (input) => {
        offered.push(input.turns);
        return Promise.resolve({ recorded: "Recorded", turnsRecorded: 9 });
      },
    },
  });
  const turn = {
    ordinal: 1,
    model: "claude-fixture",
    tokensInput: 1,
    tokensOutput: 2,
    tokensCacheCreation: 3,
    tokensCacheRead: 4,
  };
  const recorded = await app.inject({
    method: "POST",
    url: "/v1/run/turns",
    headers: held,
    payload: { turns: [turn] },
  });
  assert.equal(recorded.statusCode, 200);
  assert.deepEqual(recorded.json(), { turnsRecorded: 9 });
  assert.deepEqual(offered, [[turn]]);
  for (const payload of [
    { turns: [] },
    { turns: [{ ...turn, ordinal: runTurnSeriesMax + 1 }] },
    { turns: [{ ...turn, model: "" }] },
    { turns: [{ ...turn, extra: 1 }] },
    { turns: [{ ...turn, tokensInput: -1 }] },
  ]) {
    const refused = await app.inject({
      method: "POST",
      url: "/v1/run/turns",
      headers: held,
      payload,
    });
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(offered.length, 1);
  await app.close();
});

/** A plane whose totals and ending boundaries record what they were offered. */
function runFigurePlane(offered: unknown[]) {
  return runEvidencePlane({
    totals: {
      record: (input) => {
        offered.push(input.totals);
        return Promise.resolve("Stored");
      },
    },
    endings: {
      end: (input) => {
        offered.push(input.evidence);
        return Promise.resolve(true);
      },
    },
  });
}

/** The figures one run reports, which every totals case varies one field of. */
const runTotalsBody = {
  turns: 2,
  durationMs: 10,
  durationApiMs: 5,
  tokensInput: 1,
  tokensOutput: 2,
  tokensCacheCreation: 3,
  tokensCacheRead: 4,
  costUsdMicros: 7,
  costBasis: "List",
  models: [],
  permissionDenials: 0,
} as const;

test("a run's totals and its ending are taken as the contract names them", async () => {
  const offered: unknown[] = [];
  const app = runFigurePlane(offered);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/run/totals",
        headers: held,
        payload: runTotalsBody,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/run/ended",
        headers: held,
        payload: { evidence: "RunRateLimited" },
      })
    ).statusCode,
    204,
  );
  assert.deepEqual(offered, [runTotalsBody, "RunRateLimited"]);
  await app.close();
});

test("a totals or ending body the contract does not name reaches no boundary", async () => {
  const offered: unknown[] = [];
  const app = runFigurePlane(offered);
  const model = {
    model: "claude-fixture",
    tokensInput: 1,
    tokensOutput: 1,
    tokensCacheCreation: 1,
    tokensCacheRead: 1,
    costUsdMicros: 1,
  };
  for (const [url, payload] of [
    ["/v1/run/totals", { ...runTotalsBody, costBasis: "Invoice" }],
    [
      "/v1/run/totals",
      { ...runTotalsBody, recordedAt: "2026-08-27T00:00:00Z" },
    ],
    [
      "/v1/run/totals",
      { ...runTotalsBody, models: [{ ...model, recordedAt: "2026-08-27" }] },
    ],
    ["/v1/run/ended", { evidence: "LeaseExpired" }],
    ["/v1/run/ended", { evidence: "RunFailed", extra: 1 }],
  ] as const) {
    const refused = await app.inject({
      method: "POST",
      url,
      headers: held,
      payload,
    });
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(offered, []);
  await app.close();
});

test("an ending the boundary refuses is a conflict and not a silent success", async () => {
  const app = runEvidencePlane({
    endings: { end: () => Promise.resolve(false) },
  });
  const refused = await app.inject({
    method: "POST",
    url: "/v1/run/ended",
    headers: held,
    payload: { evidence: "RunFailed" },
  });
  assert.equal(refused.statusCode, 409);
  await app.close();
});
