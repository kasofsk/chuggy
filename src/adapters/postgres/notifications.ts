/** PostgreSQL reads over the bounded durable project notification log. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { NotificationKind } from "../../contract/rosters.ts";
import {
  checkedNotificationCursor,
  type NotificationBatch,
  type NotificationStore,
  type ProjectNotification,
} from "../../interpreter/notifications.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";

interface NotificationBoundsRow {
  readonly earliest: string | null;
  readonly latest: string | null;
}

interface NotificationRow {
  readonly ordinal: string;
  readonly kind: string;
  readonly resource: string;
  readonly project_seq: string | null;
  readonly authoring_version: string | null;
}

function notificationKind(value: string): NotificationKind {
  if (
    value === "Operation" ||
    value === "Ticket" ||
    value === "Draft" ||
    value === "Configuration" ||
    value === "Project"
  )
    return value;
  throw new Error(`notification row: unknown kind ${value}`);
}

function optionalCounter(
  value: string | null,
  what: string,
): number | undefined {
  return value === null ? undefined : projectRowCounter(value, what);
}

function notificationOf(row: NotificationRow): ProjectNotification {
  const notification: ProjectNotification = {
    ordinal: projectRowCounter(row.ordinal, "notification ordinal"),
    kind: notificationKind(row.kind),
    resource: row.resource,
  };
  const projectSequence = optionalCounter(
    row.project_seq,
    "notification project sequence",
  );
  const authoringVersion = optionalCounter(
    row.authoring_version,
    "notification authoring version",
  );
  return {
    ...notification,
    ...(projectSequence === undefined ? {} : { projectSequence }),
    ...(authoringVersion === undefined ? {} : { authoringVersion }),
  };
}

async function readNotifications(
  pool: pg.Pool,
  partition: Partition,
  after: number,
  limit: number,
): Promise<NotificationBatch> {
  return postgresTransaction(pool, async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const bounds = await client.query<NotificationBoundsRow>(
      sql`SELECT min(ordinal)::text AS earliest,max(ordinal)::text AS latest
         FROM project_notification
        WHERE tenant=${partition.tenant} AND project=${partition.project}`,
    );
    const earliest = optionalCounter(
      bounds.rows[0]?.earliest ?? null,
      "earliest notification",
    );
    const latest = optionalCounter(
      bounds.rows[0]?.latest ?? null,
      "latest notification",
    );
    if (earliest !== undefined && after < earliest - 1)
      return { result: "Reset", cursor: latest ?? 0 };
    if (after > (latest ?? 0)) return { result: "Reset", cursor: latest ?? 0 };
    const found = await client.query<NotificationRow>(
      sql`SELECT ordinal,kind,resource,project_seq,authoring_version
         FROM project_notification
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND ordinal>${after}
        ORDER BY ordinal LIMIT ${limit}`,
    );
    const events = found.rows.map(notificationOf);
    return {
      result: "Events",
      cursor: events.at(-1)?.ordinal ?? after,
      events,
    };
  });
}

export function postgresNotifications(pool: pg.Pool): NotificationStore {
  return {
    read: (partition, cursor) => {
      const checked = checkedNotificationCursor(cursor);
      return readNotifications(pool, partition, checked.after, checked.limit);
    },
  };
}
