/**
 * What a session's context window held, as its pod read it as each turn ended
 * and as the window compacted during one, and what the session was opened
 * under: the prompt appended to the agent runtime's own, and the window at
 * which the runtime compacts where the session names one.
 *
 * A READING IS KEPT WITH THE ANSWER IT CAME WITH, keyed by the session and the
 * turn it was taken in, so a turn the answering attempt does not hold keeps
 * none, and a turn that failed has none to keep.
 *
 * THE PAGE IS BY TURN, not by reading, because the turn is what a reader
 * places a reading against; a turn whose answer carried none is not on it.
 */

import {
  sessionContextPageTurnsMax,
  sessionContextReadingsMax,
  sessionTurnSeriesMax,
} from "../contract/http.ts";
import type {
  SessionContextOffered,
  SessionContextReading,
} from "../contract/responses.ts";
import type { SessionId, SessionTurnId } from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/** One reading as a pod offers it with its turn's answer, before the server dates it. */
export type SessionContextRecord = SessionContextOffered;

/** The same reading as a read returns it, dated by the server that stored it. */
export type SessionContextResource = SessionContextReading;

/** One turn's readings, in the order its pod took them. */
export interface SessionContextTurn {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly readings: readonly SessionContextResource[];
}

/** One page of a session's readings, resumed after the turn ordinal it names. */
export interface SessionContextQuery {
  readonly after?: number;
  readonly limit: number;
}

/** What a session was opened under, each fact absent where the session has none. */
export interface SessionContextOpening {
  readonly systemPrompt?: string;
  readonly autoCompactWindow?: number;
}

/** A page of turns, and on the first page what the session was opened under. */
export interface SessionContextPage extends SessionContextOpening {
  readonly turns: readonly SessionContextTurn[];
  readonly nextAfter?: number;
}

export type SessionContextRead =
  | { readonly read: "NotFound" }
  | { readonly read: "Page"; readonly page: SessionContextPage };

/**
 * Where one session's readings and opening are read from, SESSION-KEYED as its
 * store rows are, so the lead, a project's thread and a member's chat are one
 * read over the session each resolved.
 */
export interface SessionContextReadStore {
  turns(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly query: SessionContextQuery;
  }): Promise<Pick<SessionContextPage, "turns" | "nextAfter">>;
  opening(
    partition: Partition,
    session: SessionId,
  ): Promise<SessionContextOpening>;
}

/** Refuses a context page query outside the bounds the wire and a session's mailbox declare. */
export function checkedSessionContextQuery(
  query: SessionContextQuery,
): SessionContextQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > sessionContextPageTurnsMax
  )
    throw new RangeError("a context page limit is outside the wire's bound");
  if (
    query.after !== undefined &&
    (!Number.isSafeInteger(query.after) ||
      query.after < 0 ||
      query.after > sessionTurnSeriesMax)
  )
    throw new RangeError("a context cursor is outside the mailbox's bound");
  return query;
}

/**
 * The page one session's store answers, with its opening on the first page
 * alone, held to the bounds the wire declares: a store answering more turns
 * than were asked for, or a turn with no readings or too many, is a store
 * fault rather than a page.
 */
export async function sessionContextPage(
  store: SessionContextReadStore,
  partition: Partition,
  session: SessionId,
  query: SessionContextQuery,
): Promise<SessionContextPage> {
  const checked = checkedSessionContextQuery(query);
  const found = await store.turns({ partition, session, query: checked });
  if (found.turns.length > checked.limit)
    throw new Error("a session context page holds more turns than it asked");
  for (const turn of found.turns)
    if (
      turn.readings.length < 1 ||
      turn.readings.length > sessionContextReadingsMax
    )
      throw new Error("a session context turn holds no readings or too many");
  return {
    ...(checked.after === undefined
      ? await store.opening(partition, session)
      : {}),
    ...found,
  };
}
