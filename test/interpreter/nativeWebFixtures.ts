/**
 * The ports a boundary case is not about. `nativeWeb` takes many, and a suite
 * about one composes every other as the narrowest thing that satisfies its
 * type, so they are written once here: a second copy of the same stub roster is
 * where a port added to the boundary stops being added to the suites that drive
 * it.
 */

import type { AuthoringStore } from "../../src/interpreter/authoring.ts";
import type { NativeReadStore } from "../../src/interpreter/nativeWeb.ts";
import type { NotificationStore } from "../../src/interpreter/notifications.ts";
import type { OperationInbox } from "../../src/interpreter/operationInbox.ts";
import { openExecutionBacklogGuard } from "../../src/interpreter/schedulerContext.ts";

const reads = {
  operation: () => Promise.resolve(undefined),
  project: () => Promise.resolve({ result: "NotFound" as const }),
  ticket: () => Promise.resolve(undefined),
  ticketNativeActions: () => Promise.resolve(undefined),
  nativeActions: () => Promise.resolve({ actions: [] }),
} satisfies NativeReadStore;

const inbox = {
  accept: () => Promise.resolve({ accepted: "InvalidCommand" as const }),
  cancel: () => Promise.resolve({ cancelled: "Unknown" as const }),
  operation: () => Promise.resolve(undefined),
} satisfies OperationInbox;

const notifications = {
  read: () =>
    Promise.resolve({ result: "Events" as const, cursor: 0, events: [] }),
} satisfies NotificationStore;

/**
 * The ports `nativeWeb` requires rather than takes optionally, none of them the
 * subject of any case that spreads this. `AuthoringStore` is asserted rather
 * than stubbed because nothing spreading this reaches it, and a stub of every
 * method would be a roster to keep in step for nothing.
 */
export const unaskedNativeWebPorts = [
  reads,
  inbox,
  {} as AuthoringStore,
  notifications,
  openExecutionBacklogGuard,
] as const;
