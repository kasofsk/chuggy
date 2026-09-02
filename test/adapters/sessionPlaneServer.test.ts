/**
 * The worker plane's session routes against fakes: the facts a pod is told, the
 * mailbox it waits on, and the store its transcript lands in.
 *
 * EVERY ROUTE IS THE SESSION BEARER'S. A token that is not written in the
 * bearer language never reaches the session authority, and a session whose
 * attempt is no longer live is refused before any port is touched — so every
 * case below asserts the ports were not reached as well as the status.
 *
 * THE PLANE READS NO PAYLOAD. What it derives from a batch's bytes is their
 * length, their digest and how many newlines they carry, and the cases here pin
 * exactly those three; nothing else about a batch is ever a decision.
 *
 * BYTES FIRST, ROW SECOND. An object no row names is inert, while a row whose
 * object is absent is a hole, so the order is asserted rather than described and
 * a store that could not keep the bytes must record nothing.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  createWorkerPlaneApp,
  workerPlaneServed,
  type SessionPlaneService,
  type WorkerPlaneServerService,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  sessionStoreBatchBytesMax,
  sessionStoreBatchesMax,
  sessionStorePageBatchesMax,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import {
  asSessionAttemptId,
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { SessionPlaneIdentity } from "../../src/interpreter/sessionPlane.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { inertRunEvidence } from "./workerPlaneFixtures.ts";

/** One bearer in the session language, which is the only token these routes read. */
const secret = `chgs_${"a".repeat(32)}`;
const held = { authorization: `Bearer ${secret}` };
const octets = { "content-type": "application/octet-stream" };

const identity: SessionPlaneIdentity = {
  live: true,
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  session: asSessionId("session-1"),
  attempt: asSessionAttemptId("attempt-1"),
  generation: 3,
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
};

/** Every session port answering the least it can, which a case overrides one of. */
const inertSessions: SessionPlaneService = {
  authority: { authenticate: () => Promise.resolve(identity) },
  heartbeats: { heartbeat: () => Promise.resolve(true) },
  heartbeatLeaseSecs: 300,
  references: { bind: () => Promise.resolve("Bound") },
  turns: { claim: () => Promise.resolve(undefined) },
  settlements: {
    answer: () => Promise.resolve("Answered"),
    fail: () => Promise.resolve("Failed"),
  },
  records: { record: () => Promise.resolve("Stored") },
  queries: {
    batches: () => Promise.resolve([]),
    streams: () => Promise.resolve([]),
  },
  store: {
    storeBatch: () => Promise.resolve({ stored: "Stored" }),
    readBatch: () => Promise.resolve({ read: "NotFound" }),
  },
  turnPollIntervalMs: 1_000,
  turnPollSecsMax: 1,
  pollsMax: 64,
};

/** The attempt half of the plane, inert throughout: no case here is about a run. */
const inertAttempt = {
  authority: { authenticate: () => Promise.resolve(undefined) },
  heartbeats: { heartbeat: () => Promise.resolve(true) },
  heartbeatLeaseSecs: 300,
  artifacts: { store: () => Promise.resolve({ stored: "Stored" as const }) },
  reservations: {
    reserve: () => Promise.resolve({ reserved: "Reserved" as const }),
  },
  reports: { report: () => Promise.resolve({ ingested: "Fenced" as const }) },
  runEvidence: inertRunEvidence,
  ready: () => Promise.resolve(true),
  uploadBytesMax: sessionStoreBatchBytesMax * 2,
} satisfies Omit<WorkerPlaneServerService, "sessions">;

function sessionPlane(over: Partial<SessionPlaneService> = {}) {
  return createWorkerPlaneApp({
    ...inertAttempt,
    sessions: { ...inertSessions, ...over },
  });
}

/** Every session route, as one method, one url and one body that would otherwise be taken. */
const sessionCalls = [
  ["GET", "/v1/session", undefined, {}],
  ["POST", "/v1/session/heartbeat", undefined, {}],
  ["PUT", "/v1/session/reference", { reference: "1a2b" }, {}],
  ["GET", "/v1/session/turn", undefined, {}],
  ["POST", "/v1/session/turn/answer", { turn: "turn-1", result: "done" }, {}],
  [
    "POST",
    "/v1/session/turn/failure",
    { turn: "turn-1", failure: "StoreRefused" },
    {},
  ],
  ["PUT", "/v1/session/store/1a2b/1", Buffer.from("{}\n"), octets],
  ["GET", "/v1/session/store/1a2b", undefined, {}],
  ["GET", "/v1/session/store", undefined, {}],
] as const;

test("a session pod is told what its own session is, and nothing it has not got", async () => {
  const app = sessionPlane();
  const anonymous = await app.inject({ method: "GET", url: "/v1/session" });
  assert.equal(anonymous.statusCode, 401);
  const authenticated = await app.inject({
    method: "GET",
    url: "/v1/session",
    headers: held,
  });
  assert.deepEqual(authenticated.json(), {
    tenant: "tenant",
    project: "project",
    session: "session-1",
    kind: "Lead",
    capabilities: ["RepositoryRead", "RunCommands"],
    credentialSlot: "claude-code",
  });
  await app.close();
  const running = sessionPlane({
    authority: {
      authenticate: () =>
        Promise.resolve({ ...identity, agentReference: "1a2b" }),
    },
  });
  assert.equal(
    (
      await running.inject({
        method: "GET",
        url: "/v1/session",
        headers: held,
      })
    ).json<{ agentReference: string }>().agentReference,
    "1a2b",
  );
  await running.close();
});

test("no session route answers a bearer that is not a live session", async () => {
  for (const [what, authority, headers] of [
    ["no bearer at all", inertSessions.authority, {}],
    [
      "an attempt's own bearer",
      inertSessions.authority,
      {
        authorization: "Bearer held",
      },
    ],
    [
      "a session bearer nothing resolves",
      { authenticate: () => Promise.resolve(undefined) },
      held,
    ],
    [
      "a session whose attempt is done",
      { authenticate: () => Promise.resolve({ ...identity, live: false }) },
      held,
    ],
  ] as const) {
    let reached = 0;
    const counted = () => {
      reached += 1;
      return Promise.resolve(undefined);
    };
    const app = sessionPlane({
      authority,
      turns: { claim: counted },
      heartbeats: {
        heartbeat: () => {
          reached += 1;
          return Promise.resolve(true);
        },
      },
      store: {
        storeBatch: () => {
          reached += 1;
          return Promise.resolve({ stored: "Stored" });
        },
        readBatch: () => {
          reached += 1;
          return Promise.resolve({ read: "NotFound" });
        },
      },
    });
    for (const [method, url, payload, kind] of sessionCalls) {
      const response = await app.inject({
        method,
        url,
        headers: { ...headers, ...kind },
        ...(payload === undefined ? {} : { payload }),
      });
      assert.equal(response.statusCode, 401, `${what}: ${url}`);
      assert.deepEqual(response.json(), { action: "stop" }, `${what}: ${url}`);
    }
    assert.equal(reached, 0, what);
    await app.close();
  }
});

test("a session heartbeat renews under its own generation, or is told to stop", async () => {
  const calls: unknown[] = [];
  const app = sessionPlane({
    heartbeats: {
      heartbeat: (offered, generation, leaseSecs) => {
        calls.push({ offered, generation, leaseSecs });
        return Promise.resolve(calls.length === 1);
      },
    },
  });
  const renewed = await app.inject({
    method: "POST",
    url: "/v1/session/heartbeat",
    headers: held,
  });
  assert.equal(renewed.statusCode, 204);
  const refused = await app.inject({
    method: "POST",
    url: "/v1/session/heartbeat",
    headers: held,
  });
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(refused.json(), { action: "stop" });
  assert.deepEqual(calls, [
    { offered: secret, generation: 3, leaseSecs: 300 },
    { offered: secret, generation: 3, leaseSecs: 300 },
  ]);
  await app.close();
});

test("the runtime's own session id is bound once, and a second value is refused", async () => {
  for (const [bound, status] of [
    ["Bound", 204],
    ["AlreadyBound", 204],
    ["Conflict", 409],
    ["Fenced", 409],
  ] as const) {
    const app = sessionPlane({
      references: { bind: () => Promise.resolve(bound) },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/session/reference",
      headers: held,
      payload: { reference: "1a2b" },
    });
    assert.equal(response.statusCode, status, bound);
    if (status === 409)
      assert.deepEqual(response.json(), { action: "stop", reason: bound });
    await app.close();
  }
});

test("a reference body the contract does not name reaches no boundary", async () => {
  let reached = 0;
  const app = sessionPlane({
    references: {
      bind: () => {
        reached += 1;
        return Promise.resolve("Bound");
      },
    },
  });
  for (const payload of [
    {},
    { reference: "" },
    { reference: "1a2b", extra: 1 },
  ]) {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/session/reference",
      headers: held,
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(reached, 0);
  await app.close();
});

test("the mailbox answers the turn it claimed, and answers empty when none arrives", async () => {
  const claimed = {
    turn: asSessionTurnId("turn-7"),
    ordinal: 7,
    inputKind: "UserMessage" as const,
    input: "what did you remember",
  };
  let claims = 0;
  const app = sessionPlane({
    turnPollIntervalMs: 5,
    turnPollSecsMax: 1,
    turns: {
      claim: () => {
        claims += 1;
        return Promise.resolve(claims < 3 ? undefined : claimed);
      },
    },
  });
  const answered = await app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), claimed);
  assert.equal(claims, 3);
  await app.close();
  const empty = sessionPlane({ turnPollIntervalMs: 1_000, turnPollSecsMax: 1 });
  const spent = await empty.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held,
  });
  assert.equal(spent.statusCode, 204);
  await empty.close();
});

test("a mailbox already holding its most waiters answers at once rather than queueing", async () => {
  let claims = 0;
  let arrived = () => undefined as void;
  const entered = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const app = sessionPlane({
    pollsMax: 1,
    turnPollIntervalMs: 1_000,
    turnPollSecsMax: 1,
    turns: {
      claim: async () => {
        claims += 1;
        arrived();
        await delay(50);
        return undefined;
      },
    },
  });
  const waiting = app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held,
  });
  await entered;
  const turned = await app.inject({
    method: "GET",
    url: "/v1/session/turn",
    headers: held,
  });
  assert.equal(turned.statusCode, 204);
  assert.equal(claims, 1);
  assert.equal((await waiting).statusCode, 204);
  await app.close();
});

test("a turn is answered or failed by the attempt that holds it, and refused otherwise", async () => {
  const settled: unknown[] = [];
  for (const [answered, status] of [
    ["Answered", 204],
    ["AlreadyAnswered", 204],
    ["Conflict", 409],
    ["Fenced", 409],
  ] as const) {
    const app = sessionPlane({
      settlements: {
        answer: (input) => {
          settled.push(input);
          return Promise.resolve(answered);
        },
        fail: () => Promise.resolve("Failed"),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/session/turn/answer",
      headers: held,
      payload: {
        turn: "turn-7",
        result: "remembered",
        batchFirst: 12,
        batchLast: 14,
      },
    });
    assert.equal(response.statusCode, status, answered);
    if (status === 409)
      assert.deepEqual(response.json(), { action: "stop", reason: answered });
    await app.close();
  }
  assert.deepEqual(settled[0], {
    secret,
    generation: 3,
    turn: "turn-7",
    result: "remembered",
    batchFirst: 12,
    batchLast: 14,
  });
});

test("a failed turn names a failure from the closed roster and nothing else", async () => {
  const failed: unknown[] = [];
  const app = sessionPlane({
    settlements: {
      answer: () => Promise.resolve("Answered"),
      fail: (input) => {
        failed.push(input);
        return Promise.resolve("Failed");
      },
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/session/turn/failure",
    headers: held,
    payload: { turn: "turn-7", failure: "StoreRefused" },
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(failed, [
    { secret, generation: 3, turn: "turn-7", failure: "StoreRefused" },
  ]);
  for (const payload of [
    { turn: "turn-7", failure: "Whatever" },
    { turn: "turn-7" },
    { turn: "", failure: "AgentFailed" },
  ]) {
    const refused = await app.inject({
      method: "POST",
      url: "/v1/session/turn/failure",
      headers: held,
      payload,
    });
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(failed.length, 1);
  await app.close();
});

test("a settlement body the row could not hold reaches no boundary", async () => {
  let reached = 0;
  const app = sessionPlane({
    settlements: {
      answer: () => {
        reached += 1;
        return Promise.resolve("Answered");
      },
      fail: () => Promise.resolve("Failed"),
    },
  });
  for (const payload of [
    { turn: "turn-7", result: "done", batchFirst: 3 },
    { turn: "turn-7", result: "done", batchLast: 3 },
    { turn: "turn-7", result: "done", batchFirst: 5, batchLast: 3 },
    { turn: "turn-7", result: "done", batchFirst: 0, batchLast: 3 },
    {
      turn: "turn-7",
      result: "done",
      batchFirst: 1,
      batchLast: sessionStoreBatchesMax + 1,
    },
    { turn: "turn-7", result: "x".repeat(sessionTurnResultCharsMax + 1) },
    { turn: "turn-7", result: "done", extra: 1 },
    { result: "done" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/session/turn/answer",
      headers: held,
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(reached, 0);
  await app.close();
});

test("a store batch is kept as bytes and then recorded as a row, in that order", async () => {
  const trace: string[] = [];
  const offered: unknown[] = [];
  const content = '{"one":1}\n{"two":2}\n';
  const app = sessionPlane({
    store: {
      storeBatch: (input) => {
        trace.push("bytes");
        offered.push({
          session: input.session,
          stream: input.stream,
          batch: input.batch,
          bytes: input.content.byteLength,
        });
        return Promise.resolve({ stored: "Stored" });
      },
      readBatch: () => Promise.resolve({ read: "NotFound" }),
    },
    records: {
      record: (input) => {
        trace.push("row");
        offered.push(input);
        return Promise.resolve("Stored");
      },
    },
  });
  const response = await app.inject({
    method: "PUT",
    url: "/v1/session/store/1a2b%2Fsubagent-7/3",
    headers: { ...held, ...octets },
    payload: Buffer.from(content),
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(trace, ["bytes", "row"]);
  assert.deepEqual(offered, [
    {
      session: "session-1",
      stream: "1a2b/subagent-7",
      batch: 3,
      bytes: content.length,
    },
    {
      secret,
      generation: 3,
      stream: "1a2b/subagent-7",
      batch: 3,
      digest: createHash("sha256").update(content).digest("hex"),
      bytes: content.length,
      events: 2,
    },
  ]);
  await app.close();
});

test("a store that could not keep the bytes records no row", async () => {
  const trace: string[] = [];
  const app = sessionPlane({
    store: {
      storeBatch: () => {
        trace.push("bytes");
        return Promise.resolve({
          stored: "Unavailable",
          retryAfterSeconds: 30,
        });
      },
      readBatch: () => Promise.resolve({ read: "NotFound" }),
    },
    records: {
      record: () => {
        trace.push("row");
        return Promise.resolve("Stored");
      },
    },
  });
  const response = await app.inject({
    method: "PUT",
    url: "/v1/session/store/1a2b/1",
    headers: { ...held, ...octets },
    payload: Buffer.from("{}\n"),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], "30");
  assert.deepEqual(response.json(), { action: "retry" });
  assert.deepEqual(trace, ["bytes"]);
  await app.close();
});

test("a batch the store already holds under other bytes is a conflict and not a hole", async () => {
  for (const [kept, status, body] of [
    [{ stored: "Conflict" }, 409, { action: "stop", reason: "Conflict" }],
    [
      { stored: "Refused", reason: "QuotaExceeded" },
      413,
      { action: "stop", reason: "QuotaExceeded" },
    ],
  ] as const) {
    const app = sessionPlane({
      store: {
        storeBatch: () => Promise.resolve(kept),
        readBatch: () => Promise.resolve({ read: "NotFound" }),
      },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/session/store/1a2b/1",
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, status, kept.stored);
    assert.deepEqual(response.json(), body);
    await app.close();
  }
});

test("what the durable side says of a recorded batch is what the pod is told", async () => {
  for (const [recorded, status] of [
    ["Stored", 204],
    ["AlreadyStored", 204],
    ["OutOfOrder", 409],
    ["Conflict", 409],
    ["QuotaExceeded", 413],
    ["Fenced", 401],
  ] as const) {
    const app = sessionPlane({
      records: { record: () => Promise.resolve(recorded) },
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/session/store/1a2b/1",
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, status, recorded);
    if (status === 401) assert.deepEqual(response.json(), { action: "stop" });
    else if (status !== 204)
      assert.deepEqual(response.json(), { action: "stop", reason: recorded });
    await app.close();
  }
});

test("a store path, stream, batch or body the route does not hold never reaches a port", async () => {
  let reached = 0;
  const app = sessionPlane({
    store: {
      storeBatch: () => {
        reached += 1;
        return Promise.resolve({ stored: "Stored" });
      },
      readBatch: () => Promise.resolve({ read: "NotFound" }),
    },
  });
  for (const [url, reason] of [
    ["/v1/session/store/1a2b", "InvalidPath"],
    ["/v1/session/store/1a2b/1/2", "InvalidPath"],
    ["/v1/session/store/%20/1", "InvalidStream"],
    [`/v1/session/store/${"s".repeat(257)}/1`, "InvalidStream"],
    ["/v1/session/store/1a2b/0", "InvalidBatch"],
    ["/v1/session/store/1a2b/01", "InvalidBatch"],
    ["/v1/session/store/1a2b/x", "InvalidBatch"],
    [
      `/v1/session/store/1a2b/${String(sessionStoreBatchesMax + 1)}`,
      "InvalidBatch",
    ],
  ] as const) {
    const response = await app.inject({
      method: "PUT",
      url,
      headers: { ...held, ...octets },
      payload: Buffer.from("{}\n"),
    });
    assert.equal(response.statusCode, 400, url);
    assert.deepEqual(response.json(), { action: "stop", reason }, url);
  }
  const oversize = await app.inject({
    method: "PUT",
    url: "/v1/session/store/1a2b/1",
    headers: { ...held, ...octets },
    payload: Buffer.alloc(sessionStoreBatchBytesMax + 1),
  });
  assert.equal(oversize.statusCode, 413);
  const untyped = await app.inject({
    method: "PUT",
    url: "/v1/session/store/1a2b/1",
    headers: { ...held, "content-type": "text/plain" },
    payload: "{}\n",
  });
  assert.equal(untyped.statusCode, 415);
  assert.equal(reached, 0);
  await app.close();
});

test("a page of a stream carries every batch's bytes, and marks the ones it has none for", async () => {
  const drawn = new Map([
    [1, { read: "Content" as const, content: "one\n" }],
    [2, { read: "NotFound" as const }],
    [3, { read: "Corrupt" as const }],
  ]);
  const asked: unknown[] = [];
  const app = sessionPlane({
    queries: {
      batches: (input) => {
        asked.push(input);
        return Promise.resolve(
          [1, 2, 3].map((batch) => ({ batch, digest: "d", bytes: 4 })),
        );
      },
      streams: () => Promise.resolve([]),
    },
    store: {
      storeBatch: () => Promise.resolve({ stored: "Stored" }),
      readBatch: (object) =>
        Promise.resolve(drawn.get(object.batch) ?? { read: "NotFound" }),
    },
  });
  const page = await app.inject({
    method: "GET",
    url: "/v1/session/store/1a2b%2Fsubagent-7?after=0&limit=3",
    headers: held,
  });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(page.json(), {
    batches: [
      { batch: 1, content: "one\n" },
      { batch: 2, read: "Missing" },
      { batch: 3, read: "Missing" },
    ],
    nextAfter: 3,
  });
  assert.deepEqual(asked, [
    {
      secret,
      generation: 3,
      stream: "1a2b/subagent-7",
      after: 0,
      limit: 3,
    },
  ]);
  await app.close();
});

test("a page shorter than its limit is the end of the stream", async () => {
  const app = sessionPlane({
    queries: {
      batches: () => Promise.resolve([{ batch: 1, digest: "d", bytes: 1 }]),
      streams: () => Promise.resolve([]),
    },
    store: {
      storeBatch: () => Promise.resolve({ stored: "Stored" }),
      readBatch: () => Promise.resolve({ read: "Content", content: "one\n" }),
    },
  });
  const page = await app.inject({
    method: "GET",
    url: "/v1/session/store/1a2b",
    headers: held,
  });
  assert.deepEqual(page.json(), {
    batches: [{ batch: 1, content: "one\n" }],
  });
  await app.close();
});

test("an unreadable volume refuses the page rather than reporting batches that are there", async () => {
  const app = sessionPlane({
    queries: {
      batches: () => Promise.resolve([{ batch: 1, digest: "d", bytes: 1 }]),
      streams: () => Promise.resolve([]),
    },
    store: {
      storeBatch: () => Promise.resolve({ stored: "Stored" }),
      readBatch: () =>
        Promise.resolve({ read: "Unavailable", retryAfterSeconds: 30 }),
    },
  });
  const page = await app.inject({
    method: "GET",
    url: "/v1/session/store/1a2b",
    headers: held,
  });
  assert.equal(page.statusCode, 503);
  assert.equal(page.headers["retry-after"], "30");
  assert.deepEqual(page.json(), { action: "retry" });
  await app.close();
});

test("a page asked for outside the bounds it is read within reaches no port", async () => {
  let reached = 0;
  const app = sessionPlane({
    queries: {
      batches: () => {
        reached += 1;
        return Promise.resolve([]);
      },
      streams: () => Promise.resolve([]),
    },
  });
  for (const query of [
    "after=-1",
    "after=x",
    `after=${String(sessionStoreBatchesMax + 1)}`,
    "limit=0",
    `limit=${String(sessionStorePageBatchesMax + 1)}`,
  ]) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/session/store/1a2b?${query}`,
      headers: held,
    });
    assert.equal(response.statusCode, 400, query);
    assert.deepEqual(
      response.json(),
      { action: "stop", reason: "InvalidQuery" },
      query,
    );
  }
  assert.equal(reached, 0);
  await app.close();
});

test("a page asked for with no bounds is read within the ones the contract holds", async () => {
  const asked: unknown[] = [];
  const app = sessionPlane({
    queries: {
      batches: (input) => {
        asked.push({ after: input.after, limit: input.limit });
        return Promise.resolve([]);
      },
      streams: () => Promise.resolve([]),
    },
  });
  await app.inject({
    method: "GET",
    url: "/v1/session/store/1a2b",
    headers: held,
  });
  assert.deepEqual(asked, [{ after: 0, limit: sessionStorePageBatchesMax }]);
  await app.close();
});

test("the streams a session holds are answered whole, or narrowed by the prefix asked under", async () => {
  const rows = [
    { stream: asSessionStoreStream("1a2b"), batches: 14 },
    { stream: asSessionStoreStream("1a2b/subagent-7"), batches: 3 },
    { stream: asSessionStoreStream("9f8e"), batches: 1 },
  ];
  const app = sessionPlane({
    queries: {
      batches: () => Promise.resolve([]),
      streams: () => Promise.resolve(rows),
    },
  });
  const all = await app.inject({
    method: "GET",
    url: "/v1/session/store",
    headers: held,
  });
  assert.equal(all.statusCode, 200);
  assert.deepEqual(all.json(), { streams: rows });
  const narrowed = await app.inject({
    method: "GET",
    url: "/v1/session/store?stream=1a2b",
    headers: held,
  });
  assert.deepEqual(narrowed.json(), { streams: rows.slice(0, 2) });
  await app.close();
});

test("a plane composed with no session plane serves no session route at all", async () => {
  const app = createWorkerPlaneApp(inertAttempt);
  assert.deepEqual(
    workerPlaneServed(inertAttempt).filter((route) =>
      route.startsWith("/v1/session"),
    ),
    [],
  );
  for (const [method, url, payload, kind] of sessionCalls) {
    const response = await app.inject({
      method,
      url,
      headers: { ...held, ...kind },
      ...(payload === undefined ? {} : { payload }),
    });
    assert.equal(response.statusCode, 404, url);
  }
  await app.close();
  const composed = { ...inertAttempt, sessions: inertSessions };
  assert.deepEqual(
    workerPlaneServed(composed).filter((route) =>
      route.startsWith("/v1/session"),
    ),
    [
      "/v1/session",
      "/v1/session/heartbeat",
      "/v1/session/reference",
      "/v1/session/turn",
      "/v1/session/turn/answer",
      "/v1/session/turn/failure",
      "/v1/session/store",
      "/v1/session/store/*",
    ],
  );
});
