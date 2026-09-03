/** Bounded project notifications used to accelerate authoritative reads. */

import { notificationPageLimitMax } from "../contract/http.ts";
import type { NotificationKind } from "../contract/rosters.ts";
import type { Partition } from "./projectStore.ts";

export interface ProjectNotification {
  readonly ordinal: number;
  readonly kind: NotificationKind;
  readonly resource: string;
  readonly projectSequence?: number;
  readonly authoringVersion?: number;
}

export interface NotificationCursor {
  readonly after: number;
  readonly limit: number;
}

/** How many of a project's notifications one page carries, surfaced where every reader of it looks. */
export { notificationPageLimitMax };

export function checkedNotificationCursor(
  cursor: NotificationCursor,
): NotificationCursor {
  if (!Number.isSafeInteger(cursor.after) || cursor.after < 0)
    throw new RangeError(
      "notification cursor must be a non-negative safe integer",
    );
  if (
    !Number.isSafeInteger(cursor.limit) ||
    cursor.limit < 1 ||
    cursor.limit > notificationPageLimitMax
  )
    throw new RangeError(
      `notification limit must be between 1 and ${String(notificationPageLimitMax)}`,
    );
  return cursor;
}

export type NotificationBatch =
  | { readonly result: "Reset"; readonly cursor: number }
  | {
      readonly result: "Events";
      readonly cursor: number;
      readonly events: readonly ProjectNotification[];
    };

export interface NotificationStore {
  read(
    partition: Partition,
    cursor: NotificationCursor,
  ): Promise<NotificationBatch>;
}
