/**
 * The five lead-side reads, served through the real boundary rather than a
 * double of it, so the authorization gate, the page assembly and the response
 * mapping are all under the same assertion.
 *
 * THE TRANSCRIPT'S BYTES ARE A REAL STORE'S. The batches this suite hands the
 * boundary are lines of `test/fixtures/sessionStore/`, so the entries a route
 * answers with are entries an agent runtime wrote.
 *
 * EVERY READ IS ASSERTED REFUSED AS WELL AS ANSWERED. A read whose gate was
 * dropped answers the same body to a principal with no access, and only the
 * refused case can tell the difference.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { leadTranscriptResponseSchema } from "../../src/contract/responses.ts";
import {
  asPrincipal,
  nativeWeb,
  type NativeLeadPorts,
  type ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import type { LeadStanding } from "../../src/interpreter/leadRead.ts";
import type { SessionStoreRead } from "../../src/interpreter/sessionStore.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import { sessionTranscriptHeldBatchesMax } from "../../src/contract/http.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";

const root = "/api/v1/tenants/acme/projects/atlas";
const authorized = { authorization: "Bearer valid" };
const authority = {
  kind: asAuthorityKind("Oidc"),
  subject: asAuthoritySubject("person"),
};
const stream = asSessionStoreStream("1ffa6adc-2acf-4f98-a642-f2de9acd0623");
/** What the SDK's own accessor answered for the compacted stream's bytes. */
const sdkHeldAfterCompaction = [
  "3dac513c-ce7f-4064-852d-fa43d71830cd",
  "908e5b0d-97bf-4722-9b53-e0ea8a283d41",
  "155c3c01-aeea-4312-ab8a-68b553c15903",
  "44da818a-00ff-4b21-b967-cda5ca2c0bb1",
  "ed0c7b23-28f0-40f2-b7a9-1f9e4c0a88d3",
];
const compactedStream = asSessionStoreStream(
  "489c5211-ca5d-4031-acc7-4e8014ea966d",
);

/** One stored stream's lines, split into the batches a case wants them drawn as. */
function storedBatches(name: string, batches: number): readonly string[] {
  const lines = readFileSync(
    new URL(`../fixtures/sessionStore/${name}.jsonl`, import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((line) => line.length > 0);
  const size = Math.ceil(lines.length / batches);
  return Array.from({ length: batches }, (_unused, index) =>
    lines.slice(index * size, (index + 1) * size).join("\n"),
  );
}

const leadStanding: LeadStanding = {
  session: asSessionId("lead-atlas"),
  state: "Open",
  agentReference: stream,
  turns: [
    {
      turn: asSessionTurnId("selector-decision-one"),
      ordinal: 7,
      inputKind: "Observation",
      state: "Answered",
      measured: {
        model: "claude-haiku-4-5",
        tokens: 41_234,
        costMicros: 182_000,
        durationMs: 74_210,
        tools: [],
      },
      batchFirst: 12,
      batchLast: 14,
    },
  ],
};

interface LeadCase {
  readonly allowed?: boolean;
  readonly standing?: LeadStanding | undefined;
  readonly draws?: readonly SessionStoreRead[];
}

function leadPorts(shape: LeadCase): NativeLeadPorts {
  const draws = shape.draws ?? [];
  return {
    leads: {
      standing: () =>
        Promise.resolve("standing" in shape ? shape.standing : leadStanding),
      streams: () => Promise.resolve([{ stream, batches: 14 }]),
      batches: ({ after, limit }) =>
        Promise.resolve(
          draws
            .map((_draw, index) => ({
              batch: index + 1,
              digest: "a".repeat(64),
              bytes: 1,
            }))
            .filter((row) => row.batch > after)
            .slice(0, limit),
        ),
    },
    store: {
      readBatch: (object) =>
        Promise.resolve(draws[object.batch - 1] ?? { read: "NotFound" }),
    },
  };
}

function appOf(shape: LeadCase = {}) {
  const access: ProjectAccess = {
    authorize: () =>
      Promise.resolve((shape.allowed ?? true) ? authority : undefined),
    authorizeTenant: () => Promise.resolve(undefined),
  };
  const web = nativeWeb(
    access,
    { projects: () => Promise.resolve({ projects: [] }) },
    leadPorts(shape),
    {} as Parameters<typeof nativeWeb>[3],
    {} as Parameters<typeof nativeWeb>[4],
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: asPrincipal("issuer-subject") },
        }),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(asTenantId("acme") as unknown as never),
    },
  );
}

test("the lead read carries its standing, its mailbox tail and its streams", async () => {
  await using app = appOf();
  const found = await app.inject({
    url: `${root}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = found.json<{
    session: string;
    turns: readonly { decision?: string; tokens?: number }[];
    streams: readonly { batches: number }[];
  }>();
  assert.equal(body.session, "lead-atlas");
  assert.equal(body.turns[0]?.decision, "selector-decision-one");
  assert.equal(body.turns[0]?.tokens, 41_234);
  assert.equal(body.streams[0]?.batches, 14);
});

test("a project with no lead answers not found, as does one nobody may read", async () => {
  await using absent = appOf({ standing: undefined });
  assert.equal(
    (await absent.inject({ url: `${root}/lead`, headers: authorized }))
      .statusCode,
    404,
  );
  await using refused = appOf({ allowed: false });
  for (const path of [`${root}/lead`, `${root}/lead/transcript`]) {
    const found = await refused.inject({ url: path, headers: authorized });
    assert.equal(found.statusCode, 404, path);
  }
});

test("the transcript answers the chain over its batches and marks what is held", async () => {
  const drawn = storedBatches(compactedStream, 3).map(
    (content) => ({ read: "Content", content }) as const,
  );
  await using app = appOf({ draws: drawn });
  const found = await app.inject({
    url: `${root}/lead/transcript?stream=${compactedStream}&limit=3`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = leadTranscriptResponseSchema.parse(found.json());
  assert.equal(body.stream, compactedStream);
  assert.equal(body.elided, 0);
  assert.equal(body.truncated, false);
  assert.equal(
    body.compaction?.boundary,
    "83738f97-737d-412f-8a49-3c56c4a78ef9",
  );
  assert.equal(body.entries.length, 15);
  assert.deepEqual(
    [...(body.held ?? [])].sort(),
    [...sdkHeldAfterCompaction].sort(),
  );
  const carried = new Set(body.entries.map((entry) => entry.uuid));
  for (const held of body.held ?? []) assert.ok(carried.has(held));
  assert.ok(body.entries.every((entry) => entry.type !== "attachment"));
  const sent = found.json<{ entries: readonly Record<string, unknown>[] }>();
  assert.ok(
    sent.entries.every((entry) => !Object.hasOwn(entry, "parentUuid")),
    "the wire says what the chain is, not how it was found",
  );
});

/**
 * A stream that compacted twice, one entry per batch, so a page can be asked for
 * that carries the first cut and not the second. Held is a fact about the
 * stream, so the answer must be the second cut's however the stream is paged.
 */
function twiceCompactedBatches(): readonly SessionStoreRead[] {
  const line = (entry: Record<string, unknown>): SessionStoreRead => ({
    read: "Content",
    content: JSON.stringify(entry),
  });
  const said = (uuid: string, parentUuid: string | undefined) =>
    line({
      type: "user",
      uuid,
      ...(parentUuid === undefined ? {} : { parentUuid }),
      message: { role: "user", content: uuid },
    });
  const cut = (uuid: string, from: string, preserved: readonly string[]) =>
    line({
      type: "system",
      subtype: "compact_boundary",
      uuid,
      parentUuid: null,
      logicalParentUuid: from,
      compactMetadata: {
        preservedMessages: { anchorUuid: `${uuid}-summary`, uuids: preserved },
      },
    });
  return [
    said("u1", undefined),
    said("a1", "u1"),
    cut("b1", "a1", ["a1"]),
    said("b1-summary", "b1"),
    said("u2", "b1-summary"),
    cut("b2", "u2", []),
    said("b2-summary", "b2"),
  ];
}

test("held is the stream's last cut, whichever page is asked for", async () => {
  await using app = appOf({ draws: twiceCompactedBatches() });
  const older = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?after=0&limit=4`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(
    older.compaction?.boundary,
    "b1",
    "this page carries the first cut",
  );
  assert.deepEqual(
    older.held,
    [],
    "the second cut dropped every entry on this page",
  );
  const newer = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?after=4&limit=4`,
        headers: authorized,
      })
    ).json(),
  );
  assert.deepEqual(
    newer.held,
    ["b2-summary"],
    "what the second cut left is held wherever it is paged",
  );
});

test("a compaction while a reader is paging moves the cut it is told", async () => {
  const whole = twiceCompactedBatches();
  const page = `${root}/lead/transcript?after=0&limit=2`;
  await using before = appOf({ draws: whole.slice(0, 5) });
  const first = leadTranscriptResponseSchema.parse(
    (await before.inject({ url: page, headers: authorized })).json(),
  );
  await using after = appOf({ draws: whole });
  const second = leadTranscriptResponseSchema.parse(
    (await after.inject({ url: page, headers: authorized })).json(),
  );
  assert.equal(first.cut, 3, "the first cut fell in the third batch");
  assert.equal(second.cut, 6, "the second fell in the sixth");
  assert.notEqual(
    first.cut,
    second.cut,
    "a reader seeing a cut it has not seen resets what it holds",
  );
  assert.equal(
    first.compaction,
    undefined,
    "and neither page carries a boundary of its own to have read it from",
  );
  assert.equal(second.compaction, undefined);
});

test("a stream that never compacted names no cut", async () => {
  await using app = appOf({
    draws: storedBatches(stream, 2).map(
      (content) => ({ read: "Content", content }) as const,
    ),
  });
  const body = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.ok(body.held !== undefined, "the walk reached the stream's end");
  assert.equal(body.cut, undefined);
});

test("a page ending on a compaction boundary still answers its chain", async () => {
  await using app = appOf({ draws: twiceCompactedBatches() });
  const page = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?after=4&limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(page.compaction?.boundary, "b2");
  assert.ok(
    page.entries.length > 0,
    "a boundary carries no parent, so the walk must follow its logical one",
  );
  assert.ok(page.entries.some((entry) => entry.uuid === "u2"));
});

test("a stream longer than the held walk leaves the page undecided", async () => {
  const line = (index: number): SessionStoreRead => ({
    read: "Content",
    content: JSON.stringify({
      type: "user",
      uuid: `e${String(index)}`,
      ...(index === 0 ? {} : { parentUuid: `e${String(index - 1)}` }),
      message: { role: "user", content: "one" },
    }),
  });
  const walkable = Array.from(
    { length: sessionTranscriptHeldBatchesMax },
    (_unused, index) => line(index),
  );
  await using inside = appOf({ draws: walkable });
  const decided = leadTranscriptResponseSchema.parse(
    (
      await inside.inject({
        url: `${root}/lead/transcript?limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.ok(decided.held !== undefined, "a stream at the bound is still read");
  assert.equal(decided.truncated, false);
  await using beyond = appOf({
    draws: [...walkable, line(sessionTranscriptHeldBatchesMax)],
  });
  const undecided = leadTranscriptResponseSchema.parse(
    (
      await beyond.inject({
        url: `${root}/lead/transcript?limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(undecided.held, undefined, "past the bound nothing is decided");
  assert.equal(
    undecided.truncated,
    false,
    "and the absent held set is the whole of what the page says about that",
  );
});

test("a batch that cannot be drawn is elided, and the page is still answered", async () => {
  const batches = storedBatches(stream, 3);
  const drawn: readonly SessionStoreRead[] = [
    { read: "Content", content: batches[0] ?? "" },
    { read: "Corrupt" },
    { read: "Content", content: batches[2] ?? "" },
  ];
  await using app = appOf({ draws: drawn });
  const found = await app.inject({
    url: `${root}/lead/transcript?limit=3`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = leadTranscriptResponseSchema.parse(found.json());
  assert.equal(body.elided, 1);
  assert.ok(body.entries.length > 0);
  assert.equal(
    body.held,
    undefined,
    "the walk met the batch nobody could draw and decided nothing",
  );
  assert.equal(body.truncated, false, "and every entry it did draw crossed");
});

test("an outage on the page's own batch refuses the page", async () => {
  await using app = appOf({
    draws: [{ read: "Unavailable", retryAfterSeconds: 3 }],
  });
  const found = await app.inject({
    url: `${root}/lead/transcript?limit=1`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 503);
  assert.equal(found.headers["retry-after"], "3");
});

test("an outage beyond the page leaves held undecided, not the page refused", async () => {
  const batches = storedBatches(stream, 2);
  await using app = appOf({
    draws: [
      { read: "Content", content: batches[0] ?? "" },
      { read: "Content", content: batches[1] ?? "" },
      { read: "Unavailable", retryAfterSeconds: 7 },
    ],
  });
  const found = await app.inject({
    url: `${root}/lead/transcript?limit=2`,
    headers: authorized,
  });
  assert.equal(
    found.statusCode,
    200,
    "the batches the reader asked for all drew",
  );
  const body = leadTranscriptResponseSchema.parse(found.json());
  assert.ok(body.entries.length > 0);
  assert.equal(body.elided, 0, "no batch of this page was elided");
  assert.equal(body.held, undefined, "the walk could not decide what is held");
  assert.equal(body.truncated, false, "and every entry it did draw crossed");
});

test("a lead that has bound no stream has no transcript to answer", async () => {
  const unbound = Object.fromEntries(
    Object.entries(leadStanding).filter(
      ([field]) => field !== "agentReference",
    ),
  ) as LeadStanding;
  await using app = appOf({ standing: unbound });
  const found = await app.inject({
    url: `${root}/lead/transcript`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 404);
});

test("a transcript page bound the wire does not admit is refused", async () => {
  await using app = appOf({
    draws: storedBatches(stream, 2).map(
      (content) => ({ read: "Content", content }) as const,
    ),
  });
  const found = await app.inject({
    url: `${root}/lead/transcript?limit=99`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 400);
});

test("a full page of batches names where the next one starts", async () => {
  const batches = storedBatches(stream, 2);
  await using app = appOf({
    draws: batches.map((content) => ({ read: "Content", content }) as const),
  });
  const full = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(full.nextAfter, 2);
  const short = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/lead/transcript?limit=3`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(short.nextAfter, undefined);
});
