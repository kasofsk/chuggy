/**
 * The lane a session's live events cross between the worker plane, which is
 * handed them, and the API process holding the sockets they are read on:
 * PostgreSQL notifications on one channel, each carrying one event.
 *
 * A notification nobody is listening for is gone, which is all a live event is
 * owed. The channel is named in full on both sides, because a name assembled
 * at run time is one `check-queries` cannot read.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";

import { sessionLiveEventsMax } from "../../contract/http.ts";
import { threadLiveEventDataSchema } from "../../contract/threadLive.ts";
import {
  asSessionId,
  asSessionTurnId,
} from "../../interpreter/agentSession.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import type { SessionLivePublishPort } from "../../interpreter/sessionPlane.ts";
import type {
  ThreadLiveCarried,
  ThreadLiveLane,
} from "../../interpreter/threadLive.ts";
import {
  postgresListener,
  postgresListenerLimitsDefault,
  type PostgresListenerLimits,
} from "./listener.ts";

/** The heaviest payload PostgreSQL carries on a notification, which it refuses one byte past. */
export const sessionLivePayloadBytesMax = 7_999;

/**
 * One event on the channel. `ordinal` is the event's place in its post, and is
 * there because PostgreSQL delivers one of any payloads a transaction sends
 * twice: with it, no two events of one post are the same payload.
 */
const sessionLivePayloadSchema = z.strictObject({
  tenant: z.string(),
  project: z.string(),
  session: z.string(),
  turn: threadLiveEventDataSchema.shape.turn,
  ordinal: z.number().int().nonnegative().lt(sessionLiveEventsMax),
  event: threadLiveEventDataSchema.shape.event,
});

/** What a notification's payload carries, or nothing when it is not one event this lane publishes. */
export function sessionLiveCarried(
  payload: string,
): ThreadLiveCarried | undefined {
  try {
    const read = sessionLivePayloadSchema.parse(JSON.parse(payload));
    return {
      partition: {
        tenant: asTenantId(read.tenant),
        project: asProjectId(read.project),
      },
      session: asSessionId(read.session),
      turn: asSessionTurnId(read.turn),
      event: read.event,
    };
  } catch {
    return undefined;
  }
}

/** What an operator is told of events too heavy for the channel, with how many there have been. */
export interface SessionLivePublishReport {
  dropped(droppedTotal: number): void;
}

/**
 * Publishes one post's events in one statement, in the order they were handed
 * over. An event whose payload the channel cannot carry is left out and
 * counted, and the report hears of the first and then of each doubling, so a
 * session that sends nothing else cannot fill a log.
 */
export function postgresSessionLivePublisher(
  pool: pg.Pool,
  report: SessionLivePublishReport,
): SessionLivePublishPort {
  let droppedTotal = 0;
  const dropped = (): void => {
    droppedTotal += 1;
    if ((droppedTotal & (droppedTotal - 1)) === 0) report.dropped(droppedTotal);
  };
  return {
    publish: async ({ partition, session, turn, events }) => {
      const payloads: string[] = [];
      for (const [ordinal, event] of events.entries()) {
        const payload = JSON.stringify({
          tenant: partition.tenant,
          project: partition.project,
          session,
          turn,
          ordinal,
          event,
        });
        if (Buffer.byteLength(payload, "utf8") > sessionLivePayloadBytesMax)
          dropped();
        else payloads.push(payload);
      }
      if (payloads.length === 0) return "Published";
      try {
        await pool.query<{ notified: string | null }>(
          sql`SELECT pg_notify('chuggy_session_live', listed.payload)::text AS notified
                FROM unnest(${payloads}::text[]) WITH ORDINALITY AS listed(payload, place)
               ORDER BY listed.place`,
        );
        return "Published";
      } catch {
        return "Unavailable";
      }
    },
  };
}

/** The API's own listening connection, each payload read strictly before the hub hears of it. */
export function postgresSessionLiveLane(
  url: string,
  limits: PostgresListenerLimits = postgresListenerLimitsDefault,
): ThreadLiveLane {
  const listener = postgresListener(url, limits, (client) =>
    client.query(sql`LISTEN chuggy_session_live`),
  );
  return {
    open: (watcher) => {
      listener.open({
        connected: () => {
          watcher.sourced("Live");
        },
        lost: () => {
          watcher.sourced("Lost");
        },
        notified: (payload) => {
          const carried = sessionLiveCarried(payload);
          if (carried === undefined) watcher.unread();
          else watcher.heard(carried);
        },
      });
    },
    close: () => listener.close(),
  };
}
