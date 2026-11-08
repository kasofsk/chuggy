/**
 * The tool results that filled a run's context, read from the transcript it
 * recorded: how many each tool returned and how large, the largest of them,
 * and the call each was asked for in.
 *
 * A RESULT IS WEIGHED IN BYTES OF TEXT, which is what the transcript holds. A
 * result that held no text, as an image does not, has no weight here rather
 * than none at all. Its share of the context is a reading's tokens where a
 * reading weighed the tool, and otherwise its bytes at four to a token against
 * the peak context, and the Heaviest section says which under its table.
 *
 * A CALL IS FOUND BY ITS FIGURES. A recorded assistant line carries the usage
 * its call was billed with, and the series folded in `contextRun.ts` is keyed
 * by the same three figures, so the two are joined on them rather than on a
 * count of lines the transcript may not hold from the start.
 */

import type { RunContextWindow } from "../../../../src/contract/responses.ts";
import type { ContextCall } from "./contextRun.ts";
import type { RunTranscriptHeld } from "./runTranscript.ts";
import { contextNumber, contextRecord } from "./contextRecord.ts";
import { sharePartFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";

/** Bytes a token is taken to be where nothing weighed it. */
export const contextBytesPerToken = 4;

/** How many of the largest results the section lists. */
export const contextResultsLargestMax = 5;

/** The most characters of a call's input the list shows of it. */
const contextResultInputCharsMax = 240;

/** One result a tool returned. */
export interface ContextResult {
  readonly id: string;
  readonly tool: string;
  /** What the call was asked, in the words a reader recognises it by. */
  readonly input: string;
  /** The size of its text, and none where it held no text. */
  readonly bytes: number | undefined;
  /** The call it was asked in, where the series holds that call. */
  readonly call: number | undefined;
  /** How far the context moved from that call to the next of its series. */
  readonly growth: number | undefined;
}

/** One tool's results summed. */
export interface ContextToolRow {
  readonly tool: string;
  readonly calls: number | undefined;
  readonly bytes: number | undefined;
  readonly tokens: number | undefined;
  readonly share: Figure | undefined;
  /** The same share as a fraction, which the row's meter is filled to. */
  readonly fraction: number | undefined;
}

/** A result whose text has a size. */
export type ContextResultWeighed = ContextResult & { readonly bytes: number };

/** What the Heaviest section draws. */
export interface ContextHeaviest {
  readonly results: number;
  readonly tools: readonly ContextToolRow[];
  /** Whether the shares are a reading's tokens, or bytes at four to a token. */
  readonly exact: boolean;
  /** Whether any result held no text, and so has no size to weigh. */
  readonly unweighed: boolean;
  readonly largest: readonly ContextResultWeighed[];
}

interface ContextAsked {
  readonly tool: string;
  readonly input: string;
  readonly call: ContextCall | undefined;
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

/** The call an assistant line was billed as, by its three figures. */
function contextCallOfLine(
  event: Record<string, unknown>,
  calls: readonly ContextCall[],
): ContextCall | undefined {
  const usage = contextRecord(contextRecord(event["message"])?.["usage"]);
  if (usage === undefined) return undefined;
  const input = contextNumber(usage["input_tokens"]);
  const read = contextNumber(usage["cache_read_input_tokens"]);
  const created = contextNumber(usage["cache_creation_input_tokens"]);
  return calls.find(
    (call) =>
      call.tokensInput === input &&
      call.tokensCacheRead === read &&
      call.tokensCacheCreation === created,
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

function contextGrowthAfter(
  calls: readonly ContextCall[],
  call: ContextCall | undefined,
): number | undefined {
  if (call === undefined) return undefined;
  const next = calls.find(
    (each) => each.call > call.call && each.series === call.series,
  );
  return next === undefined ? undefined : next.tokens - call.tokens;
}

/** Every tool result a run's recorded lines hold, each with the call it was
 * asked in, in the order they arrived. */
export function contextResultsOf(
  lines: readonly unknown[],
  calls: readonly ContextCall[],
): readonly ContextResult[] {
  const asked = new Map<string, ContextAsked>();
  const results: ContextResult[] = [];
  for (const line of lines) {
    const event = contextRecord(line);
    if (event === undefined) continue;
    if (event["type"] === "assistant") {
      const call = contextCallOfLine(event, calls);
      for (const block of contextBlocks(event["message"]))
        if (block["type"] === "tool_use" && typeof block["id"] === "string")
          asked.set(block["id"], {
            tool: typeof block["name"] === "string" ? block["name"] : "",
            input: contextInputSaid(block["input"]),
            call,
          });
    }
    if (event["type"] !== "user") continue;
    for (const block of contextBlocks(event["message"])) {
      const id = block["tool_use_id"];
      if (block["type"] !== "tool_result" || typeof id !== "string") continue;
      const by = asked.get(id);
      results.push({
        id,
        tool: by?.tool ?? "",
        input: by?.input ?? "",
        bytes: contextResultBytes(block),
        call: by?.call?.call,
        growth: contextGrowthAfter(calls, by?.call),
      });
    }
  }
  return results;
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

/** The results summed by tool against the peak context at four bytes a token,
 * heaviest first, and after them the tools none of whose results held text,
 * which are not ranked by a weight they were never given. */
function contextToolsEstimated(
  results: readonly ContextResult[],
  peak: number | undefined,
): readonly ContextToolRow[] {
  const byTool = new Map<
    string,
    { calls: number; bytes: number | undefined }
  >();
  for (const result of results) {
    const held = byTool.get(result.tool) ?? { calls: 0, bytes: undefined };
    byTool.set(result.tool, {
      calls: held.calls + 1,
      bytes: contextBytesSummed([held.bytes, result.bytes]),
    });
  }
  return [...byTool.entries()]
    .sort(
      ([, left], [, right]) =>
        (right.bytes ?? -1) - (left.bytes ?? -1) || right.calls - left.calls,
    )
    .map(([tool, summed]) => {
      const fraction =
        peak === undefined || peak <= 0 || summed.bytes === undefined
          ? undefined
          : summed.bytes / contextBytesPerToken / peak;
      return {
        tool,
        calls: summed.calls,
        bytes: summed.bytes,
        tokens: undefined,
        share: fraction === undefined ? undefined : sharePartFigure(fraction),
        fraction,
      };
    });
}

/** The tools a reading weighed, heaviest first, against the context it held. */
function contextToolsRead(
  window: RunContextWindow,
  results: readonly ContextResult[],
): readonly ContextToolRow[] {
  const tools = window.messages?.byTool ?? [];
  return [...tools]
    .sort((left, right) => right.resultTokens - left.resultTokens)
    .map((tool) => {
      const own = results.filter((result) => result.tool === tool.name);
      const fraction =
        window.totalTokens > 0
          ? tool.resultTokens / window.totalTokens
          : undefined;
      return {
        tool: tool.name,
        calls: own.length === 0 ? undefined : own.length,
        bytes: contextBytesSummed(own.map((result) => result.bytes)),
        tokens: tool.resultTokens,
        share: fraction === undefined ? undefined : sharePartFigure(fraction),
        fraction,
      };
    });
}

/** What the Heaviest section draws: a reading's tokens by tool where one
 * weighed them, the transcript's bytes otherwise, and its largest results. */
export function contextHeaviestOf(
  results: readonly ContextResult[],
  window: RunContextWindow | undefined,
  peak: number | undefined,
): ContextHeaviest {
  const exact = (window?.messages?.byTool.length ?? 0) > 0;
  const weighed = results.filter(
    (result): result is ContextResultWeighed => result.bytes !== undefined,
  );
  return {
    results: results.length,
    tools:
      exact && window !== undefined
        ? contextToolsRead(window, results)
        : contextToolsEstimated(results, peak),
    exact,
    unweighed: weighed.length < results.length,
    largest: weighed
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, contextResultsLargestMax),
  };
}
