/**
 * The thread wire: the four routes it adds, the bounds those routes are sized
 * against, and the schemas a browser runs over the bodies.
 *
 * The bounds are asserted as ARITHMETIC rather than as values, the way the
 * refusal pages already are: what matters is that a thread's message still fits
 * the mailbox column it is written to and that a listing still fits one body,
 * not what either number happens to be today.
 *
 * There is no encoder to start from yet — the handlers are a later unit — so
 * the schema cases are bodies written here. What that can prove is the refusal
 * of a body the server must never send, which is the half of a schema a hand
 * written case still settles.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeHttpBodyBytesMax,
  nativeHttpPathSegmentCharsMax,
  nativeHttpRoutes,
  partitionPath,
  sessionTurnBacklogMax,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnSeriesMax,
  threadBacklogMax,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../../src/contract/http.ts";
import { threadMessageSchema } from "../../src/contract/requests.ts";
import {
  leadTranscriptResponseSchema,
  threadEntryResponseSchema,
  threadMessageAcceptedSchema,
  threadResponseSchema,
  threadTranscriptResponseSchema,
  threadTurnResponseSchema,
  threadsResponseSchema,
} from "../../src/contract/responses.ts";

const partition = partitionPath({ tenant: "acme", project: "atlas" });

const entry = {
  session: "thread-geoff",
  owner: "geoff",
  state: "Open",
  mine: true,
  turns: 3,
  agentReference: "1a2b",
} as const;

const turn = {
  turn: "thread-turn-1",
  ordinal: 1,
  inputKind: "UserMessage",
  state: "Answered",
  input: "what is blocking 42?",
  result: "the dependency is still failing",
} as const;

test("every thread route hangs from the project it is scoped to", () => {
  const routes = [
    nativeHttpRoutes.threads,
    nativeHttpRoutes.thread,
    nativeHttpRoutes.threadTranscript,
    nativeHttpRoutes.threadMessages,
  ];

  assert.equal(new Set(routes).size, routes.length);
  for (const route of routes)
    assert.ok(route.startsWith("/api/v1/tenants/:tenant/projects/:project/"));
  assert.equal(
    nativeHttpRoutes.threads
      .replace(":tenant", "acme")
      .replace(":project", "atlas"),
    `${partition}/threads`,
  );
  for (const route of [
    nativeHttpRoutes.thread,
    nativeHttpRoutes.threadTranscript,
    nativeHttpRoutes.threadMessages,
  ])
    assert.ok(route.startsWith(`${nativeHttpRoutes.threads}/:session`), route);
});

/**
 * A first turn is the seeding block and the member's message together, and the
 * mailbox column is what has to hold both.
 */
test("a seeded first turn fits the mailbox column it is written to", () => {
  assert.ok(
    threadMessageCharsMax + threadSeedingCharsMax <= sessionTurnInputCharsMax,
  );
});

test("a thread's backlog and its answered tail are inside the mailbox's own", () => {
  assert.ok(threadBacklogMax <= sessionTurnBacklogMax);
  assert.ok(threadTurnsAnsweredMax <= sessionTurnSeriesMax);
});

/**
 * A listing carries three identities, a count and a flag per thread, so a full
 * page is bounded by the identity bound and nothing else.
 */
test("a full page of threads fits one wire body", () => {
  assert.ok(
    threadsAnsweredMax * nativeHttpPathSegmentCharsMax * 3 <=
      nativeHttpBodyBytesMax,
  );
});

test("a thread entry names its owner, whether it is mine, and how much it holds", () => {
  const parsed = threadEntryResponseSchema.parse(entry);

  assert.equal(parsed.owner, "geoff");
  assert.equal(parsed.mine, true);
  assert.throws(() =>
    threadEntryResponseSchema.parse({ ...entry, mine: undefined }),
  );
  assert.throws(() =>
    threadEntryResponseSchema.parse({ ...entry, state: "Orphaned" }),
  );
});

/** A revoked membership leaves a thread nobody owns, and it is listed rather than hidden. */
test("a thread whose owner's membership is gone still parses", () => {
  const parsed = threadEntryResponseSchema.parse({
    ...entry,
    owner: undefined,
  });

  assert.equal(parsed.owner, undefined);
});

test("a listing longer than one answers with is refused", () => {
  assert.equal(
    threadsResponseSchema.parse({
      threads: Array.from({ length: threadsAnsweredMax }, () => entry),
    }).threads.length,
    threadsAnsweredMax,
  );
  assert.throws(() =>
    threadsResponseSchema.parse({
      threads: Array.from({ length: threadsAnsweredMax + 1 }, () => entry),
    }),
  );
});

test("a turn carries what the member typed and what came back, each inside its column", () => {
  const parsed = threadTurnResponseSchema.parse(turn);

  assert.equal(parsed.input, "what is blocking 42?");
  assert.equal(parsed.result, "the dependency is still failing");
  assert.throws(() =>
    threadTurnResponseSchema.parse({
      ...turn,
      input: "x".repeat(threadMessageCharsMax + threadSeedingCharsMax + 1),
    }),
  );
  assert.throws(() =>
    threadTurnResponseSchema.parse({
      ...turn,
      result: "x".repeat(sessionTurnResultCharsMax + 1),
    }),
  );
  assert.throws(() =>
    threadTurnResponseSchema.parse({ ...turn, input: undefined }),
  );
});

test("a thread read carries its mailbox tail and no more of it", () => {
  const read = {
    session: "thread-geoff",
    owner: "geoff",
    state: "Open",
    mine: false,
    turns: [turn],
    streams: [{ stream: "1a2b", batches: 4 }],
  };

  assert.equal(threadResponseSchema.parse(read).turns.length, 1);
  assert.throws(() =>
    threadResponseSchema.parse({
      ...read,
      turns: Array.from({ length: threadTurnsAnsweredMax + 1 }, () => turn),
    }),
  );
  assert.throws(() => threadResponseSchema.parse({ ...read, mine: undefined }));
});

/** The walk is the lead's, over a different session, so the page is the same page. */
test("a thread's transcript is the lead's schema and not a second copy", () => {
  assert.equal(threadTranscriptResponseSchema, leadTranscriptResponseSchema);
});

test("the message door takes a minted turn and a message inside its bound", () => {
  const message = { turn: "thread-turn-2", message: "why is 42 refused?" };

  assert.equal(threadMessageSchema.parse(message).turn, "thread-turn-2");
  assert.throws(() => threadMessageSchema.parse({ ...message, message: "" }));
  assert.throws(() =>
    threadMessageSchema.parse({
      ...message,
      message: "x".repeat(threadMessageCharsMax + 1),
    }),
  );
  assert.throws(() =>
    threadMessageSchema.parse({ ...message, seeding: "mine" }),
  );
  assert.equal(
    threadMessageAcceptedSchema.parse({ turn: "thread-turn-2", ordinal: 12 })
      .ordinal,
    12,
  );
});
