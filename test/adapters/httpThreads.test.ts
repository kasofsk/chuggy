/**
 * The five thread routes through the real app: the status map, the bounds the
 * door checks, the media type the two writes require, and the body each answers.
 *
 * THE BOUNDARY IS A DOUBLE AND THE APP IS REAL, because what is being settled
 * here is the transport: which status one refusal reaches the wire as, which
 * query a cursor becomes, and that a page a schema refuses is a page this
 * server never sends. What the boundary itself decides is settled beside it, in
 * `test/interpreter/threadRead.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import { threadMessageRefusalCodes } from "../../src/contract/rosters.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
  sessionStorePageBatchesMax,
  threadMessageCharsMax,
  threadTurnsAnsweredMax,
} from "../../src/contract/http.ts";
import {
  threadEntryResponseSchema,
  threadMessageAcceptedSchema,
  threadResponseSchema,
  threadTranscriptResponseSchema,
  threadsResponseSchema,
} from "../../src/contract/responses.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { leadTranscriptResponse } from "../../src/adapters/http/outcomes.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import {
  checkedThreadMailboxQuery,
  threadBacklogRetrySeconds,
} from "../../src/interpreter/threadRead.ts";
import { checkedLeadTranscriptQuery } from "../../src/interpreter/leadRead.ts";
import type { ThreadMessageSent } from "../../src/interpreter/threadRead.ts";
import { threadTurnInputCharsMax } from "../../src/interpreter/thread.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

/** What the app takes, which is one boundary and not the five methods under test. */
type NativeThreadWeb = Parameters<typeof createNativeHttpApp>[0];

const root = "/api/v1/tenants/acme/projects/atlas/threads";
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };
const mine = asSessionId("thread-geoff");

/**
 * One page as the walk answers it, carrying the parent links and the compaction
 * metadata the walk needed. A reader is given neither: the wire says what the
 * chain is, not how it was found.
 */
const transcriptPage = {
  stream: asSessionStoreStream("1a2b"),
  entries: [
    {
      uuid: "u1",
      parentUuid: "u0",
      logicalParentUuid: "u-1",
      type: "user",
      subtype: "reply",
      timestamp: "2026-09-02T00:00:00.000Z",
      message: { text: "what is blocking 42?" },
      compactMetadata: { trigger: "auto" },
      isMeta: false,
    },
  ],
  held: ["u1"],
  cut: 1,
  compaction: { boundary: "u1", at: "2026-09-02T00:00:00.000Z" },
  elided: 0,
  truncated: false,
} as const;

const entry = {
  session: mine,
  owner: "geoff",
  state: "Open",
  mine: true,
  turns: 2,
  agentReference: "1a2b",
} as const;

const turn = {
  turn: asSessionTurnId("thread-turn-1"),
  ordinal: 2,
  inputKind: "UserMessage",
  state: "Answered",
  input: "what is blocking 42?",
  result: "the dependency is still failing",
  measured: {
    model: "claude",
    tokens: 12,
    costMicros: 34,
    durationMs: 56,
    tools: ["read_ticket"],
  },
  batchFirst: 1,
  batchLast: 2,
} as const;

interface ThreadCase {
  readonly calls: string[];
  readonly sent?: ThreadMessageSent;
  readonly found?: boolean;
}

function threadWeb(held: ThreadCase): NativeThreadWeb {
  const found = held.found ?? true;
  return {
    ...unservedNativeWeb,
    threads: (_principal, partition) => {
      held.calls.push(`threads:${partition.tenant}/${partition.project}`);
      return Promise.resolve(
        found ? { result: "Found", threads: [entry] } : { result: "NotFound" },
      );
    },
    thread: (_principal, _partition, session, query) => {
      checkedThreadMailboxQuery(query);
      held.calls.push(
        `thread:${session}:${String(query.before)}:${String(query.limit)}`,
      );
      return Promise.resolve(
        found
          ? {
              result: "Found",
              thread: entry,
              turns: [turn],
              nextBefore: 1,
              streams: [{ stream: asSessionStoreStream("1a2b"), batches: 2 }],
            }
          : { result: "NotFound" },
      );
    },
    threadTranscript: (_principal, _partition, session, query) => {
      checkedLeadTranscriptQuery(query);
      held.calls.push(
        `transcript:${session}:${String(query.stream)}:${String(query.after)}:${String(query.limit)}`,
      );
      return Promise.resolve(
        found
          ? { read: "Page", page: transcriptPage }
          : { read: "Unavailable", retryAfterSeconds: 2 },
      );
    },
    openThread: () => {
      held.calls.push("open");
      return Promise.resolve(
        found
          ? { result: "Opened", thread: entry }
          : { result: "AlreadyOpen", thread: entry },
      );
    },
    sendThreadMessage: (_principal, _partition, input) => {
      held.calls.push(`send:${input.session}:${input.turn}:${input.message}`);
      return Promise.resolve(
        held.sent ?? {
          result: "Sent",
          turn: input.turn,
          ordinal: 12,
        },
      );
    },
  };
}

function appOf(held: ThreadCase) {
  return createNativeHttpApp(
    threadWeb(held),
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: asPrincipal("issuer geoff") },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
  );
}

test("the project's threads are listed as the listing schema names them", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  const found = await app.inject({ url: root, headers: authorized });

  assert.equal(found.statusCode, 200);
  assert.deepEqual(threadsResponseSchema.parse(found.json()).threads, [entry]);
  assert.deepEqual(held.calls, ["threads:acme/atlas"]);
  assert.deepEqual(
    Object.keys(found.json<{ threads: object[] }>().threads[0] ?? {}).sort(),
    ["agentReference", "mine", "owner", "session", "state", "turns"],
  );
});

test("a project a member may not read answers no threads and no reason", async () => {
  const held: ThreadCase = { calls: [], found: false };
  await using app = appOf(held);

  assert.equal(
    (await app.inject({ url: root, headers: authorized })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `${root}/${mine}`, headers: authorized }))
      .statusCode,
    404,
  );
});

test("one thread answers its standing, its page and the cursor behind it", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  const found = await app.inject({
    url: `${root}/${mine}?before=4&limit=2`,
    headers: authorized,
  });

  assert.equal(found.statusCode, 200);
  const body = threadResponseSchema.parse(found.json());
  assert.equal(body.nextBefore, 1);
  assert.equal(body.turns[0]?.input, "what is blocking 42?");
  assert.equal(body.turns[0]?.model, "claude");
  assert.deepEqual(held.calls, [`thread:${mine}:4:2`]);
});

/** The tail is what a reader wants first, so a page nobody asked for is the newest one. */
test("a mailbox read with no cursor asks for the newest page", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  await app.inject({ url: `${root}/${mine}`, headers: authorized });

  assert.deepEqual(held.calls, [
    `thread:${mine}:undefined:${String(threadTurnsAnsweredMax)}`,
  ]);
});

/**
 * The double checks the query the boundary checks, so what this settles is the
 * whole path: the door parses, the boundary refuses, and the refusal reaches
 * the wire as a client fault rather than as a five hundred.
 */
test("a cursor or a page outside its bounds is a status and not a raise", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  for (const query of [
    "?before=-1",
    "?before=one",
    "?before=0",
    "?limit=0",
    `?limit=${String(threadTurnsAnsweredMax + 1)}`,
    "?after=1",
  ])
    assert.equal(
      (
        await app.inject({
          url: `${root}/${mine}${query}`,
          headers: authorized,
        })
      ).statusCode,
      400,
      query,
    );
  assert.deepEqual(held.calls, []);
});

/**
 * `after` is EXCLUSIVE and batches are 1-based, so the cursor an unparameterised
 * read sends decides whether the first batch is ever answered. A default of one
 * loses batch 1 silently and permanently: no `nextAfter`, nothing saying a batch
 * was dropped, and every later page correct.
 */
test("an unparameterised transcript read asks from before the first batch", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  await app.inject({
    url: `${root}/${mine}/transcript`,
    headers: authorized,
  });

  assert.deepEqual(held.calls, [
    `transcript:${mine}:undefined:0:${String(sessionStorePageBatchesMax)}`,
  ]);
});

test("a thread's transcript is the lead's page over another session", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  const found = await app.inject({
    url: `${root}/${mine}/transcript?stream=1a2b&after=3&limit=2`,
    headers: authorized,
  });

  assert.equal(found.statusCode, 200);
  assert.equal(
    threadTranscriptResponseSchema.parse(found.json()).stream,
    "1a2b",
  );
  assert.deepEqual(held.calls, [`transcript:${mine}:1a2b:3:2`]);
});

/**
 * ONE TRANSCRIPT HAS ONE REPRESENTATION. A thread's page goes out through the
 * lead's own wire body, so the parent links and the compaction metadata the walk
 * needed are stripped from a thread's entries exactly as they are from a lead's
 * — a second encoder would be a second answer to what a transcript entry is.
 */
test("a thread's entries are stripped the way the lead's are", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  const found = await app.inject({
    url: `${root}/${mine}/transcript`,
    headers: authorized,
  });

  const page = found.json<{
    entries: readonly Readonly<Record<string, unknown>>[];
  }>();
  assert.deepEqual(Object.keys(page.entries[0] ?? {}).sort(), [
    "message",
    "timestamp",
    "type",
    "uuid",
  ]);
  assert.deepEqual(
    leadTranscriptResponse({ read: "Page", page: transcriptPage }).body,
    page,
  );
});

test("a transcript the store cannot draw is an outage a reader may retry", async () => {
  const held: ThreadCase = { calls: [], found: false };
  await using app = appOf(held);

  const refused = await app.inject({
    url: `${root}/${mine}/transcript`,
    headers: authorized,
  });

  assert.equal(refused.statusCode, 503);
  assert.equal(refused.headers["retry-after"], "2");
});

/** A stream naming a control character is a bad path, not a store's problem. */
test("a stream the branding refuses never reaches the walk", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  assert.equal(
    (
      await app.inject({
        url: `${root}/${mine}/transcript?stream=a%00b`,
        headers: authorized,
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(held.calls, []);
});

test("opening my thread is created once and answered again after that", async () => {
  const opened: ThreadCase = { calls: [] };
  const already: ThreadCase = { calls: [], found: false };
  await using first = appOf(opened);
  await using second = appOf(already);

  const created = await first.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: {},
  });
  const again = await second.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: {},
  });

  assert.equal(created.statusCode, 201);
  assert.equal(again.statusCode, 200);
  assert.equal(threadEntryResponseSchema.parse(created.json()).mine, true);
  assert.deepEqual(opened.calls, ["open"]);
  for (const answer of [created, again])
    assert.equal(answer.headers["location"], `${root}/${mine}`);
});

/**
 * The roster a thread is opened with is the definer's own, so a body offering
 * one is refused rather than ignored: a caller that believes it chose the
 * roster and was silently overruled has been told the wrong thing about what
 * this door does.
 */
test("opening a thread takes an empty body and refuses any other", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  for (const payload of [
    { capabilities: ["RepositoryWrite"] },
    { principal: "someone-else" },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: root,
          headers: versioned,
          payload,
        })
      ).statusCode,
      400,
      JSON.stringify(payload),
    );
  assert.deepEqual(held.calls, []);
});

test("both write doors take the versioned media type and nothing else", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  for (const url of [root, `${root}/${mine}/messages`])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...authorized, "content-type": "application/json" },
          payload: {},
        })
      ).statusCode,
      415,
      url,
    );
  assert.deepEqual(held.calls, []);
});

test("a message names the turn it minted and the ordinal it took", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  const accepted = await app.inject({
    method: "POST",
    url: `${root}/${mine}/messages`,
    headers: versioned,
    payload: { turn: "thread-turn-2", message: "why is 42 refused?" },
  });

  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(threadMessageAcceptedSchema.parse(accepted.json()), {
    turn: "thread-turn-2",
    ordinal: 12,
  });
  assert.deepEqual(held.calls, [
    `send:${mine}:thread-turn-2:why is 42 refused?`,
  ]);
});

test("a message body outside the schema is refused at the door", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  for (const payload of [
    { turn: "thread-turn-2" },
    { turn: "thread-turn-2", message: "" },
    { turn: "thread-turn-2", message: "x".repeat(threadMessageCharsMax + 1) },
    { turn: "thread-turn-2", message: "hi", seeding: "mine" },
    { message: "hi" },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `${root}/${mine}/messages`,
          headers: versioned,
          payload,
        })
      ).statusCode,
      400,
      JSON.stringify(payload),
    );
  assert.deepEqual(held.calls, []);
});

/**
 * ONE WIRE VOCABULARY, ONE ROSTER, AND EVERY ARM IN IT: the console reads
 * `threadMessageRefusalCodes`, so a door arm answering a lookalike literal — or
 * a member the roster never heard of — is a drift no gate could see, which is
 * why every arm's code is collected and held against the whole roster both ways,
 * `NotFound` excepted as the general one every read answers with.
 *
 * The refusal map is the whole of what a member is told, and each arm is a
 * different thing to do about it: someone else's thread is theirs to write, a
 * closed one is reopened, an ownerless one cannot be, and a full one waits.
 */
test("every refusal the door can meet reaches the wire as its own status", async () => {
  const map = [
    ["NotYourThread", 403, undefined],
    ["TooLarge", 400, undefined],
    ["Closed", 409, undefined],
    ["Orphaned", 409, undefined],
    ["NotFound", 404, undefined],
    ["Backlogged", 429, String(threadBacklogRetrySeconds)],
  ] as const;

  const codes: string[] = [];
  for (const [result, status, retry] of map) {
    const held: ThreadCase = {
      calls: [],
      sent:
        result === "Backlogged"
          ? { result, retryAfterSeconds: threadBacklogRetrySeconds }
          : result === "TooLarge"
            ? { result, charsMax: threadTurnInputCharsMax }
            : { result },
    };
    await using app = appOf(held);
    const refused = await app.inject({
      method: "POST",
      url: `${root}/${mine}/messages`,
      headers: versioned,
      payload: { turn: "thread-turn-2", message: "anyone?" },
    });
    assert.equal(refused.statusCode, status, result);
    assert.equal(refused.headers["retry-after"], retry, result);
    const code = refused.json<HttpErrorEnvelope>().error.code;
    assert.notEqual(code, "InvalidRequest", result);
    codes.push(code);
  }

  assert.deepEqual(
    codes.filter((code) => code !== "NotFound").sort(),
    [...threadMessageRefusalCodes].sort(),
  );
  for (const code of codes)
    assert.ok(
      code === "NotFound" ||
        (threadMessageRefusalCodes as readonly string[]).includes(code),
      `${code} is outside the roster the console reads`,
    );
});

/**
 * The member whose project's North Star is too long cannot shorten it, so the
 * body names its own refusal and its ceiling rather than saying the request was
 * invalid — which is the one thing it was not.
 */
test("a first turn that will not fit says so, and says how much fits", async () => {
  const held: ThreadCase = {
    calls: [],
    sent: { result: "TooLarge", charsMax: threadTurnInputCharsMax },
  };
  await using app = appOf(held);

  const refused = await app.inject({
    method: "POST",
    url: `${root}/${mine}/messages`,
    headers: versioned,
    payload: { turn: "thread-turn-2", message: "why is 42 refused?" },
  });

  assert.equal(refused.statusCode, 400);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    "ThreadTurnTooLarge",
  );
  assert.equal(
    refused.json<{ charsMax: number }>().charsMax,
    threadTurnInputCharsMax,
  );
});

test("a retried message is accepted again rather than answered as a conflict", async () => {
  const held: ThreadCase = {
    calls: [],
    sent: {
      result: "AlreadySent",
      turn: asSessionTurnId("thread-turn-2"),
      ordinal: 12,
    },
  };
  await using app = appOf(held);

  const accepted = await app.inject({
    method: "POST",
    url: `${root}/${mine}/messages`,
    headers: versioned,
    payload: { turn: "thread-turn-2", message: "again" },
  });

  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.json<{ ordinal: number }>().ordinal, 12);
});

test("every thread route needs a bearer", async () => {
  const held: ThreadCase = { calls: [] };
  await using app = appOf(held);

  for (const url of [root, `${root}/${mine}`, `${root}/${mine}/transcript`])
    assert.equal((await app.inject({ url })).statusCode, 401, url);
  assert.deepEqual(held.calls, []);
});

/**
 * A route the contract declares and the server does not serve is a `404` a
 * client cannot tell from an absent project, so the table is read from the app
 * itself rather than from the source that was meant to register it.
 */
test("every thread route the contract declares is one this server serves", async () => {
  await using app = appOf({ calls: [] });
  await app.ready();

  for (const [method, url] of [
    ["GET", nativeHttpRoutes.threads],
    ["POST", nativeHttpRoutes.threads],
    ["GET", nativeHttpRoutes.thread],
    ["GET", nativeHttpRoutes.threadTranscript],
    ["POST", nativeHttpRoutes.threadMessages],
  ] as const)
    assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
});
