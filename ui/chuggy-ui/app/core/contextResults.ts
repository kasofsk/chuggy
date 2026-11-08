/**
 * The Heaviest section of a run's Context view: the calls its context grew
 * into most, and the tools that filled it.
 *
 * THE LARGEST ARE RANKED FROM THE SERIES, which the tab reads whole. A call's
 * growth is how far the context grew into it from the call before it in its
 * own series: the run's own call before it, or the same subagent's, since each
 * subagent's context is its own. The first call of a series grew from nothing
 * ranked, and a growth across a compaction, or one that did not rise, is no
 * result's weight, so none of them is ranked.
 *
 * THE TRANSCRIPT IS WHAT THE PANE HOLDS, which for a long run is its latest
 * batches only, so nothing here reads it as the whole run. It names the tool
 * call whose result a ranked call was the first to read where it holds that
 * call, and a ranked call it does not is drawn with its growth alone. Where no
 * reading weighed the tools, By tool is estimated from it, counting only the
 * results whose tool call it holds, and the section says how many those are
 * and how many it left out.
 *
 * A RESULT IS WEIGHED IN BYTES OF TEXT, which is what the transcript holds. A
 * result that held no text, as an image does not, has no weight here rather
 * than none at all. A tool's share of the context is a reading's tokens where
 * a reading weighed the tool, and otherwise its results' bytes at four to a
 * token against the peak context, and the section says which under its table.
 *
 * A CALL IS FOUND BY ITS FIGURES. A recorded assistant line carries the usage
 * its call was billed with and the subagent call it was made under, and the
 * series folded in `contextRun.ts` is keyed by the same, so the two are joined
 * on them rather than on a count of lines the pane may not hold from the start.
 */

import type { RunContextWindow } from "../../../../src/contract/responses.ts";
import type { ContextCall } from "./contextRun.ts";
import type { ContextCompactionMark, ContextSeries } from "./contextView.ts";
import type { RunTranscriptHeld } from "./runTranscript.ts";
import { runTranscriptBatchesBefore } from "./runTranscript.ts";
import { contextNumber, contextRecord } from "./contextRecord.ts";
import { sharePartFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";

/** Bytes a token is taken to be where nothing weighed it. */
export const contextBytesPerToken = 4;

/** How many of the largest growths the section lists. */
export const contextResultsLargestMax = 5;

/** The most characters of a call's input the list shows of it. */
const contextResultInputCharsMax = 240;

/** How far the context grew into one call from the call before it in its
 * series. */
export interface ContextGrowth {
  readonly call: ContextCall;
  readonly before: ContextCall;
  readonly tokens: number;
}

/** One tool call the held lines asked, and its result where they hold it. */
export interface ContextToolCall {
  readonly id: string;
  readonly tool: string;
  /** What the call was asked, in the words a reader recognises it by. */
  readonly input: string;
  /** The call it was asked in, where the series holds one billed as it was. */
  readonly call: number | undefined;
  /** Its result where the held lines hold it, whose size is none where it
   * held no text. */
  readonly result: { readonly bytes: number | undefined } | undefined;
}

/** What the held lines say of the tool calls asked in them. */
export interface ContextToolCallsHeld {
  readonly asked: readonly ContextToolCall[];
  /** The results held whose tool call is not, which nothing names the tool of. */
  readonly unasked: number;
}

/** One row of the largest: a call, how far the context grew into it, and the
 * tool call whose result it was the first to read, where the pane holds it. */
export interface ContextLargestRow {
  readonly call: number;
  readonly series: ContextSeries;
  readonly growth: number;
  readonly asked: ContextToolCall | undefined;
}

/** What a tool's row is filled to: its share of the context. */
interface ContextToolShare {
  readonly tool: string;
  readonly share: Figure | undefined;
  /** The same share as a fraction, which the row's meter is filled to. */
  readonly fraction: number | undefined;
}

/** A tool as a reading weighed it: its calls' and results' tokens. */
export type ContextToolRead = ContextToolShare & { readonly tokens: number };

/** A tool as the held results weigh it: how many, and their bytes. */
export type ContextToolEstimated = ContextToolShare & {
  readonly results: number;
  readonly bytes: number | undefined;
};

/** By tool, from a reading where one weighed the tools, and otherwise
 * estimated from the results held, with what that estimate counted. */
export type ContextByTool =
  | { readonly from: "Reading"; readonly tools: readonly ContextToolRead[] }
  | {
      readonly from: "Transcript";
      readonly tools: readonly ContextToolEstimated[];
      /** The results the table counts: those held whose tool call is too. */
      readonly results: number;
      readonly unasked: number;
      /** Whether any result counted held no text, and so has no size. */
      readonly unweighed: boolean;
      /** Whether the held batches are the run's latest only. */
      readonly latestOnly: boolean;
    };

/** What the Heaviest section draws. */
export interface ContextHeaviest {
  /** Every call the run made, which the largest are ranked from. */
  readonly calls: number;
  readonly byTool: ContextByTool;
  readonly largest: readonly ContextLargestRow[];
}

/** Every call's growth from the call before it in its own series, leaving out
 * the first of each series, a growth across a compaction of the run's own
 * context, and one that did not rise. */
export function contextGrowthsOf(
  calls: readonly ContextCall[],
  compactions: readonly ContextCompactionMark[],
): readonly ContextGrowth[] {
  const last = new Map<string | undefined, ContextCall>();
  const growths: ContextGrowth[] = [];
  for (const call of calls) {
    const before = last.get(call.parent);
    last.set(call.parent, call);
    if (before === undefined) continue;
    const tokens = call.tokens - before.tokens;
    const compacted =
      call.series === "Main" &&
      compactions.some(
        (mark) => mark.ordinal >= before.call && mark.ordinal < call.call,
      );
    if (tokens > 0 && !compacted) growths.push({ call, before, tokens });
  }
  return growths;
}

/** The growths the section lists: the largest, the earlier call first where
 * two are equal. */
export function contextGrowthLargest(
  growths: readonly ContextGrowth[],
): readonly ContextGrowth[] {
  return [...growths]
    .sort(
      (left, right) =>
        right.tokens - left.tokens || left.call.call - right.call.call,
    )
    .slice(0, contextResultsLargestMax);
}

function contextBlocks(message: unknown): readonly Record<string, unknown>[] {
  const content = contextRecord(message)?.["content"];
  return Array.isArray(content)
    ? content.flatMap((block) => {
        const record = contextRecord(block);
        return record === undefined ? [] : [record];
      })
    : [];
}

/** What a call is joined to a line by: its three figures and its parent. */
function contextCallKey(
  input: number,
  read: number,
  created: number,
  parent: string | undefined,
): string {
  return JSON.stringify([input, read, created, parent ?? null]);
}

/** Each call by the figures it was billed with, the first where two share
 * them. */
function contextCallsKeyed(
  calls: readonly ContextCall[],
): ReadonlyMap<string, number> {
  const keyed = new Map<string, number>();
  for (const call of calls) {
    const key = contextCallKey(
      call.tokensInput,
      call.tokensCacheRead,
      call.tokensCacheCreation,
      call.parent,
    );
    if (!keyed.has(key)) keyed.set(key, call.call);
  }
  return keyed;
}

/** The call an assistant line was billed as, by its figures and its parent. */
function contextCallOfLine(
  event: Record<string, unknown>,
  keyed: ReadonlyMap<string, number>,
): number | undefined {
  const usage = contextRecord(contextRecord(event["message"])?.["usage"]);
  if (usage === undefined) return undefined;
  const parent = event["parent_tool_use_id"];
  return keyed.get(
    contextCallKey(
      contextNumber(usage["input_tokens"]),
      contextNumber(usage["cache_read_input_tokens"]),
      contextNumber(usage["cache_creation_input_tokens"]),
      typeof parent === "string" ? parent : undefined,
    ),
  );
}

/** A call's input in the words a reader knows it by: the command, the path or
 * the pattern, and otherwise the first text it was handed. */
export function contextInputSaid(input: unknown): string {
  const record = contextRecord(input);
  if (record === undefined) return "";
  const named = ["command", "file_path", "path", "pattern", "url", "query"]
    .map((key) => record[key])
    .find((value) => typeof value === "string");
  const said =
    typeof named === "string"
      ? named
      : Object.values(record).find((value) => typeof value === "string");
  return typeof said === "string"
    ? said.replace(/\s+/gu, " ").slice(0, contextResultInputCharsMax)
    : "";
}

const contextEncoder = new TextEncoder();

/** The size of a result's text, and none where its parts held no text, as an
 * image's do not. */
function contextResultBytes(
  block: Record<string, unknown>,
): number | undefined {
  const content = block["content"];
  if (typeof content === "string") return contextEncoder.encode(content).length;
  if (!Array.isArray(content) || content.length === 0) return 0;
  const texts = content.flatMap((part) => {
    const text = contextRecord(part)?.["text"];
    return typeof text === "string" ? [text] : [];
  });
  return texts.length === 0
    ? undefined
    : contextEncoder.encode(texts.join("")).length;
}

/** The sum of the sizes that are known, and none where none is. */
function contextBytesSummed(
  sizes: readonly (number | undefined)[],
): number | undefined {
  return sizes.reduce<number | undefined>(
    (sum, size) => (size === undefined ? sum : (sum ?? 0) + size),
    undefined,
  );
}

/** The tool calls one assistant line asks, each with the call the line was
 * billed as; a block that names no tool asks none. */
function contextToolCallsAsked(
  event: Record<string, unknown>,
  keyed: ReadonlyMap<string, number>,
): readonly ContextToolCall[] {
  const call = contextCallOfLine(event, keyed);
  return contextBlocks(event["message"]).flatMap((block) => {
    const { id, name } = block;
    return block["type"] === "tool_use" &&
      typeof id === "string" &&
      typeof name === "string" &&
      name !== ""
      ? [
          {
            id,
            tool: name,
            input: contextInputSaid(block["input"]),
            call,
            result: undefined,
          },
        ]
      : [];
  });
}

/** Every tool call the held lines asked, in the order they asked them, each
 * with the call it was asked in and its result where those are held; and how
 * many results they hold whose tool call they do not. */
export function contextToolCallsOf(
  lines: readonly unknown[],
  calls: readonly ContextCall[],
): ContextToolCallsHeld {
  const keyed = contextCallsKeyed(calls);
  const asked = new Map<string, ContextToolCall>();
  let unasked = 0;
  for (const line of lines) {
    const event = contextRecord(line);
    if (event?.["type"] === "assistant")
      for (const each of contextToolCallsAsked(event, keyed))
        asked.set(each.id, each);
    if (event?.["type"] !== "user") continue;
    for (const block of contextBlocks(event["message"])) {
      const id = block["tool_use_id"];
      if (block["type"] !== "tool_result" || typeof id !== "string") continue;
      const by = asked.get(id);
      if (by === undefined) unasked += 1;
      else
        asked.set(id, { ...by, result: { bytes: contextResultBytes(block) } });
    }
  }
  return { asked: [...asked.values()], unasked };
}

/** Of the tool calls asked in call `call`, the one whose result is heaviest,
 * and the first where none of their results is held or weighed. */
function contextAskedIn(
  held: ContextToolCallsHeld,
  call: number,
): ContextToolCall | undefined {
  let heaviest: ContextToolCall | undefined = undefined;
  for (const asked of held.asked)
    if (
      asked.call === call &&
      (heaviest === undefined ||
        (asked.result?.bytes ?? -1) > (heaviest.result?.bytes ?? -1))
    )
      heaviest = asked;
  return heaviest;
}

/** The largest growths as the section lists them, each with the tool call
 * whose result its call was the first to read: one asked in the call before
 * it, where the pane holds that. */
export function contextLargestOf(
  largest: readonly ContextGrowth[],
  held: ContextToolCallsHeld,
): readonly ContextLargestRow[] {
  return largest.map((growth) => ({
    call: growth.call.call,
    series: growth.call.series,
    growth: growth.tokens,
    asked: contextAskedIn(held, growth.before.call),
  }));
}

/** Whether the held batches are the run's latest only, with batches before
 * them that the pane does not hold. */
export function contextLinesLatestOnly(held: RunTranscriptHeld): boolean {
  return runTranscriptBatchesBefore(held) > 0;
}

/** Every line the held batches recorded, parsed, with any that is not JSON
 * left out. */
export function contextLinesOf(held: RunTranscriptHeld): readonly unknown[] {
  return held.batches.flatMap((batch) =>
    batch.read === "Content"
      ? batch.content.split("\n").flatMap((line) => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        })
      : [],
  );
}

/** A part's share of `whole`, where there is a whole to have a share of. */
function contextToolShareOf(
  part: number | undefined,
  whole: number | undefined,
): Pick<ContextToolShare, "share" | "fraction"> {
  const fraction =
    part === undefined || whole === undefined || whole <= 0
      ? undefined
      : part / whole;
  return {
    share: fraction === undefined ? undefined : sharePartFigure(fraction),
    fraction,
  };
}

/** The held results whose tool call is held, summed by tool against the peak
 * context at four bytes a token, heaviest first, and after them the tools none
 * of whose results held text, which are not ranked by a weight they were
 * never given. */
function contextToolsEstimated(
  held: ContextToolCallsHeld,
  peak: number | undefined,
  latestOnly: boolean,
): ContextByTool {
  const answered = held.asked.flatMap((asked) =>
    asked.result === undefined ? [] : [{ ...asked, result: asked.result }],
  );
  const byTool = new Map<
    string,
    { results: number; bytes: number | undefined }
  >();
  for (const asked of answered) {
    const summed = byTool.get(asked.tool) ?? { results: 0, bytes: undefined };
    byTool.set(asked.tool, {
      results: summed.results + 1,
      bytes: contextBytesSummed([summed.bytes, asked.result.bytes]),
    });
  }
  const tools = [...byTool.entries()]
    .sort(
      ([, left], [, right]) =>
        (right.bytes ?? -1) - (left.bytes ?? -1) ||
        right.results - left.results,
    )
    .map(([tool, summed]) => ({
      tool,
      ...summed,
      ...contextToolShareOf(
        summed.bytes === undefined
          ? undefined
          : summed.bytes / contextBytesPerToken,
        peak,
      ),
    }));
  return {
    from: "Transcript",
    tools,
    results: answered.length,
    unasked: held.unasked,
    unweighed: answered.some((asked) => asked.result.bytes === undefined),
    latestOnly,
  };
}

/** The tools a reading weighed, each its calls' and results' tokens, heaviest
 * first, against the context it held. */
function contextToolsRead(
  window: RunContextWindow,
): readonly ContextToolRead[] {
  return (window.messages?.byTool ?? [])
    .map((tool) => {
      const tokens = tool.callTokens + tool.resultTokens;
      return {
        tool: tool.name,
        tokens,
        ...contextToolShareOf(tokens, window.totalTokens),
      };
    })
    .sort((left, right) => right.tokens - left.tokens);
}

/** What the Heaviest section is drawn from: the run's whole series and its
 * compactions, the tool calls its pane holds, and the latest reading. */
export interface ContextHeaviestRead {
  readonly calls: readonly ContextCall[];
  readonly compactions: readonly ContextCompactionMark[];
  readonly held: ContextToolCallsHeld;
  readonly latestOnly: boolean;
  readonly window: RunContextWindow | undefined;
  readonly peak: number | undefined;
}

/** What the Heaviest section draws: the largest growths of the whole series,
 * and a reading's tokens by tool where one weighed them, the held results'
 * bytes otherwise. */
export function contextHeaviestOf(read: ContextHeaviestRead): ContextHeaviest {
  const weighed =
    read.window === undefined ? [] : contextToolsRead(read.window);
  return {
    calls: read.calls.length,
    byTool:
      weighed.length > 0
        ? { from: "Reading", tools: weighed }
        : contextToolsEstimated(read.held, read.peak, read.latestOnly),
    largest: contextLargestOf(
      contextGrowthLargest(contextGrowthsOf(read.calls, read.compactions)),
      read.held,
    ),
  };
}
