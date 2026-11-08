/**
 * A session's Context panel — the lead's, a project thread's or a member's
 * own — from the readings its turns carried, what it was opened under, and the
 * transcript the page already walks.
 *
 * GROWTH IS READ PER TURN. A turn's last reading is the context it ended on;
 * where the session has no readings yet, each turn of its transcript is the
 * context its last assistant entry was billed for, from that entry's usage.
 *
 * A COMPACTION IS THE TRANSCRIPT'S. The store names every cut with what the
 * window held before and after it, so those are the marks, placed at the turn
 * they fell in; a reading's own compaction facts stand only where the
 * transcript held none.
 */

import { sessionContextPageTurnsMax } from "../../../../src/contract/http.ts";
import type {
  RunContextWindow,
  SessionContextResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiResult } from "./apiRequest.ts";
import type {
  ContextCompactionMark,
  ContextGrowthView,
  ContextPoint,
  ContextWindowView,
} from "./contextView.ts";
import { conversationAskMessage } from "./conversation.ts";
import { contextNumber, contextRecord } from "./contextRecord.ts";
import { contextWindowRead, contextWindowUnread } from "./contextView.ts";
import type {
  LeadTranscriptCut,
  LeadTranscriptEntry,
} from "./leadTranscript.ts";

export type SessionContextTurn = SessionContextResponse["turns"][number];

/** The newest turns a panel reads the readings of. */
export const contextSessionTurnsMax = 64;

/** The most pages one read of a session's readings walks: the first, which
 * carries what the session was opened under, and those reaching the newest. */
const contextSessionPagesMax =
  Math.ceil(contextSessionTurnsMax / sessionContextPageTurnsMax) + 2;

/**
 * The first page, for what the session was opened under, then the pages from
 * the newest turns the panel draws to the end, within the bound. The first read
 * the server refuses is the answer instead.
 */
export async function contextSessionPaged(
  read: (after: number) => Promise<ApiResult<SessionContextResponse>>,
  newest: number,
): Promise<ApiResult<SessionContextResponse>> {
  const first = await read(0);
  if (first.outcome !== "Ok") return first;
  const turns = [...first.value.turns];
  let after = first.value.nextAfter;
  for (
    let page = 1;
    page < contextSessionPagesMax && after !== undefined;
    page += 1
  ) {
    const from = Math.max(after, newest - contextSessionTurnsMax);
    const answered = await read(from);
    if (answered.outcome !== "Ok") return answered;
    turns.push(...answered.value.turns.filter((turn) => turn.ordinal > from));
    after = answered.value.nextAfter;
  }
  const { systemPrompt, autoCompactWindow } = first.value;
  return {
    outcome: "Ok",
    value: {
      turns: turns.slice(-contextSessionTurnsMax),
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
      ...(autoCompactWindow === undefined ? {} : { autoCompactWindow }),
    },
  };
}

/** A turn's last reading that held a window, which is the context it ended on. */
function contextTurnWindow(
  turn: SessionContextTurn,
): RunContextWindow | undefined {
  return turn.readings.findLast((reading) => reading.window !== undefined)
    ?.window;
}

/** Each turn of a transcript, as the context its last billed entry was sent. */
interface ContextTranscriptTurn {
  readonly ordinal: number;
  readonly tokens: number | undefined;
  readonly entries: readonly string[];
}

/** Whether a user entry is a prompt someone sent, rather than a tool's answer. */
function contextEntryAsks(entry: LeadTranscriptEntry): boolean {
  if (entry.type !== "user") return false;
  const content = contextRecord(entry.message)?.["content"];
  if (typeof content === "string") return true;
  return (
    Array.isArray(content) &&
    content.some((block) => contextRecord(block)?.["type"] === "text")
  );
}

/** The context an assistant entry was billed as sending, where it carries usage. */
export function contextEntryTokens(
  entry: LeadTranscriptEntry,
): number | undefined {
  if (entry.type !== "assistant") return undefined;
  const usage = contextRecord(contextRecord(entry.message)?.["usage"]);
  if (usage === undefined) return undefined;
  return (
    contextNumber(usage["input_tokens"]) +
    contextNumber(usage["cache_read_input_tokens"]) +
    contextNumber(usage["cache_creation_input_tokens"])
  );
}

/** A transcript cut into turns at each prompt someone sent. */
export function contextTranscriptTurns(
  entries: readonly LeadTranscriptEntry[],
): readonly ContextTranscriptTurn[] {
  const turns: {
    ordinal: number;
    tokens: number | undefined;
    entries: string[];
  }[] = [];
  for (const entry of entries) {
    if (contextEntryAsks(entry) || turns.length === 0)
      turns.push({ ordinal: turns.length + 1, tokens: undefined, entries: [] });
    const turn = turns.at(-1);
    if (turn === undefined) continue;
    if (entry.uuid !== undefined) turn.entries.push(entry.uuid);
    turn.tokens = contextEntryTokens(entry) ?? turn.tokens;
  }
  return turns;
}

/** What one session's panel is drawn from. */
export interface ContextSessionRead {
  readonly context: SessionContextResponse | undefined;
  readonly entries: readonly LeadTranscriptEntry[];
  readonly cuts: readonly LeadTranscriptCut[];
}

/** Each cut the transcript named with its sizes, at the turn whose readings
 * were taken at or after it. */
function contextCutsByReadings(
  cuts: readonly LeadTranscriptCut[],
  turns: readonly SessionContextTurn[],
): readonly ContextCompactionMark[] {
  return cuts.flatMap((cut) => {
    if (cut.tokensBefore === undefined || cut.at === undefined) return [];
    const at = Date.parse(cut.at);
    const turn = turns.find((each) =>
      each.readings.some((reading) => Date.parse(reading.recordedAt) >= at),
    );
    return turn === undefined
      ? []
      : [
          {
            ordinal: turn.ordinal,
            before: cut.tokensBefore,
            after: cut.tokensAfter,
          },
        ];
  });
}

/** Each cut the transcript named with its sizes, at the turn it fell in. */
function contextCutsByTranscript(
  cuts: readonly LeadTranscriptCut[],
  turns: readonly ContextTranscriptTurn[],
): readonly ContextCompactionMark[] {
  return cuts.flatMap((cut) => {
    if (cut.tokensBefore === undefined) return [];
    const turn = turns.find((each) => each.entries.includes(cut.boundary));
    return turn === undefined
      ? []
      : [
          {
            ordinal: turn.ordinal,
            before: cut.tokensBefore,
            after: cut.tokensAfter,
          },
        ];
  });
}

/** The compactions a session's readings recorded themselves. */
function contextCutsReadings(
  turns: readonly SessionContextTurn[],
): readonly ContextCompactionMark[] {
  return turns.flatMap((turn) =>
    turn.readings.flatMap((reading) =>
      reading.cause === "Compaction" && reading.compaction !== undefined
        ? [
            {
              ordinal: turn.ordinal,
              before: reading.compaction.tokensBefore,
              after: reading.compaction.tokensAfter,
            },
          ]
        : [],
    ),
  );
}

/** What a session's panel draws of its window and its growth. */
export interface ContextSessionView {
  readonly window: ContextWindowView;
  readonly growth: ContextGrowthView;
}

function contextSessionRead(
  read: ContextSessionRead,
  turns: readonly SessionContextTurn[],
): ContextSessionView {
  const points = turns.flatMap((turn): ContextPoint[] => {
    const window = contextTurnWindow(turn);
    return window === undefined
      ? []
      : [{ ordinal: turn.ordinal, tokens: window.totalTokens, series: "Main" }];
  });
  const latest = turns.findLast(
    (turn) => contextTurnWindow(turn) !== undefined,
  );
  const latestWindow =
    latest === undefined ? undefined : contextTurnWindow(latest);
  const window =
    latest === undefined || latestWindow === undefined
      ? contextWindowUnread(
          "Turn",
          undefined,
          0,
          read.context?.autoCompactWindow,
        )
      : contextWindowRead("Turn", latest.ordinal, latestWindow);
  const transcribed = contextCutsByReadings(read.cuts, turns);
  return {
    window,
    growth: {
      unit: "Turn",
      points,
      compactions:
        transcribed.length > 0 ? transcribed : contextCutsReadings(turns),
      threshold: window.threshold,
      window: window.window,
      count: Math.max(0, ...turns.map((turn) => turn.ordinal)),
    },
  };
}

function contextSessionTranscribed(
  read: ContextSessionRead,
): ContextSessionView {
  const turns = contextTranscriptTurns(read.entries);
  const points = turns.flatMap((turn): ContextPoint[] =>
    turn.tokens === undefined
      ? []
      : [{ ordinal: turn.ordinal, tokens: turn.tokens, series: "Main" }],
  );
  const last = points.at(-1);
  const window = contextWindowUnread(
    "Turn",
    last?.ordinal,
    last?.tokens ?? 0,
    read.context?.autoCompactWindow,
  );
  return {
    window,
    growth: {
      unit: "Turn",
      points,
      compactions: contextCutsByTranscript(read.cuts, turns),
      threshold: undefined,
      window: window.window,
      count: turns.length,
    },
  };
}

/** A session's window and growth: from its readings where its turns carried
 * any, and otherwise from the usage its transcript's entries were billed. */
export function contextSessionOf(read: ContextSessionRead): ContextSessionView {
  const turns = read.context?.turns ?? [];
  return turns.some((turn) => contextTurnWindow(turn) !== undefined)
    ? contextSessionRead(read, turns)
    : contextSessionTranscribed(read);
}

/** What a session's Inputs list: the block a thread's first message was seeded
 * with, the text appended to the runtime's prompt, and the window, each where
 * there is one. */
export interface ContextSessionInputs {
  readonly seed: string | undefined;
  readonly prompt: string | undefined;
  readonly window: number | undefined;
}

export function contextSessionInputsOf(
  context: SessionContextResponse | undefined,
  seed: string | undefined,
  window: ContextWindowView,
): ContextSessionInputs {
  return {
    seed,
    prompt: context?.systemPrompt,
    window: window.window ?? context?.autoCompactWindow,
  };
}

/** What names how far a session has got: its newest turn and where it stands. */
export interface SessionContextMark {
  readonly newest: number;
  readonly mark: string;
}

/** What names how far a session has got, from the turns its own read listed:
 * its newest turn, and the state that turn is in. */
export function contextSessionMarkOf(
  turns: readonly { readonly ordinal: number; readonly state: string }[],
): SessionContextMark {
  const newest = turns.reduce<
    { readonly ordinal: number; readonly state: string } | undefined
  >(
    (held, turn) =>
      held === undefined || turn.ordinal > held.ordinal ? turn : held,
    undefined,
  );
  return newest === undefined
    ? { newest: 0, mark: "0" }
    : {
        newest: newest.ordinal,
        mark: `${String(newest.ordinal)}-${newest.state}`,
      };
}

/** The block a thread's first message was seeded with, where its tail still
 * lists that turn and the message carried one. */
export function contextThreadSeedOf(
  turns: readonly {
    readonly ordinal: number;
    readonly inputKind: string;
    readonly input: string;
  }[],
): string | undefined {
  const first = turns.find((turn) => turn.ordinal === 1);
  if (first?.inputKind !== "UserMessage") return undefined;
  const asked = conversationAskMessage(first.input);
  return asked.ask === "Message" ? asked.context : undefined;
}
