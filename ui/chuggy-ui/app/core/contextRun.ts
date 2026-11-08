/**
 * A run's Context view, from what the run recorded: its per-turn series
 * folded into calls, its context readings, and the window its snapshot named.
 *
 * ONE CALL IS ONE REQUEST TO THE MODEL, and the series is folded to calls by
 * one rule: consecutive rows naming the same model and the same input,
 * cache-read and cache-creation figures are the same call. Rows written before
 * the worker counted a call once are one per content block of it, and a real
 * next call never repeats those figures, so the rule holds for both.
 *
 * A ROW NAMING A SUBAGENT CALL IS THAT SUBAGENT'S. Its calls are numbered
 * along the same axis as the run's own, since they happened between them, and
 * drawn as a series of their own rather than as the run's context.
 */

import type {
  RunContextReading,
  RunContextResponse,
  RunTurnsResponse,
} from "../../../../src/contract/responses.ts";
import {
  nativeHttpPageItemsMax,
  runContextPageReadingsMax,
  runContextReadingsMax,
  runTurnSeriesMax,
} from "../../../../src/contract/http.ts";
import type { ApiResult } from "./apiRequest.ts";
import type {
  ContextCompactionMark,
  ContextGrowthView,
  ContextPoint,
  ContextSeries,
  ContextTile,
  ContextWindowView,
} from "./contextView.ts";
import {
  contextAtLabel,
  contextCompactionsTile,
  contextPeakOf,
  contextWindowRead,
  contextWindowUnread,
} from "./contextView.ts";
import { groupedDigits, sharePartFigure, tokenCountText } from "./figures.ts";
import type { Figure } from "./figures.ts";

export type RunTurnRow = RunTurnsResponse["turns"][number];

/** One request a run made of its model, folded from the rows that recorded it. */
export interface ContextCall {
  /** Its place among every call the run made, subagents' included, from one. */
  readonly call: number;
  readonly series: ContextSeries;
  readonly model: string;
  readonly tokensInput: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheCreation: number;
  /** The context it was sent: everything it read, from cache or not. */
  readonly tokens: number;
  /** The ordinal of the first and last row recorded for it. */
  readonly rowFirst: number;
  readonly rowLast: number;
}

function contextCallSame(
  row: RunTurnRow,
  call: ContextCall | undefined,
): boolean {
  return (
    call !== undefined &&
    call.series === contextRowSeries(row) &&
    call.model === row.model &&
    call.tokensInput === row.tokensInput &&
    call.tokensCacheRead === row.tokensCacheRead &&
    call.tokensCacheCreation === row.tokensCacheCreation
  );
}

function contextRowSeries(row: RunTurnRow): ContextSeries {
  return row.parentToolUseId === undefined ? "Main" : "Subagent";
}

/** The series folded to calls by the rule above, in the order they were made. */
export function contextCallsOf(
  rows: readonly RunTurnRow[],
): readonly ContextCall[] {
  const ordered = [...rows].sort((left, right) => left.ordinal - right.ordinal);
  const calls: ContextCall[] = [];
  for (const row of ordered) {
    const last = calls.at(-1);
    if (last !== undefined && contextCallSame(row, last)) {
      calls[calls.length - 1] = { ...last, rowLast: row.ordinal };
      continue;
    }
    calls.push({
      call: calls.length + 1,
      series: contextRowSeries(row),
      model: row.model,
      tokensInput: row.tokensInput,
      tokensCacheRead: row.tokensCacheRead,
      tokensCacheCreation: row.tokensCacheCreation,
      tokens: row.tokensInput + row.tokensCacheRead + row.tokensCacheCreation,
      rowFirst: row.ordinal,
      rowLast: row.ordinal,
    });
  }
  return calls;
}

/** The call a reading taken after row `row` was taken at: the one that row
 * belongs to, or the last before it where the row is not in the series held. */
export function contextCallAtRow(
  calls: readonly ContextCall[],
  row: number,
): ContextCall | undefined {
  let at: ContextCall | undefined = undefined;
  for (const call of calls) {
    if (call.rowFirst > row) break;
    at = call;
  }
  return at;
}

/** The newest reading that holds a window, which is what the Window section draws. */
export function contextReadingLatest(readings: readonly RunContextReading[]):
  | (RunContextReading & {
      readonly window: NonNullable<RunContextReading["window"]>;
    })
  | undefined {
  let latest: ReturnType<typeof contextReadingLatest> = undefined;
  for (const reading of readings)
    if (
      reading.window !== undefined &&
      (latest === undefined || reading.ordinal > latest.ordinal)
    )
      latest = { ...reading, window: reading.window };
  return latest;
}

/** Each compaction a reading recorded, at the call it followed. */
export function contextRunCompactions(
  calls: readonly ContextCall[],
  readings: readonly RunContextReading[],
): readonly ContextCompactionMark[] {
  return [...readings]
    .sort((left, right) => left.ordinal - right.ordinal)
    .flatMap((reading) => {
      if (reading.cause !== "Compaction" || reading.compaction === undefined)
        return [];
      const call = contextCallAtRow(calls, reading.afterTurn);
      return [
        {
          ordinal: call?.call ?? 1,
          before: reading.compaction.tokensBefore,
          after: reading.compaction.tokensAfter,
        },
      ];
    });
}

/** The window a run's newest reading held, or, with none, the context its last
 * call was sent against the window its snapshot named. */
export function contextRunWindow(
  calls: readonly ContextCall[],
  readings: readonly RunContextReading[],
  windowNamed: number | undefined,
): ContextWindowView {
  const latest = contextReadingLatest(readings);
  if (latest !== undefined)
    return contextWindowRead(
      "Call",
      contextCallAtRow(calls, latest.afterTurn)?.call,
      latest.window,
    );
  const last = calls.filter((call) => call.series === "Main").at(-1);
  return contextWindowUnread(
    "Call",
    last?.call,
    last?.tokens ?? 0,
    windowNamed,
  );
}

/** How a run's context grew, call by call. */
export function contextRunGrowth(
  calls: readonly ContextCall[],
  readings: readonly RunContextReading[],
  window: ContextWindowView,
): ContextGrowthView {
  return {
    unit: "Call",
    points: calls.map((call): ContextPoint => ({
      ordinal: call.call,
      tokens: call.tokens,
      series: call.series,
    })),
    compactions: contextRunCompactions(calls, readings),
    threshold: window.threshold,
    window: window.window,
    count: calls.length,
  };
}

/** What the run read from cache, and that as a share of everything it read. */
export function contextCacheRead(calls: readonly ContextCall[]): {
  readonly tokens: number;
  readonly share: Figure | undefined;
} {
  const read = calls.reduce((sum, call) => sum + call.tokensCacheRead, 0);
  const sent = calls.reduce((sum, call) => sum + call.tokens, 0);
  return {
    tokens: read,
    share: sent > 0 ? sharePartFigure(read / sent) : undefined,
  };
}

/** The Peak and Calls tiles a run's growth is summed in. */
export function contextRunTiles(
  calls: readonly ContextCall[],
  growth: ContextGrowthView,
): readonly ContextTile[] {
  const peak = contextPeakOf(growth.points);
  const subagent = calls.filter((call) => call.series === "Subagent").length;
  const cache = contextCacheRead(calls);
  return [
    {
      name: { id: "context-peak" },
      value:
        peak === undefined
          ? { id: "context-none" }
          : groupedDigits(peak.tokens),
      note:
        peak === undefined ? undefined : contextAtLabel("Call", peak.ordinal),
    },
    {
      name: { id: "context-calls" },
      value: groupedDigits(calls.length),
      note:
        subagent === 0
          ? { id: "context-subagents-none" }
          : {
              id: "context-subagent-calls",
              args: { count: groupedDigits(subagent) },
            },
    },
    contextCompactionsTile(growth),
    {
      name: { id: "context-cache-read" },
      value: tokenCountText(cache.tokens),
      note:
        cache.share === undefined
          ? undefined
          : {
              id: "context-cache-share",
              args: {
                share: cache.share.kind === "Quantity" ? cache.share.text : "",
              },
            },
    },
  ];
}

/** The rows one page of a run's series is asked for: the most a page answers. */
export const contextRunTurnsPageRows = nativeHttpPageItemsMax;
/** The most pages of a run's series one read walks: the whole series, at
 * `contextRunTurnsPageRows` a page. */
const contextRunTurnsPagesMax =
  Math.ceil(runTurnSeriesMax / contextRunTurnsPageRows) + 1;

/** The most readings a page of them answers, and the most pages one read
 * walks. */
export const contextRunReadingsPageRows = runContextPageReadingsMax;
const contextRunReadingsPagesMax =
  Math.ceil(runContextReadingsMax / contextRunReadingsPageRows) + 1;

/** Every row of a run's series, page after page to its end or the bound; the
 * first read the server refuses is the answer instead. */
export async function contextRunTurnsPaged(
  read: (after: number | undefined) => Promise<ApiResult<RunTurnsResponse>>,
): Promise<ApiResult<RunTurnsResponse>> {
  const turns: RunTurnRow[] = [];
  let after: number | undefined = undefined;
  for (let page = 0; page < contextRunTurnsPagesMax; page += 1) {
    const answered = await read(after);
    if (answered.outcome !== "Ok") return answered;
    turns.push(...answered.value.turns);
    after = answered.value.nextAfter;
    if (after === undefined) break;
  }
  return { outcome: "Ok", value: { turns } };
}

/** Every reading a run recorded, page after page to its end or the bound. */
export async function contextRunReadingsPaged(
  read: (after: number | undefined) => Promise<ApiResult<RunContextResponse>>,
): Promise<ApiResult<RunContextResponse>> {
  const readings: RunContextReading[] = [];
  let after: number | undefined = undefined;
  for (let page = 0; page < contextRunReadingsPagesMax; page += 1) {
    const answered = await read(after);
    if (answered.outcome !== "Ok") return answered;
    readings.push(...answered.value.readings);
    after = answered.value.nextAfter;
    if (after === undefined) break;
  }
  return { outcome: "Ok", value: { readings } };
}
