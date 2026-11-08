/**
 * What a session's context window held across its turns, as the readings its
 * answers carried, and what the session was opened under.
 *
 * THE READ IS KEYED ON THE SESSION AND NOT ON A KIND, as the transcript's rows
 * are: the lead's route and a thread's each resolve their session under their
 * own permission and pass it here, so one page shape answers both.
 *
 * WHAT THE SESSION WAS OPENED UNDER CROSSES ONCE, on the first page. A prompt
 * may weigh as much as the page's readings, and it is the same text on every
 * page, so a reader paging on is not sent it again.
 */

import {
  sessionContextPageTurnsMax,
  sessionTurnContextReadingsMax,
} from "../contract/http.ts";
import type { SessionContextReading } from "../contract/responses.ts";
import type { SessionId, SessionTurnId } from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/** One turn's readings, in the order the turn took them. */
export interface SessionContextTurn {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly readings: readonly SessionContextReading[];
}

/** What a session was opened under, each absent where it holds none. */
export interface SessionContextOpening {
  /** The text the session appends to the agent runtime's own system prompt. */
  readonly systemPrompt?: string;
  /** The context, in tokens, at which the session's runtime compacts, which only a lead holds. */
  readonly autoCompactWindow?: number;
}

/** Where a session's readings and what it was opened under are read from. */
export interface SessionContextRead {
  /** The turns after `after` that carried readings, ascending, at most `limit` of them. */
  turns(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly after: number;
    readonly limit: number;
  }): Promise<readonly SessionContextTurn[]>;
  opening(
    partition: Partition,
    session: SessionId,
  ): Promise<SessionContextOpening>;
}

export interface SessionContextQuery {
  /** The ordinal of the last turn a reader was answered, zero for the first page. */
  readonly after: number;
  readonly limit: number;
}

/** One page of a session's readings, carrying what it was opened under on the first page alone. */
export interface SessionContextPage extends SessionContextOpening {
  readonly turns: readonly SessionContextTurn[];
  readonly nextAfter?: number;
}

export type SessionContextPageRead =
  | { readonly read: "NotFound" }
  | { readonly read: "Page"; readonly page: SessionContextPage };

export function checkedSessionContextQuery(
  query: SessionContextQuery,
): SessionContextQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > sessionContextPageTurnsMax
  )
    throw new RangeError(
      `session context limit must be between 1 and ${String(sessionContextPageTurnsMax)}`,
    );
  if (!Number.isSafeInteger(query.after) || query.after < 0)
    throw new RangeError("session context cursor must be a turn ordinal");
  return query;
}

/** The page `query` asks of one session's readings, with its opening on the first. */
export async function sessionContextPage(
  read: SessionContextRead,
  partition: Partition,
  session: SessionId,
  query: SessionContextQuery,
): Promise<SessionContextPage> {
  const asked = checkedSessionContextQuery(query);
  const turns = await read.turns({ partition, session, ...asked });
  if (turns.length > asked.limit)
    throw new Error("session context: the store answered past the page");
  let previous = asked.after;
  for (const turn of turns) {
    if (turn.ordinal <= previous)
      throw new Error("session context: the store answered turns out of order");
    if (
      turn.readings.length < 1 ||
      turn.readings.length > sessionTurnContextReadingsMax
    )
      throw new Error(
        "session context: a turn answered no reading or too many",
      );
    previous = turn.ordinal;
  }
  const last = turns.at(-1)?.ordinal;
  return {
    ...(asked.after === 0 ? await read.opening(partition, session) : {}),
    turns,
    ...(turns.length < asked.limit || last === undefined
      ? {}
      : { nextAfter: last }),
  };
}
