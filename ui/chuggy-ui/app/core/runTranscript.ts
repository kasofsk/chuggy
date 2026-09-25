/**
 * A run's transcript as a pane holds it: which batches are still missing, how
 * they merge with what is held, and what each recorded line is as a
 * conversation item.
 *
 * The high-water mark rides the `Execution` frame the browser already receives,
 * so the only question here is which batches sit above the highest one held —
 * nothing polls and nothing follows. A pane opens on the newest batches and
 * reads earlier ones only when a reader asks, because the plane numbers a
 * run's batches from one without a gap and so what lies below the held window
 * is a count rather than a guess. An assistant or user line becomes the
 * entry the surface's own block parser reads it as; a payload the run elided,
 * a cap the run hit or a line this console cannot parse becomes the marker the
 * surface has a place for; a batch whose bytes are gone or fail their digest
 * is the same marker naming the gap it leaves, in the place the record puts
 * it. A line whose own type carries none of that — this console holds no
 * marker for the runtime's bookkeeping types — is not drawn, though a payload
 * it elided still is.
 */

import { runTranscriptPageBatchesMax } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  RunTranscriptResponse,
} from "../../../../src/contract/responses.ts";
import type { AttemptState } from "../../../../src/contract/rosters.ts";

import type {
  ConversationExchange,
  ConversationItem,
  ConversationStanding,
} from "./conversation.ts";
import { conversationBlocksOf } from "./conversation.ts";
import { freshnessLabel, panelObservedAtMs } from "./freshness.ts";
import { runCountLabel } from "./runTotals.ts";

/** The batches a pane keeps while it follows a run, past which the oldest
 * leave so a live run stays followable. */
export const runTranscriptCapacityBatches = 16;

/** The most batches a reader's earlier reads may raise a pane's keep to. */
export const runTranscriptCapacityBatchesMax = 64;

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

type RunTranscriptAttempt = ExecutionResponse["attempts"][number];
type RunTranscriptRun = NonNullable<RunTranscriptAttempt["run"]>;

/** An attempt whose run recorded a transcript. */
export type RunTranscriptAttempted = RunTranscriptAttempt & {
  readonly run: RunTranscriptRun & {
    readonly transcript: NonNullable<RunTranscriptRun["transcript"]>;
  };
};

function runTranscriptRecorded(
  attempt: RunTranscriptAttempt,
): attempt is RunTranscriptAttempted {
  return attempt.run?.transcript !== undefined;
}

/** The attempt whose conversation an execution opens on: the newest that
 * recorded a transcript, and none where no attempt did. */
export function runTranscriptAttempt(
  execution: ExecutionResponse,
): RunTranscriptAttempted | undefined {
  return execution.attempts
    .filter(runTranscriptRecorded)
    .sort((left, right) => left.number - right.number)
    .at(-1);
}

/** Whether a batch answered with its characters, or why it did not. */
export type RunTranscriptBatchRead = RunTranscriptBatch["read"];

/** What one pane holds of one run's transcript, and how it came to hold it. */
export interface RunTranscriptHeld {
  readonly batches: readonly RunTranscriptBatch[];
  readonly observedAt: string | undefined;
  readonly complete: boolean;
  readonly failure: string | undefined;
  /** How many batches the pane keeps, raised a page by each earlier read. */
  readonly capacity: number;
}

export const runTranscriptHeldEmpty: RunTranscriptHeld = {
  batches: [],
  observedAt: undefined,
  complete: false,
  failure: undefined,
  capacity: runTranscriptCapacityBatches,
};

/** The batch a read resumes after, which is zero when the pane holds none. */
export function runTranscriptHighestBatch(held: RunTranscriptHeld): number {
  return held.batches.reduce(
    (highest, batch) => Math.max(highest, batch.batch),
    0,
  );
}

/** How many batches the run wrote below the lowest one held. */
export function runTranscriptBatchesBefore(held: RunTranscriptHeld): number {
  const lowest = held.batches[0]?.batch;
  return lowest === undefined ? 0 : lowest - 1;
}

/**
 * The cursor the next read asks after, and nothing at all when the run has
 * written no batch above the one this pane already holds. A pane holding none
 * asks for the newest it keeps, so a long run opens where it is now.
 */
export function runTranscriptNextAfter(
  held: RunTranscriptHeld,
  highWaterBatch: number,
): number | undefined {
  const highest = runTranscriptHighestBatch(held);
  if (highWaterBatch <= highest) return undefined;
  return held.batches.length === 0
    ? Math.max(highWaterBatch - held.capacity, 0)
    : highest;
}

/** Ascending by batch, each number once, and the oldest dropped past the
 * pane's capacity. */
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
  return {
    batches: ordered.slice(-held.capacity),
    observedAt: page.observedAt,
    complete: page.complete,
    failure: undefined,
    capacity: held.capacity,
  };
}

/** An earlier page raises the capacity by what it carries, so the batches a
 * reader asked for are not the ones the merge then drops. */
export function runTranscriptEarlierMerged(
  held: RunTranscriptHeld,
  page: RunTranscriptResponse,
): RunTranscriptHeld {
  const capacity = Math.min(
    held.capacity + runTranscriptPageBatchesMax,
    runTranscriptCapacityBatchesMax,
  );
  return runTranscriptMerged({ ...held, capacity }, page);
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

/** The batches below the held window, and the cursor the read of the page
 * just beneath it asks after. */
export interface RunTranscriptEarlier {
  readonly batches: number;
  readonly after: number;
}

/** The items a pane draws, how many earlier lines and batches it is not
 * drawing, and the earlier read a reader may still ask for. */
export interface RunTranscriptReading {
  readonly items: readonly ConversationItem[];
  readonly stepsBefore: number;
  readonly batchesBefore: number;
  readonly earlier: RunTranscriptEarlier | undefined;
}

interface RunTranscriptLine {
  readonly batch: number;
  readonly recordedAt: string;
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
  const at = { batch: batch.batch, recordedAt: batch.recordedAt };
  const drawn =
    batch.read === "Content"
      ? batch.content.split("\n").filter((line) => line.trim().length > 0)
      : [];
  return drawn.length === 0
    ? [{ ...at, read: batch.read, line: undefined }]
    : drawn.map((line) => ({ ...at, read: batch.read, line }));
}

/** One held line as its items, each entry dated by the batch it was recorded
 * in, or the gap marker naming the batch a line was never recorded for. */
function runTranscriptLineItems(
  ordinal: number,
  held: RunTranscriptLine,
): readonly ConversationItem[] {
  if (held.line === undefined)
    return [
      {
        item: "Marker",
        marker: {
          marker: "Capped",
          sentence: runTranscriptGapSentence(held.batch, held.read),
        },
      },
    ];
  return runTranscriptStep(ordinal, held.line).map((item) =>
    item.item === "Entry"
      ? { ...item, entry: { ...item.entry, at: held.recordedAt } }
      : item,
  );
}

/** An earlier read is offered while batches lie below the window, the pane
 * may still hold more, and the drawn window has room for what it would add. */
function runTranscriptEarlierOf(
  held: RunTranscriptHeld,
  batchesBefore: number,
  stepsBefore: number,
): RunTranscriptEarlier | undefined {
  if (batchesBefore === 0 || stepsBefore > 0) return undefined;
  if (held.capacity >= runTranscriptCapacityBatchesMax) return undefined;
  return {
    batches: batchesBefore,
    after: Math.max(batchesBefore - runTranscriptPageBatchesMax, 0),
  };
}

/**
 * Every held batch's lines as conversation items, windowed from the end. What
 * the window cut, and the batches below it no earlier read can bring in, are
 * named ahead of what remains, so a pane short of either says so rather than
 * drawing a transcript that looks whole.
 */
export function runTranscriptRead(
  held: RunTranscriptHeld,
): RunTranscriptReading {
  const lines = held.batches.flatMap(runTranscriptLines);
  const from = Math.max(lines.length - runTranscriptStepsMax, 0);
  const batchesBefore = runTranscriptBatchesBefore(held);
  const earlier = runTranscriptEarlierOf(held, batchesBefore, from);
  const leading: ConversationItem[] = [];
  if (from > 0)
    leading.push({
      item: "Marker",
      marker: { marker: "Dropped", count: from },
    });
  if (batchesBefore > 0 && earlier === undefined)
    leading.push({
      item: "Marker",
      marker: {
        marker: "Capped",
        sentence: "Earlier conversation not held",
      },
    });
  const items = lines
    .slice(from)
    .flatMap((line, at) => runTranscriptLineItems(from + at + 1, line));
  return {
    items: [...leading, ...items],
    stepsBefore: from,
    batchesBefore,
    earlier,
  };
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
