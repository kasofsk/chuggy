/**
 * What the ticket page's Now card says about the run going now: the attempt it
 * follows, the newest thing the agent said, the call it is waiting on, and the
 * notes before it, each dated by the batch it was recorded in.
 *
 * It reads the items the transcript pane already parsed, so the card and the
 * conversation under it cannot disagree about what the run wrote.
 */

import type {
  ExecutionResponse,
  ExecutionSummary,
} from "../../../../src/contract/responses.ts";
import type {
  ConversationArgument,
  ConversationBlock,
} from "./conversation.ts";
import { conversationArgumentSummary } from "./conversation.ts";
import { durationFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";
import type { RunTranscriptReading } from "./runTranscript.ts";
import { runCountLabel } from "./runTotals.ts";

export type RunNowAttempt = ExecutionResponse["attempts"][number];

/** The most notes the card lists under the newest one. */
export const runNowEarlierNotesMax = 4;

/** One thing the agent said, as the one line the card draws it in. */
export interface RunNowNote {
  readonly text: string;
  readonly at: string | undefined;
}

/** A call the agent made that no result has answered yet. */
export interface RunNowCall {
  readonly name: string;
  readonly argument: ConversationArgument;
  readonly at: string | undefined;
}

export interface RunNow {
  readonly note: RunNowNote | undefined;
  readonly call: RunNowCall | undefined;
  /** Newest first. */
  readonly earlier: readonly RunNowNote[];
  /** Every note the run has written, where the held window is the whole run. */
  readonly notes: number | undefined;
}

export function runNowAttemptLive(attempt: RunNowAttempt): boolean {
  return attempt.state === "Placing" || attempt.state === "Running";
}

/** The attempt the card follows: the newest one still live, or the newest. */
export function runNowAttempt(
  execution: ExecutionResponse,
): RunNowAttempt | undefined {
  const byNumber = [...execution.attempts].sort(
    (left, right) => left.number - right.number,
  );
  return byNumber.filter(runNowAttemptLive).at(-1) ?? byNumber.at(-1);
}

/** When the run began: its attempt's own start where the detail is read, and
 * the execution's where it is not. */
export function runNowStartedAt(
  execution: ExecutionSummary,
  attempt: RunNowAttempt | undefined,
): string {
  return (
    attempt?.run?.startedAt ??
    attempt?.openedAt ??
    execution.startedAt ??
    execution.registeredAt
  );
}

/** How long something the card dates has been going: a duration, because
 * the card reads it as the time a call or a stage has taken so far. */
export function runNowElapsedFigure(
  at: string | undefined,
  nowMs: number,
): Figure {
  const atMs = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isFinite(atMs)
    ? durationFigure(nowMs - atMs)
    : { kind: "Absent", why: "No instant" };
}

interface RunNowWalk {
  readonly notes: RunNowNote[];
  readonly calls: Map<string, RunNowCall>;
}

function runNowBlock(
  walk: RunNowWalk,
  block: ConversationBlock,
  assistant: boolean,
  at: string | undefined,
): void {
  switch (block.block) {
    case "Text": {
      const text = block.text.replace(/\s+/gu, " ").trim();
      if (assistant && text.length > 0) walk.notes.push({ text, at });
      return;
    }
    case "ToolUse":
      walk.calls.set(block.id, {
        name: block.name,
        argument: conversationArgumentSummary(block.input),
        at,
      });
      return;
    case "ToolResult":
      walk.calls.delete(block.toolUse);
      return;
    case "Thinking":
    case "Other":
    case "Capped":
      return;
  }
}

/**
 * The card's content over what the pane holds. The call in flight is the
 * newest one no result has answered, and only while the attempt is live: a
 * run that ended mid-call is not still waiting on it.
 */
export function runNowOf(reading: RunTranscriptReading, live: boolean): RunNow {
  const walk: RunNowWalk = { notes: [], calls: new Map() };
  for (const item of reading.items) {
    if (item.item !== "Entry") continue;
    const entry = item.entry;
    for (const block of entry.blocks)
      runNowBlock(walk, block, entry.role === "Assistant", entry.at);
  }
  const newestFirst = [...walk.notes].reverse();
  const whole = reading.batchesBefore === 0 && reading.stepsBefore === 0;
  return {
    note: newestFirst[0],
    call: live ? [...walk.calls.values()].at(-1) : undefined,
    earlier: newestFirst.slice(1, 1 + runNowEarlierNotesMax),
    notes: whole ? walk.notes.length : undefined,
  };
}

function runNowCounted(count: number, noun: string): string {
  return `${runCountLabel(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The run's size under the card: its turns, and its notes where counted. */
export function runNowCountsLine(
  turns: number | undefined,
  notes: number | undefined,
): string | undefined {
  const said = [
    ...(turns === undefined ? [] : [runNowCounted(turns, "turn")]),
    ...(notes === undefined ? [] : [runNowCounted(notes, "note")]),
  ];
  return said.length === 0 ? undefined : said.join(" · ");
}
