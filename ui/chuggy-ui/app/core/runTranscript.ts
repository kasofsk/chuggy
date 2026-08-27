/**
 * A run's transcript as a pane holds it: which batches are still missing, how
 * they merge with what is held, and what each recorded line is as a step.
 *
 * The high-water mark rides the `Execution` frame the browser already receives,
 * so the only question here is which batches sit above the highest one held —
 * nothing polls and nothing follows. Every line is drawn, a line this console
 * cannot read is drawn as it stands rather than dropped or thrown on, and a
 * batch whose bytes are gone or fail their digest is a step naming the gap it
 * leaves, in the place the record puts it.
 */

import type { RunTranscriptResponse } from "../../../../src/contract/responses.ts";

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

export type RunTranscriptStep =
  | {
      readonly step: "Assistant";
      readonly ordinal: number;
      readonly type: string;
      readonly text: string;
      readonly tools: readonly string[];
      readonly elided: readonly number[];
    }
  | {
      readonly step: "User";
      readonly ordinal: number;
      readonly type: string;
      readonly toolResults: number;
      readonly elided: readonly number[];
    }
  | {
      readonly step: "Capped";
      readonly ordinal: number;
      readonly type: string;
      readonly sentence: string;
    }
  | {
      readonly step: "Event";
      readonly ordinal: number;
      readonly type: string;
      readonly elided: readonly number[];
    }
  | {
      readonly step: "Unreadable";
      readonly ordinal: number;
      readonly line: string;
    }
  | {
      readonly step: "Unavailable";
      readonly ordinal: number;
      readonly batch: number;
      readonly read: RunTranscriptBatchRead;
      readonly sentence: string;
    };

/** What a payload replaced by its own reference is worth saying about it. */
export function runTranscriptElisionSentence(bytes: number): string {
  return `payload elided (${runCountLabel(bytes)} bytes)`;
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

function contentBlocks(event: Record<string, unknown>): readonly unknown[] {
  const message = event["message"];
  if (message === null || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>)["content"];
  return Array.isArray(content) ? content : [];
}

function blockKind(block: unknown): string | undefined {
  if (block === null || typeof block !== "object") return undefined;
  const type = (block as Record<string, unknown>)["type"];
  return typeof type === "string" ? type : undefined;
}

function assistantText(blocks: readonly unknown[]): string {
  return blocks
    .flatMap((block) => {
      if (blockKind(block) !== "text") return [];
      const text = (block as Record<string, unknown>)["text"];
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function assistantTools(blocks: readonly unknown[]): readonly string[] {
  return blocks.flatMap((block) => {
    if (blockKind(block) !== "tool_use") return [];
    const name = (block as Record<string, unknown>)["name"];
    return typeof name === "string" ? [name] : [];
  });
}

function cappedSentence(type: string, event: Record<string, unknown>): string {
  const batches = event["batches"];
  const turns = event["turns"];
  if (type === transcriptTruncatedType)
    return `the run reached its transcript cap and stopped recording after ${runCountLabel(typeof batches === "number" ? batches : 0)} batches`;
  return `the per-turn series reached its cap and stopped after ${runCountLabel(typeof turns === "number" ? turns : 0)} turns`;
}

/** One recorded line as the step it stands for, whatever it turns out to be. */
export function runTranscriptStep(
  ordinal: number,
  line: string,
): RunTranscriptStep {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { step: "Unreadable", ordinal, line };
  }
  if (parsed === null || typeof parsed !== "object")
    return { step: "Unreadable", ordinal, line };
  const event = parsed as Record<string, unknown>;
  const type = event["type"];
  if (typeof type !== "string") return { step: "Unreadable", ordinal, line };
  if (type === transcriptTruncatedType || type === turnsTruncatedType)
    return {
      step: "Capped",
      ordinal,
      type,
      sentence: cappedSentence(type, event),
    };
  const elided: number[] = [];
  elisionBytes(event, elided, 0);
  const blocks = contentBlocks(event);
  if (type === "assistant")
    return {
      step: "Assistant",
      ordinal,
      type,
      text: assistantText(blocks),
      tools: assistantTools(blocks),
      elided,
    };
  if (type === "user")
    return {
      step: "User",
      ordinal,
      type,
      toolResults: blocks.filter((block) => blockKind(block) === "tool_result")
        .length,
      elided,
    };
  return { step: "Event", ordinal, type, elided };
}

/** The steps a pane draws, and how many earlier ones it is not drawing. */
export interface RunTranscriptReading {
  readonly steps: readonly RunTranscriptStep[];
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

/** Every held batch's lines in order, capped from the end. */
export function runTranscriptRead(
  held: RunTranscriptHeld,
): RunTranscriptReading {
  const lines = held.batches.flatMap(runTranscriptLines);
  const from = Math.max(lines.length - runTranscriptStepsMax, 0);
  return {
    steps: lines.slice(from).map((held, at) => {
      const ordinal = from + at + 1;
      return held.line === undefined
        ? {
            step: "Unavailable" as const,
            ordinal,
            batch: held.batch,
            read: held.read,
            sentence: runTranscriptGapSentence(held.batch, held.read),
          }
        : runTranscriptStep(ordinal, held.line);
    }),
    stepsBefore: from,
  };
}

/**
 * What the pane is short of, when it is short of anything: earlier steps it
 * stopped drawing and earlier batches it stopped holding.
 */
export function runTranscriptCoverageSentence(
  held: RunTranscriptHeld,
  reading: RunTranscriptReading,
): string | undefined {
  const said: string[] = [];
  if (reading.stepsBefore > 0)
    said.push(
      `${runCountLabel(reading.stepsBefore)} earlier steps are not drawn`,
    );
  if (held.batchesDropped > 0)
    said.push(
      `${runCountLabel(held.batchesDropped)} earlier batches are no longer held`,
    );
  return said.length === 0 ? undefined : `${said.join("; ")}.`;
}
