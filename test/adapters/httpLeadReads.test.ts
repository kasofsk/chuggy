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
      batches: () =>
        Promise.resolve(
          draws.map((_draw, index) => ({
            batch: index + 1,
            digest: "a".repeat(64),
            bytes: 1,
          })),
        ),
    },
    store: {
      readBatch: (object) =>
        Promise.resolve(draws[object.batch - 1] ?? { read: "NotFound" }),
    },
    refusals: {
      standing: () =>
        Promise.resolve([
          {
            ticket: asTicketId(42),
            ticketVersion: 2,
            reason: "the dependency is still failing",
            decision: "selector-decision-one",
            recordedAt: "2026-09-02T00:00:00.000Z",
          },
        ]),
      ledger: () => Promise.resolve(refusalEntries),
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
          bearer: { principal: asPrincipal("issuer subject") },
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
  assert.equal(body.held.length, 5);
  const carried = new Set(body.entries.map((entry) => entry.uuid));
  for (const held of body.held) assert.ok(carried.has(held));
  assert.ok(body.entries.every((entry) => entry.type !== "attachment"));
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
