/**
 * One lead, its store read a page at a time, and the two lists the page draws
 * beside it.
 *
 * The store is written so that the seam falls in the middle of what the page
 * holds: the first page carries the compaction boundary and the second carries
 * an entry after it, so a case can tell "held" from "read" and can tell where
 * the seam is drawn from whether it is drawn at all.
 */

import type {
  AgenticRefusalsResponse,
  LeadResponse,
  LeadTranscriptResponse,
  SelectorHistoryResponse,
} from "../../../src/contract/responses.ts";

export const leadSession = "lead-atlas";
export const leadStream = "1a2b3c";

/** The boundary the last compaction cut at, which is the first entry held. */
export const leadBoundaryUuid = "uuid-c";

export function leadBody(batches: number, turns: number): LeadResponse {
  return {
    session: leadSession,
    state: "Open",
    attention: "Monitoring",
    agentReference: leadStream,
    notificationCursor: 1204,
    handoffNote: {},
    turns: Array.from({ length: turns }, (_unused, at) => ({
      turn: `turn-${String(at + 1)}`,
      ordinal: at + 1,
      inputKind: "Observation" as const,
      state: "Answered" as const,
      decision: `selector-decision-${String(at + 1)}`,
      model: "claude-opus-4",
      tokens: 52_100,
      costMicros: 210_000,
      durationMs: 61_000,
      tools: [],
      batchFirst: 1,
      batchLast: batches,
    })),
    streams: [{ stream: leadStream, batches }],
  };
}

function leadEntry(
  uuid: string,
  type: string,
  text: string,
): LeadTranscriptResponse["entries"][number] {
  return {
    uuid,
    type,
    timestamp: "2026-09-01T10:00:00Z",
    message: { content: [{ type: "text", text }] },
  };
}

export const leadTranscriptPages: Readonly<
  Record<string, LeadTranscriptResponse>
> = {
  "0": {
    stream: leadStream,
    entries: [
      leadEntry("uuid-a", "user", "first observation"),
      leadEntry("uuid-b", "assistant", "first decision"),
      leadEntry(leadBoundaryUuid, "user", "compaction summary"),
    ],
    held: [leadBoundaryUuid],
    compaction: { boundary: leadBoundaryUuid, at: "2026-09-01T10:00:00Z" },
    elided: 0,
    nextAfter: 1,
  },
  "1": {
    stream: leadStream,
    entries: [leadEntry("uuid-d", "assistant", "second decision")],
    held: [leadBoundaryUuid, "uuid-d"],
    elided: 0,
  },
  "2": {
    stream: leadStream,
    entries: [leadEntry("uuid-e", "assistant", "third decision")],
    held: [leadBoundaryUuid, "uuid-d", "uuid-e"],
    elided: 0,
  },
};

/** A lead whose first turn has not run, so it names no stream and holds none. */
export function leadUnstarted(): LeadResponse {
  return {
    session: leadSession,
    state: "Open",
    attention: "Monitoring",
    notificationCursor: 0,
    handoffNote: {},
    turns: [],
    streams: [],
  };
}

/** A decision that dispatched nothing, refused nothing and moved no attention. */
export const leadDecisionIdle: SelectorHistoryResponse["decisions"][number] = {
  ordinal: 1_200,
  decision: "selector-decision-0",
  instructionsVersion: "12.3",
  dispatched: [],
  refused: [],
  lifted: [],
  modelRevision: "m1",
  policyRevision: "p1",
  startedAt: "2026-09-01T08:00:00Z",
  completedAt: "2026-09-01T08:01:00Z",
};

export const leadHistory: SelectorHistoryResponse = {
  decisions: [
    {
      ordinal: 1_201,
      decision: "selector-decision-1",
      instructionsVersion: "12.3",
      dispatched: [],
      refused: [42],
      lifted: [],
      attention: "Attention",
      modelRevision: "m1",
      policyRevision: "p1",
      tokens: 30_000,
      costMicros: 120_000,
      durationMs: 41_000,
      startedAt: "2026-09-01T09:00:00Z",
      completedAt: "2026-09-01T09:01:00Z",
    },
    {
      ordinal: 1_202,
      decision: "selector-decision-2",
      instructionsVersion: "12.4",
      dispatched: [41],
      refused: [],
      lifted: [40],
      attention: "Monitoring",
      modelRevision: "m1",
      policyRevision: "p1",
      tokens: 41_234,
      costMicros: 182_000,
      durationMs: 74_210,
      startedAt: "2026-09-01T10:00:00Z",
      completedAt: "2026-09-01T10:01:00Z",
    },
  ],
};

export function leadRefusals(
  superseded: boolean,
  reason = "the brief names no reference",
): AgenticRefusalsResponse {
  return {
    refusals: [
      {
        ticket: 42,
        ticketVersion: 2,
        reason,
        decision: "selector-decision-1",
        recordedAt: "2026-09-01T09:01:00Z",
        superseded,
      },
    ],
    more: false,
  };
}

/** What a case has the server holding, which is all that varies between them. */
export interface LeadServed {
  readonly batches: number;
  readonly turns: number;
  readonly refusals: AgenticRefusalsResponse;
}

/** The body and status every route the lead page reads answers with, so a case
 * scripts what it is about and nothing else. */
export function leadRouteAnswer(
  url: string,
  served: LeadServed,
): { readonly body: unknown; readonly status: number } {
  const found = (body: unknown, status = 200) => ({ body, status });
  if (url.includes("/lead/transcript")) {
    const after = new URL(url, "https://console").searchParams.get("after");
    const page = leadTranscriptPages[after ?? "0"];
    return found(
      page ?? { stream: leadStream, entries: [], held: [], elided: 0 },
    );
  }
  if (url.includes("/lead"))
    return found(leadBody(served.batches, served.turns));
  if (url.includes("/selector-history")) return found(leadHistory);
  if (url.includes("/agentic-refusals")) return found(served.refusals);
  if (url.includes("/native-actions")) return found({ actions: [] });
  return found({ partition: leadPartition, sequence: 12, tickets: [] });
}

export const leadPartition = { tenant: "acme", project: "atlas" };
