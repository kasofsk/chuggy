/**
 * The artifact volume a session's batch rows point at, as the two HTTP suites
 * over a real database both need it.
 *
 * THE ROWS ARE REAL AND THE BYTES ARE NOT. What those suites settle is that the
 * durable row read, the walk and the route agree; the object store behind the
 * rows is a filesystem in a deployment and its own suites are elsewhere, so a
 * map keyed the way the port addresses an object is what a batch resolves
 * through here. A lead's transcript and a thread's read one store through one
 * walk, so they read it through one double as well.
 */

import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { SessionStoreReadPort } from "../../src/interpreter/sessionStore.ts";

/** One store the cases fill and the port reads, keyed as the port addresses an object. */
export interface SessionStoreDouble extends SessionStoreReadPort {
  /** Puts one batch's bytes where the port will find them. */
  put(
    partition: Partition,
    stream: string,
    batch: number,
    content: string,
  ): void;
}

export function sessionStoreDouble(): SessionStoreDouble {
  const held = new Map<string, string>();
  const key = (partition: Partition, stream: string, batch: number): string =>
    [partition.tenant, partition.project, stream, batch].join("/");
  return {
    put: (partition, stream, batch, content) => {
      held.set(key(partition, stream, batch), content);
    },
    readBatch: (object) => {
      const content = held.get(
        key(object.partition, object.stream, object.batch),
      );
      return Promise.resolve(
        content === undefined
          ? ({ read: "NotFound" } as const)
          : ({ read: "Content", content } as const),
      );
    },
  };
}

/**
 * One transcript entry per batch, chained to the one before it, so a stream's
 * batch count is its entry count and the walk has a chain to follow.
 */
export function sessionStoreEntryLine(index: number): string {
  return JSON.stringify({
    type: "user",
    uuid: `entry-${String(index)}`,
    ...(index === 1 ? {} : { parentUuid: `entry-${String(index - 1)}` }),
    message: { role: "user", content: "one" },
  });
}
