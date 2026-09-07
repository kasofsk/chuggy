/**
 * The thread wire: the five routes it adds, the bounds those routes are sized
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
  selectorSettingsTextCharsMax,
  sessionTurnBacklogMax,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnSeriesMax,
  threadBacklogMax,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadWakeCharsMax,
  threadSeedingFixedCharsMax,
  threadTitleCharsMax,
  threadTurnRecordedCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../../src/contract/http.ts";
import { threadMessageSchema } from "../../src/contract/requests.ts";
import {
  leadTranscriptResponseSchema,
  leadTurnResponseSchema,
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
    nativeHttpRoutes.threadClose,
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
    nativeHttpRoutes.threadClose,
  ])
    assert.ok(route.startsWith(`${nativeHttpRoutes.threads}/:session`), route);
});

/**
 * A later turn is the member's message alone, so it is the message bound the
 * mailbox column has to hold outright.
 */
test("a message fits the mailbox column as that column stands", () => {
  assert.ok(threadMessageCharsMax <= sessionTurnInputCharsMax);
});

/**
 * A first turn carries the project's North Star and its standing rules and
 * sheds neither, so the seeding ceiling is DERIVED from what the settings route
 * already accepts for each rather than named below it — a ceiling under that
 * would refuse every first turn of a project whose texts are long, on every
 * member.
 */
test("the seeding ceiling is derived from the two texts it must carry", () => {
  assert.equal(
    threadSeedingCharsMax,
    selectorSettingsTextCharsMax * 2 + threadSeedingFixedCharsMax,
  );
});

/**
 * The mailbox column's ceiling is derived from the widest lead observation, and
 * a thread's whole first turn is far inside it — so the thread needs no arm of
 * that derivation. This is what says so, and what stops a later thread bound
 * growing past a column nobody re-derived.
 */
test("a seeded first turn is dominated by the mailbox column it is written to", () => {
  assert.ok(
    threadMessageCharsMax + threadSeedingCharsMax <= sessionTurnInputCharsMax,
  );
});

/**
 * A wake document is written to the same column through the other door, and it
 * carries the standing rules as JSON escapes them rather than as they read. The
 * recorded ceiling is what both doors are measured against, so a reader bounds
 * the row rather than the door it happened to think of.
 */
test("the recorded ceiling admits both doors, and the column admits it", () => {
  assert.ok(
    threadMessageCharsMax + threadSeedingCharsMax <= threadTurnRecordedCharsMax,
  );
  assert.ok(threadWakeCharsMax <= threadTurnRecordedCharsMax);
  assert.ok(threadTurnRecordedCharsMax <= sessionTurnInputCharsMax);
});

test("a thread's backlog and its answered tail are inside the mailbox's own", () => {
  assert.ok(threadBacklogMax <= sessionTurnBacklogMax);
  assert.ok(threadTurnsAnsweredMax <= sessionTurnSeriesMax);
});

/**
 * A listing carries three identities, a title, a count and a flag per thread,
 * so a full page is bounded by the identity bound and the title bound.
 */
test("a full page of threads fits one wire body", () => {
  assert.ok(
    threadsAnsweredMax * nativeHttpPathSegmentCharsMax * 3 +
      threadsAnsweredMax * threadTitleCharsMax <=
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
    threadEntryResponseSchema.parse({ ...entry, state: "Reaped" }),
  );
});

/**
 * A thread whose owner's membership is gone stands `Orphaned`, and the wire
 * says so rather than reporting the session state alone: a reader deciding
 * whether a thread still acts cannot get that from `Open` and an absent owner
 * without knowing which of the two facts to fold.
 */
test("a thread whose owner is gone is named on the wire, not folded away", () => {
  assert.equal(
    threadEntryResponseSchema.parse({
      ...entry,
      owner: undefined,
      state: "Orphaned",
    }).state,
    "Orphaned",
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

/**
 * The console parses these bodies, so a title the server let past its bound
 * would fail the whole body and blank the rail for every reader. The refusal is
 * measured in code points, which is why the case is written in emoji: a title
 * of that many code points is twice as many UTF-16 units and four times as many
 * bytes, and only the code-point measure admits it.
 */
test("a title is carried to its bound and refused past it, by code points", () => {
  const title = "\u{1F9F5}".repeat(threadTitleCharsMax);
  const read = {
    session: "thread-geoff",
    owner: "geoff",
    state: "Open",
    mine: false,
    turns: [turn],
    streams: [],
  };

  assert.equal(
    threadEntryResponseSchema.parse({ ...entry, title }).title,
    title,
  );
  assert.equal(threadResponseSchema.parse({ ...read, title }).title, title);
  assert.equal(threadEntryResponseSchema.parse(entry).title, undefined);
  assert.throws(() =>
    threadEntryResponseSchema.parse({ ...entry, title: `${title}\u{1F9F5}` }),
  );
  assert.throws(() =>
    threadResponseSchema.parse({ ...read, title: `${title}\u{1F9F5}` }),
  );
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
      input: "x".repeat(threadTurnRecordedCharsMax + 1),
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

/**
 * The measurement is one shape both turns spread, so nothing else says which
 * fields a turn's measure carries. Written out here in both directions, because
 * `z.object` strips an unknown key rather than refusing it and a field dropped
 * from the shape would be cut from every body in silence.
 */
test("a turn's measurement carries exactly the fields a pod reports", () => {
  const measured = [
    "batchFirst",
    "batchLast",
    "costMicros",
    "durationMs",
    "model",
    "tokens",
    "tools",
  ];

  assert.deepEqual(
    Object.keys(leadTurnResponseSchema.shape).sort(),
    [
      ...measured,
      "decision",
      "failure",
      "inputKind",
      "ordinal",
      "state",
      "turn",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(threadTurnResponseSchema.shape).sort(),
    [
      ...measured,
      "failure",
      "input",
      "inputKind",
      "ordinal",
      "result",
      "state",
      "turn",
    ].sort(),
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

/**
 * One turn carries what the member typed and what came back, and either alone
 * may weigh most of a body — so the mailbox is paged where the listing is not,
 * and a page that has older turns behind it says which cursor reaches them.
 */
test("a mailbox page names the cursor an older page is asked for with", () => {
  const read = {
    session: "thread-geoff",
    owner: "geoff",
    state: "Open",
    mine: true,
    turns: [turn],
    nextBefore: 1,
    streams: [],
  };

  assert.equal(threadResponseSchema.parse(read).nextBefore, 1);
  assert.equal(
    threadResponseSchema.parse({ ...read, nextBefore: undefined }).nextBefore,
    undefined,
  );
  assert.throws(() => threadResponseSchema.parse({ ...read, nextBefore: -1 }));
});

/**
 * WHAT PAGING GUARANTEES IS THE PAGE, NOT A BYTE BOUND: one turn carries what
 * the member typed and what came back, those two columns alone exceed what this
 * server accepts as a REQUEST body, and so no page size makes a mailbox read fit
 * that number. What paging buys is an answer bounded by the page asked for
 * rather than by how long the conversation has become, with
 * `chuggyToolResponseBytesMax` bounding the tool side by truncating.
 */
test("a mailbox answers the page asked for, however long the conversation is", () => {
  assert.equal(
    threadResponseSchema.parse({
      session: "thread-geoff",
      state: "Open",
      mine: true,
      turns: [],
      streams: [],
    }).turns.length,
    0,
  );
  assert.ok(
    threadMessageCharsMax + sessionTurnResultCharsMax > nativeHttpBodyBytesMax,
  );
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
