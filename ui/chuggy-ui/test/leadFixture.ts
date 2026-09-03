/**
 * One lead, its store read a page at a time, and the two lists the page draws
 * beside it.
 *
 * The store is written so that a walk over it meets every shape a page has: one
 * wholly below the cut holding none of its entries, one carrying the boundary
 * and holding it, and pages above it holding all of theirs. So a case can tell
 * "held" from "read", and can tell where the seam is drawn from whether it is
 * drawn at all.
 */

import type {
  AgenticRefusalsResponse,
  LeadInquiriesResponse,
  LeadResponse,
  LeadTranscriptResponse,
  SelectorHistoryResponse,
} from "../../../src/contract/responses.ts";

export const leadSession = "lead-atlas";
export const leadStream = "1a2b3c";

/** The boundary the last compaction cut at, which is the first entry held. */
export const leadBoundaryUuid = "uuid-c";

/** How much of the note the lead read carries, and how much of it is missing. */
export function leadHandoffNote(
  truncated: boolean,
): LeadResponse["handoffNote"] {
  return {
    bytes: truncated ? 9_000 : 42,
    preview: "watch ticket 41",
    truncated,
  };
}

export function leadBody(
  batches: number,
  turns: number,
  note = leadHandoffNote(false),
): LeadResponse {
  return {
    session: leadSession,
    state: "Open",
    attention: "Monitoring",
    agentReference: leadStream,
    notificationCursor: 1204,
    handoffNote: note,
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

/**
 * The store, a batch at a time. The first batch is wholly below the cut and the
 * second ends on the compaction summary, so a walk over this store meets a page
 * holding none of its entries, a page holding some of them, and pages holding
 * all of them.
 */
const leadBatchEntries: readonly (readonly LeadTranscriptResponse["entries"][number][])[] =
  [
    [
      leadEntry("uuid-p", "user", "an observation before the cut"),
      leadEntry("uuid-q", "assistant", "a decision before the cut"),
    ],
    [
      leadEntry("uuid-a", "user", "first observation"),
      leadEntry("uuid-b", "assistant", "first decision"),
      leadEntry(leadBoundaryUuid, "user", "compaction summary"),
    ],
    [leadEntry("uuid-d", "assistant", "second decision")],
    [leadEntry("uuid-e", "assistant", "third decision")],
  ];

/** The batch the stream's one compaction falls in, which every page decided
 * against answers with. */
const leadCutBatch = 2;

/**
 * Which of a page's own entries the lead still holds, decided by the cut in the
 * whole stream and not by what the page happens to carry: none of them on a
 * batch below the cut, and the boundary on where the page holds it. `after` is
 * the cursor the page was asked with, so the batch it answers is `after + 1`.
 */
function leadHeldOf(
  after: number,
  entries: readonly LeadTranscriptResponse["entries"][number][],
): readonly string[] {
  if (after < leadCutBatch - 1) return [];
  const at = entries.findIndex((entry) => entry.uuid === leadBoundaryUuid);
  return entries
    .slice(at < 0 ? 0 : at)
    .flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid]));
}

/**
 * One page of the store: one batch, so `nextAfter` is present exactly where the
 * page filled its limit and a final full page is followed by an empty one.
 * Every page answers `held` over its own entries — possibly none of them — and
 * absence is reserved for a read that could not decide it.
 */
export function leadTranscriptPage(
  after: number,
  batches: number,
): LeadTranscriptResponse {
  const entries = after < batches ? (leadBatchEntries[after] ?? []) : [];
  const at = entries.findIndex((entry) => entry.uuid === leadBoundaryUuid);
  return {
    stream: leadStream,
    entries: [...entries],
    held: [...leadHeldOf(after, entries)],
    cut: leadCutBatch,
    ...(at < 0
      ? {}
      : {
          compaction: {
            boundary: leadBoundaryUuid,
            at: "2026-09-01T10:00:00Z",
          },
        }),
    elided: 0,
    truncated: false,
    ...(entries.length === 0 ? {} : { nextAfter: after + 1 }),
  };
}

/** A lead whose first turn has not run, so it names no stream and holds none. */
export function leadUnstarted(): LeadResponse {
  return {
    session: leadSession,
    state: "Open",
    attention: "Monitoring",
    notificationCursor: 0,
    handoffNote: { bytes: 0, preview: "", truncated: false },
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

/** The decision that refused a ticket, which is the older of the two. */
export const leadDecisionRefusing: SelectorHistoryResponse["decisions"][number] =
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
  };

/** The decision that ran last, which is the one the panel opens on. */
export const leadDecisionDispatching: SelectorHistoryResponse["decisions"][number] =
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
  };

/**
 * The newest arm's own answer: descending ordinal, one bounded page, no cursor.
 * A panel that reordered it would draw the oldest decision it holds as the one
 * that just ran.
 */
export const leadHistory: SelectorHistoryResponse = {
  decisions: [leadDecisionDispatching, leadDecisionRefusing],
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

/**
 * One inquiry as the listing carries it: the asker the membership audits, and
 * the answer where the fork has given one.
 */
export function leadInquiry(
  at: number,
  held: {
    readonly turnState: LeadInquiriesResponse["inquiries"][number]["turnState"];
    readonly mine?: boolean;
    readonly answer?: string;
    readonly failure?: LeadInquiriesResponse["inquiries"][number]["failure"];
  },
): LeadInquiriesResponse["inquiries"][number] {
  return {
    session: `inq-${String(at)}`,
    asker: `subject-${String(at)}`,
    mine: held.mine ?? false,
    state: held.turnState === "Answered" ? "Closed" : "Open",
    turnState: held.turnState,
    ordinal: 1,
    question: `question ${String(at)}`,
    ...(held.answer === undefined ? {} : { answer: held.answer }),
    ...(held.failure === undefined ? {} : { failure: held.failure }),
    askedAt: "2026-09-01T11:00:00Z",
  };
}

/** What a case has the server holding, which is all that varies between them. */
export interface LeadServed {
  readonly batches: number;
  readonly turns: number;
  readonly refusals: AgenticRefusalsResponse;
  readonly note?: LeadResponse["handoffNote"];
  readonly inquiries?: LeadInquiriesResponse;
}

/** The body and status every route the lead page reads answers with, so a case
 * scripts what it is about and nothing else. */
export function leadRouteAnswer(
  url: string,
  served: LeadServed,
): { readonly body: unknown; readonly status: number } {
  const found = (body: unknown, status = 200) => ({ body, status });
  if (url.includes("/lead/inquiries"))
    return found(served.inquiries ?? { inquiries: [] });
  if (url.includes("/lead/transcript")) {
    const asked = new URL(url, "https://console").searchParams.get("after");
    return found(leadTranscriptPage(Number(asked ?? "0"), served.batches));
  }
  if (url.includes("/lead"))
    return found(
      leadBody(
        served.batches,
        served.turns,
        served.note ?? leadHandoffNote(false),
      ),
    );
  if (url.includes("/selector-history")) return found(leadHistory);
  if (url.includes("/agentic-refusals")) return found(served.refusals);
  if (url.includes("/native-actions")) return found({ actions: [] });
  return found({ partition: leadPartition, sequence: 12, tickets: [] });
}

export const leadPartition = { tenant: "acme", project: "atlas" };

/**
 * The resource a `Session` change frame carries: the session, what kind of
 * session it is, and the turn that moved. The kind is the SESSION's own, read
 * from its row by the trigger that writes the frame — not a name for what moved
 * — which is what lets a panel watch one kind of session across a project that
 * holds several.
 */
export function leadSessionResource(
  session: string,
  turn: string,
  kind = "Lead",
): string {
  return JSON.stringify({ session, kind, turn });
}
