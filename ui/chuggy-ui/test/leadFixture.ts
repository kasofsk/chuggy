/**
 * One lead, and the two lists the page draws beside it. Its store is
 * `sessionTranscriptFixture.ts`'s, which every session's walk reads.
 */

import type {
  SessionContextResponse,
  AgenticRefusalsResponse,
  LeadInquiriesResponse,
  LeadResponse,
  SelectorHistoryResponse,
  SessionPlacementResponse,
} from "../../../src/contract/responses.ts";
import { projectPartition } from "./projectFixture.ts";
import { selectorSettingsBody } from "./selectorSettingsFixture.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  sessionTranscriptPage,
  transcriptStream,
} from "./sessionTranscriptFixture.ts";

export const leadSession = "lead-atlas";

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
    agentReference: transcriptStream,
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
    streams: [{ stream: transcriptStream, batches }],
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
  dispatches: [],
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
    dispatches: [],
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
    dispatches: [{ ticket: 41, state: "Submitted" }],
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
 * One decision, three dispatches, three different landings: one still queued,
 * one the writer took, and one it refused on a fence that had moved. A panel
 * that drew a decision's dispatches as one arm would have to pick one of the
 * three states to draw them all in.
 */
export const leadDecisionLanding: SelectorHistoryResponse["decisions"][number] =
  {
    ...leadDecisionDispatching,
    ordinal: 1_203,
    decision: "selector-decision-3",
    dispatches: [
      { ticket: 51, state: "Pending" },
      { ticket: 52, state: "Terminal", outcome: "Succeeded" },
      { ticket: 53, state: "Terminal", outcome: "SelectionChanged" },
    ],
    refused: [42],
    lifted: [],
  };

/** A decision the writer refused every dispatch of, which is the partial-failure
 * shape at its limit and the one group nothing in should read as a landing. */
export const leadDecisionRefusedEvery: SelectorHistoryResponse["decisions"][number] =
  {
    ...leadDecisionLanding,
    ordinal: 1_204,
    decision: "selector-decision-4",
    dispatches: [
      { ticket: 61, state: "Terminal", outcome: "SelectionChanged" },
      { ticket: 62, state: "Terminal", outcome: "TicketChanged" },
    ],
    attention: "Attention",
  };

/**
 * A dispatch the record settled and cannot say the outcome of, which a
 * retained outcome this reader could not speak for leaves behind, and a
 * dispatch a reviewer has yet to answer.
 */
export const leadDecisionUnsaid: SelectorHistoryResponse["decisions"][number] =
  {
    ...leadDecisionLanding,
    ordinal: 1_205,
    decision: "selector-decision-5",
    dispatches: [
      { ticket: 71, state: "Terminal" },
      { ticket: 72, state: "AwaitingApproval" },
    ],
  };

/**
 * One decision, one settled dispatch on the word the caller names, and nothing
 * refused or lifted. `outcome` is a free string on the wire and the writer
 * fills it from a command's refusal code, its operation state or the word the
 * door accepted it as, so the settled words are not one roster.
 */
export function leadDecisionSettledOn(
  outcome: string,
): SelectorHistoryResponse["decisions"][number] {
  return {
    ...leadDecisionLanding,
    ordinal: 1_206,
    decision: "selector-decision-6",
    dispatches: [{ ticket: 81, state: "Terminal", outcome }],
    refused: [],
    lifted: [],
  };
}

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
    readonly model?: string;
    readonly tokens?: number;
    readonly costMicros?: number;
    readonly durationMs?: number;
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
    ...(held.model === undefined ? {} : { model: held.model }),
    ...(held.tokens === undefined ? {} : { tokens: held.tokens }),
    ...(held.costMicros === undefined ? {} : { costMicros: held.costMicros }),
    ...(held.durationMs === undefined ? {} : { durationMs: held.durationMs }),
  };
}

/** What a case has the server holding, which is all that varies between them. */
export interface LeadServed {
  readonly batches: number;
  readonly turns: number;
  readonly refusals: AgenticRefusalsResponse;
  readonly note?: LeadResponse["handoffNote"];
  readonly inquiries?: LeadInquiriesResponse;
  readonly placement?: SessionPlacementResponse;
  readonly settings?: unknown;
  readonly context?: SessionContextResponse;
}

/** The body and status every route the lead page reads answers with, so a case
 * scripts what it is about and nothing else. */
export function leadRouteAnswer(
  url: string,
  served: LeadServed,
): { readonly body: unknown; readonly status: number } {
  const found = (body: unknown, status = 200) => ({ body, status });
  if (url.endsWith("/session-placement"))
    return found(served.placement ?? sessionPlacementBody());
  if (url.includes("/lead/inquiries"))
    return found(served.inquiries ?? { inquiries: [] });
  if (url.includes("/lead/context"))
    return found(served.context ?? { turns: [] });
  if (url.includes("/lead/transcript")) {
    const asked = new URL(url, "https://console").searchParams.get("after");
    return found(sessionTranscriptPage(Number(asked ?? "0"), served.batches));
  }
  if (url.includes("/lead"))
    return found(
      leadBody(
        served.batches,
        served.turns,
        served.note ?? leadHandoffNote(false),
      ),
    );
  if (url.includes("/selector-settings"))
    return found(served.settings ?? selectorSettingsBody());
  if (url.includes("/selector-history")) return found(leadHistory);
  if (url.includes("/agentic-refusals")) return found(served.refusals);
  if (url.includes("/native-actions")) return found({ actions: [] });
  if (url.includes("/selector-proposals"))
    return found({ proposals: [], more: false });
  return found({ partition: projectPartition, sequence: 12, tickets: [] });
}
