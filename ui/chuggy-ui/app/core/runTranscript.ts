/**
 * A run's transcript as a pane holds it: which batches are still missing, how
 * they merge with what is held, and what each recorded line is as a
 * conversation item.
 *
 * The high-water mark rides the `Execution` frame the browser already receives,
 * so the only question here is which batches sit above the highest one held —
 * nothing polls and nothing follows. An assistant or user line becomes the
 * entry the surface's own block parser reads it as; a payload the run elided,
 * a cap the run hit or a line this console cannot parse becomes the marker the
 * surface has a place for; a batch whose bytes are gone or fail their digest
 * is the same marker naming the gap it leaves, in the place the record puts
 * it. A line whose own type carries none of that — this console holds no
 * marker for the runtime's bookkeeping types — is not drawn, though a payload
 * it elided still is.
 */

import type { RunTranscriptResponse } from "../../../../src/contract/responses.ts";
import type { AttemptState } from "../../../../src/contract/rosters.ts";

import type {
  ConversationExchange,
  ConversationItem,
  ConversationStanding,
} from "./conversation.ts";
import { conversationBlocksOf } from "./conversation.ts";
import { freshnessLabel, panelObservedAtMs } from "./freshness.ts";
import { runCountLabel } from "./runTotals.ts";

/** The most batches a pane keeps, past which the oldest leave so a live run
 * stays followable. */
export const runTranscriptBatchesHeldMax = 16;

/** The most steps one pane draws, taken from the end so the newest are the ones
 * on screen. */
export const runTranscriptStepsMax = 500;

/** The most reads one rise of the high-water mark may cost. */
export const runTranscriptReadsMax = 8;

/** How deep a recorded event is walked looking for elided payloads. */
const runTranscriptEventDepthMax = 8;

/** The most elisions one event is reported to carry. */
const runTranscriptElisionsMax = 32;

const transcriptTruncatedType = "chuggy_transcript_truncated";
const turnsTruncatedType = "chuggy_turns_truncated";
const truncationMarkerKey = "chuggy_truncated";

export type RunTranscriptBatch = RunTranscriptResponse["batches"][number];

/** Whether a batch answered with its characters, or why it did not. */
export type RunTranscriptBatchRead = RunTranscriptBatch["read"];

/** What one pane holds of one run's transcript, and how it came to hold it. */
export interface RunTranscriptHeld {
  readonly batches: readonly RunTranscriptBatch[];
  readonly observedAt: string | undefined;
  readonly complete: boolean;
  readonly batchesDropped: number;
  readonly failure: string | undefined;
}

export const runTranscriptHeldEmpty: RunTranscriptHeld = {
  batches: [],
  observedAt: undefined,
  complete: false,
  batchesDropped: 0,
  failure: undefined,
};

/** The batch a read resumes after, which is zero when the pane holds none. */
export function runTranscriptHighestBatch(held: RunTranscriptHeld): number {
  return held.batches.reduce(
    (highest, batch) => Math.max(highest, batch.batch),
    0,
  );
}

/**
 * The cursor the next read asks after, and nothing at all when the run has
 * written no batch above the one this pane already holds.
 */
export function runTranscriptNextAfter(
  held: RunTranscriptHeld,
  highWaterBatch: number,
): number | undefined {
  const highest = runTranscriptHighestBatch(held);
  return highWaterBatch > highest ? highest : undefined;
}

/** Ascending by batch, each number once, and the oldest dropped past the cap. */
export function runTranscriptMerged(
  held: RunTranscriptHeld,
  page: RunTranscriptResponse,
): RunTranscriptHeld {
  const byBatch = new Map<number, RunTranscriptBatch>();
  for (const batch of held.batches) byBatch.set(batch.batch, batch);
  for (const batch of page.batches) byBatch.set(batch.batch, batch);
  const ordered = [...byBatch.values()].sort((left, right) =>
    left.batch === right.batch ? 0 : left.batch - right.batch,
  );
  const kept = ordered.slice(-runTranscriptBatchesHeldMax);
  return {
    batches: kept,
    observedAt: page.observedAt,
    complete: page.complete,
    batchesDropped: held.batchesDropped + (ordered.length - kept.length),
    failure: undefined,
  };
}

/** A read that did not answer leaves what is held alone and says why. */
export function runTranscriptFailed(
  held: RunTranscriptHeld,
  reason: string,
): RunTranscriptHeld {
  return { ...held, failure: reason };
}

/** No more can arrive, or when the newest batch the server holds was recorded. */
export function runTranscriptFreshnessSentence(
  held: RunTranscriptHeld,
  nowMs: number,
): string {
  if (held.complete) return "complete";
  if (held.observedAt === undefined) return "not read yet";
  return `as of ${freshnessLabel(nowMs, panelObservedAtMs(held, undefined))}`;
}

function elisionBytes(node: unknown, found: number[], depth: number): void {
  if (depth > runTranscriptEventDepthMax) return;
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const marker = record[truncationMarkerKey];
  if (marker !== null && typeof marker === "object") {
    const bytes = (marker as Record<string, unknown>)["bytes"];
    if (found.length < runTranscriptElisionsMax)
      found.push(typeof bytes === "number" ? bytes : 0);
  }
  for (const value of Object.values(record)) {
    if (found.length >= runTranscriptElisionsMax) return;
    elisionBytes(value, found, depth + 1);
  }
}

function cappedSentence(type: string, event: Record<string, unknown>): string {
  const batches = event["batches"];
  const turns = event["turns"];
  if (type === transcriptTruncatedType)
    return `the run reached its transcript cap and stopped recording after ${runCountLabel(typeof batches === "number" ? batches : 0)} batches`;
  return `the per-turn series reached its cap and stopped after ${runCountLabel(typeof turns === "number" ? turns : 0)} turns`;
}

/** The elisions a raw event holds, wherever in it they fall, as the markers
 * the surface draws them by. */
function runTranscriptElisionItems(
  event: Record<string, unknown>,
): readonly ConversationItem[] {
  const elided: number[] = [];
  elisionBytes(event, elided, 0);
  return elided.map((bytes) => ({
    item: "Marker",
    marker: { marker: "Elision", bytes },
  }));
}

/** The entry id a line's own message carries, or the line's place in the
 * record where it names none. */
function runTranscriptEntryId(ordinal: number, message: unknown): string {
  const record =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)
      : undefined;
  const id = record?.["id"];
  return typeof id === "string" && id.length > 0 ? id : String(ordinal);
}

/** One recorded line as the conversation items it stands for: an assistant or
 * user line is an entry, a cap or an unreadable line is the marker the
 * surface has for it, and every other type is bookkeeping the surface has no
 * place for — its elisions still are, because those are a fact about the
 * bytes rather than about the type that carried them. */
export function runTranscriptStep(
  ordinal: number,
  line: string,
): readonly ConversationItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [{ item: "Marker", marker: { marker: "Unreadable" } }];
  }
  if (parsed === null || typeof parsed !== "object")
    return [{ item: "Marker", marker: { marker: "Unreadable" } }];
  const event = parsed as Record<string, unknown>;
  const type = event["type"];
  if (typeof type !== "string")
    return [{ item: "Marker", marker: { marker: "Unreadable" } }];
  if (type === transcriptTruncatedType || type === turnsTruncatedType)
    return [
      {
        item: "Marker",
        marker: { marker: "Capped", sentence: cappedSentence(type, event) },
      },
    ];
  const elisions = runTranscriptElisionItems(event);
  if (type !== "assistant" && type !== "user") return elisions;
  return [
    ...elisions,
    {
      item: "Entry",
      entry: {
        id: runTranscriptEntryId(ordinal, event["message"]),
        role: type === "assistant" ? "Assistant" : "User",
        blocks: conversationBlocksOf(event["message"]),
      },
    },
  ];
}

/** The items a pane draws, and how many earlier lines it is not drawing. */
export interface RunTranscriptReading {
  readonly items: readonly ConversationItem[];
  readonly stepsBefore: number;
}

interface RunTranscriptLine {
  readonly batch: number;
  readonly read: RunTranscriptBatchRead;
  readonly line: string | undefined;
}

/** What stands in the record's own order where a batch's characters are not. */
export function runTranscriptGapSentence(
  batch: number,
  read: RunTranscriptBatchRead,
): string {
  switch (read) {
    case "Content":
      return `batch ${runCountLabel(batch)}: no lines recorded`;
    case "Missing":
      return `batch ${runCountLabel(batch)}: bytes unavailable`;
    case "Corrupt":
      return `batch ${runCountLabel(batch)}: bytes corrupt`;
  }
}

/** A batch the server answered no characters for carries no line, and stands
 * for itself so the gap in the record is visible where it falls. */
function runTranscriptLines(
  batch: RunTranscriptBatch,
): readonly RunTranscriptLine[] {
  const drawn =
    batch.read === "Content"
      ? batch.content.split("\n").filter((line) => line.trim().length > 0)
      : [];
  return drawn.length === 0
    ? [{ batch: batch.batch, read: batch.read, line: undefined }]
    : drawn.map((line) => ({ batch: batch.batch, read: batch.read, line }));
}

/** One held line as its items, or the gap marker naming the batch a line was
 * never recorded for. */
function runTranscriptLineItems(
  ordinal: number,
  held: RunTranscriptLine,
): readonly ConversationItem[] {
  return held.line === undefined
    ? [
        {
          item: "Marker",
          marker: {
            marker: "Capped",
            sentence: runTranscriptGapSentence(held.batch, held.read),
          },
        },
      ]
    : runTranscriptStep(ordinal, held.line);
}

/**
 * Every held batch's lines as conversation items, windowed from the end. What
 * the window cut and what the batch cap evicted are named ahead of what
 * remains, so a pane short of either says so rather than drawing a transcript
 * that looks whole.
 */
export function runTranscriptRead(
  held: RunTranscriptHeld,
): RunTranscriptReading {
  const lines = held.batches.flatMap(runTranscriptLines);
  const from = Math.max(lines.length - runTranscriptStepsMax, 0);
  const leading: ConversationItem[] = [];
  if (from > 0)
    leading.push({
      item: "Marker",
      marker: { marker: "Dropped", count: from },
    });
  if (held.batchesDropped > 0)
    leading.push({
      item: "Marker",
      marker: {
        marker: "Capped",
        sentence: `${runCountLabel(held.batchesDropped)} earlier batches are no longer held`,
      },
    });
  const items = lines
    .slice(from)
    .flatMap((line, at) => runTranscriptLineItems(from + at + 1, line));
  return { items: [...leading, ...items], stepsBefore: from };
}

/** Where a run's trailing exchange stands once the run is over: a run that
 * reported answered, and a run that ended any other way did not. A run still
 * placing or running settles nothing. */
function runTranscriptEndedStanding(
  state: AttemptState,
): ConversationStanding | undefined {
  switch (state) {
    case "Placing":
    case "Running":
      return undefined;
    case "Reported":
      return { standing: "Answered" };
    case "Lost":
    case "Withdrawn":
    case "Superseded":
      return { standing: "Failed" };
  }
}

/**
 * The exchanges a pane draws, with the trailing one settled by the state the
 * execution says the attempt is in. An exchange with no final text and no turn
 * is `Open` by construction, and a run has no mailbox — so without this a run
 * that ended on tool calls reads as one still being written, whatever the
 * attempt row says.
 */
export function runTranscriptEnded(
  exchanges: readonly ConversationExchange[],
  state: AttemptState,
): readonly ConversationExchange[] {
  const standing = runTranscriptEndedStanding(state);
  if (standing === undefined) return exchanges;
  const at = exchanges.findLastIndex(
    (exchange) => exchange.standing.standing === "Open",
  );
  return at < 0
    ? exchanges
    : exchanges.map((exchange, place) =>
        place === at ? { ...exchange, standing } : exchange,
      );
}
