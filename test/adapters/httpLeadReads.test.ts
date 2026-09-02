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
import {
  agenticRefusalsResponseSchema,
  leadResponseSchema,
  leadTranscriptResponseSchema,
  selectorHistoryResponseSchema,
  ticketAgenticRefusalsResponseSchema,
} from "../../src/contract/responses.ts";
import {
  asPrincipal,
  asPublicInstant,
  nativeWeb,
  type NativeLeadPorts,
  type NativeReadStore,
  type ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import type { AgenticRefusalEntry } from "../../src/interpreter/agenticRefusal.ts";
import type { LeadStanding } from "../../src/interpreter/leadRead.ts";
import type {
  SelectorInteractionRecord,
  SelectorStateStore,
} from "../../src/interpreter/selector.ts";
import type { SessionStoreRead } from "../../src/interpreter/sessionStore.ts";
import { openExecutionBacklogGuard } from "../../src/interpreter/schedulerContext.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalsAnsweredMax,
  sessionTranscriptHeldBatchesMax,
} from "../../src/contract/http.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  type OperationInbox,
} from "../../src/interpreter/operationInbox.ts";
import type { AuthoringStore } from "../../src/interpreter/authoring.ts";
import type { NotificationStore } from "../../src/interpreter/notifications.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
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
  attention: "Monitoring",
  notificationCursor: 1204,
  handoffNote: { watching: "the dependency" },
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

const refusalEntries: readonly AgenticRefusalEntry[] = [
  {
    ordinal: 91,
    partition,
    ticket: asTicketId(42),
    event: "Refused",
    ticketVersion: 2,
    reason: "the dependency is still failing",
    decision: "selector-decision-one",
    recordedAt: "2026-09-02T00:00:00.000Z",
  },
];

const interaction: SelectorInteractionRecord = {
  ordinal: 11,
  decision: "selector-decision-one",
  partition,
  instructionsVersion: "12.4",
  instructions: "x".repeat(4_096),
  observedView: [],
  context: {
    operationalContext: {
      version: 1,
      observedAt: "2026-09-02T00:00:00.000Z",
      observedAtEpochMs: 0,
      reviewFeedback: [],
      activeWork: [],
      projectCapacity: {
        account: "acme",
        allocated: 0,
        limit: 1,
        available: 1,
      },
      clusterCapacity: {
        visibility: "AuthorizedAggregate",
        allocated: 0,
        limit: 1,
        available: 1,
        pressure: "Normal",
      },
      executionBacklog: { queued: 0, ceiling: 1, dispatchAllowed: true },
    },
    handoffNote: {},
  },
  toolActivity: [],
  result: {
    dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
    refusals: [{ ticket: 42, ticketVersion: 2, reason: "still failing" }],
    lifts: [{ ticket: 40 }],
    attention: "Attention",
  },
  implementationRevision: "build",
  modelRevision: "claude-haiku-4-5",
  policyRevision: stream,
  accounting: { tokens: 41_234, durationMs: 74_210, costMicros: 182_000 },
  startedAt: "2026-09-02T00:00:00.000Z",
  completedAt: "2026-09-02T00:01:14.210Z",
};

interface LeadCase {
  readonly allowed?: boolean;
  readonly standing?: LeadStanding | undefined;
  readonly draws?: readonly SessionStoreRead[];
  readonly ticketVersion?: number;
  /** How many rows each refusal read answers, so a short page can be driven. */
  readonly refusalRows?: number;
  /** Whether the ledger's newest entry lifts the refusal before it. */
  readonly lifted?: boolean;
}

/**
 * A ledger of `rows` entries, oldest first, alternating so the newest is a lift
 * where a case asks for one. The port answers one past the page bound the way
 * the definer function does, which is what lets `more` be true at all.
 */
function ledgerOf(
  rows: number,
  lifted: boolean,
): readonly AgenticRefusalEntry[] {
  return Array.from({ length: rows }, (_unused, index) => ({
    ordinal: index + 1,
    partition,
    ticket: asTicketId(42),
    event:
      lifted && index === rows - 1 ? ("Lifted" as const) : ("Refused" as const),
    ticketVersion: 2,
    reason: "the dependency is still failing",
    decision: `selector-decision-${String(index)}`,
    recordedAt: "2026-09-02T00:00:00.000Z",
  }));
}

function readStore(ticketVersion: number): NativeReadStore {
  return {
    operation: () => Promise.resolve(undefined),
    project: () =>
      Promise.resolve({
        result: "Found",
        project: { partition, sequence: 0, tickets: [] },
      }),
    ticket: (_partition, ticket) =>
      Promise.resolve({
        ticket,
        phase: "Working",
        sequence: ticketVersion,
        changedAt: asPublicInstant("2026-09-02T00:00:00Z"),
      }),
    ticketNativeActions: () => Promise.resolve([]),
    nativeActions: () => Promise.resolve({ actions: [] }),
  };
}

function leadPorts(shape: LeadCase): NativeLeadPorts {
  const draws = shape.draws ?? [];
  const history: Pick<SelectorStateStore, "history"> = {
    history: () => Promise.resolve([interaction]),
  };
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
    refusals: {
      standing: (_partition, limit) =>
        Promise.resolve(
          Array.from(
            { length: Math.min(shape.refusalRows ?? 1, limit) },
            (_unused, index) => ({
              ticket: asTicketId(42 + index),
              ticketVersion: 2,
              reason: "the dependency is still failing",
              decision: "selector-decision-one",
              recordedAt: "2026-09-02T00:00:00.000Z",
            }),
          ),
        ),
      ledger: (_partition, _ticket, limit) =>
        Promise.resolve(
          shape.refusalRows === undefined
            ? refusalEntries
            : ledgerOf(shape.refusalRows, shape.lifted ?? false).slice(
                0,
                limit,
              ),
        ),
    },
    history,
  };
}

function appOf(shape: LeadCase = {}) {
  const access: ProjectAccess = {
    authorize: () =>
      Promise.resolve((shape.allowed ?? true) ? authority : undefined),
  };
  const inbox: OperationInbox = {
    accept: () => Promise.resolve({ accepted: "InvalidCommand" }),
    cancel: () => Promise.resolve({ cancelled: "Unknown" }),
    operation: () => Promise.resolve(undefined),
  };
  const notifications: NotificationStore = {
    read: () => Promise.resolve({ result: "Events", cursor: 0, events: [] }),
  };
  const web = nativeWeb(
    access,
    readStore(shape.ticketVersion ?? 2),
    inbox,
    {} as AuthoringStore,
    notifications,
    openExecutionBacklogGuard,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    leadPorts(shape),
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: asPrincipal("issuer\u0000subject") },
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
  const body = leadResponseSchema.parse(found.json());
  assert.equal(body.session, "lead-atlas");
  assert.equal(body.attention, "Monitoring");
  assert.equal(body.turns[0]?.decision, "selector-decision-one");
  assert.equal(body.turns[0]?.tokens, 41_234);
  assert.equal(body.handoffNote.truncated, false);
  assert.equal(
    body.handoffNote.preview,
    JSON.stringify(leadStanding.handoffNote),
  );
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
  for (const path of [
    `${root}/lead`,
    `${root}/lead/transcript`,
    `${root}/agentic-refusals`,
    `${root}/tickets/42/agentic-refusals`,
    `${root}/selector-history`,
  ]) {
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
  assert.equal(undecided.truncated, true, "and the page says it falls short");
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
  assert.equal(body.held, undefined, "this page carries no compaction");
});

test("a store that cannot be reached at all refuses the page", async () => {
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

test("standing refusals carry the supersession the reader computes", async () => {
  await using standing = appOf({ ticketVersion: 2 });
  const held = agenticRefusalsResponseSchema.parse(
    (
      await standing.inject({
        url: `${root}/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(held.refusals[0]?.superseded, false);
  assert.equal(held.more, false);
  await using authored = appOf({ ticketVersion: 3 });
  const cleared = agenticRefusalsResponseSchema.parse(
    (
      await authored.inject({
        url: `${root}/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(cleared.refusals[0]?.superseded, true);
});

test("a page that stops short of the ledger says so and claims no standing", async () => {
  await using app = appOf({
    refusalRows: agenticRefusalLedgerAnsweredMax + 5,
    lifted: true,
  });
  const body = ticketAgenticRefusalsResponseSchema.parse(
    (
      await app.inject({
        url: `${root}/tickets/42/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(body.more, true, "more must be able to come out true");
  assert.equal(body.entries.length, agenticRefusalLedgerAnsweredMax);
  assert.ok(
    body.entries.every((entry) => entry.event === "Refused"),
    "the page ends on a refusal the ledger's own latest entry has lifted",
  );
  assert.equal(
    body.standing,
    undefined,
    "standing is not read off a page that stops short of the latest entry",
  );
});

test("a standing page that stops short says so", async () => {
  await using app = appOf({ refusalRows: agenticRefusalsAnsweredMax + 1 });
  const body = agenticRefusalsResponseSchema.parse(
    (
      await app.inject({ url: `${root}/agentic-refusals`, headers: authorized })
    ).json(),
  );
  assert.equal(body.more, true, "more must be able to come out true");
  assert.equal(body.refusals.length, agenticRefusalsAnsweredMax);
});

test("a ticket's ledger answers its entries and the refusal it stands on", async () => {
  await using app = appOf();
  const found = await app.inject({
    url: `${root}/tickets/42/agentic-refusals`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = ticketAgenticRefusalsResponseSchema.parse(found.json());
  assert.equal(body.ticket, 42);
  assert.equal(body.entries[0]?.event, "Refused");
  assert.equal(body.standing?.ticketVersion, 2);
  assert.equal(body.more, false);
});

test("the decision log draws what a decision did, never what it saw", async () => {
  await using app = appOf();
  const found = await app.inject({
    url: `${root}/selector-history?limit=1`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = selectorHistoryResponseSchema.parse(found.json());
  const decision = body.decisions[0];
  assert.deepEqual(decision?.dispatched, [41]);
  assert.deepEqual(decision?.refused, [42]);
  assert.deepEqual(decision?.lifted, [40]);
  assert.equal(decision?.attention, "Attention");
  assert.equal(decision?.costMicros, 182_000);
  assert.equal(body.nextAfter, 11);
  assert.ok(!found.body.includes(interaction.instructions));
});

test("a page bound the wire does not admit is refused, never clamped", async () => {
  await using app = appOf({
    draws: storedBatches(stream, 2).map(
      (content) => ({ read: "Content", content }) as const,
    ),
  });
  for (const path of [
    `${root}/lead/transcript?limit=99`,
    `${root}/agentic-refusals?limit=99`,
    `${root}/selector-history?limit=999`,
  ]) {
    const found = await app.inject({ url: path, headers: authorized });
    assert.equal(found.statusCode, 400, path);
  }
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
