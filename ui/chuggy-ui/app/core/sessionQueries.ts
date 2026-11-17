/**
 * The reads of a project's threads — the listing, one thread, and a thread's
 * usage summed over its mailbox — each a list a `Session` frame stales.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ThreadResponse,
  ThreadsResponse,
} from "../../../../src/contract/responses.ts";
import { apiThread, apiThreads } from "./apiRoutes.ts";
import { consoleListQuery } from "./consoleQuery.ts";
import { sessionChangeSessionNamed } from "./sessionTranscript.ts";
import { threadUsagePaged } from "./threadCommands.ts";
import type { ThreadUsage } from "./threadCommands.ts";
import {
  projectListReread,
  projectListRereadNamed,
} from "./projectQueryKeys.ts";

/** The listing the chat pane reads, read again on every `Session` frame. */
export function threadsQuery(partition: PartitionIdentity) {
  return consoleListQuery(
    projectListReread<ThreadsResponse>(partition, "Session", "threads"),
    (ports) => apiThreads(ports, partition),
  );
}

/** One thread, named by the session it draws so two threads open at once are
 * two entries and not one. */
export function threadQuery(partition: PartitionIdentity, session: string) {
  return consoleListQuery(
    projectListRereadNamed<ThreadResponse>(
      partition,
      "Session",
      `thread-${session}`,
      (change) => sessionChangeSessionNamed(change.resource) === session,
    ),
    (ports) => apiThread(ports, partition, session),
  );
}

/** One thread's turns summed over every page of its mailbox, an entry apart
 * from the thread's own read because it holds every page rather than the
 * newest. */
export function threadUsageQuery(
  partition: PartitionIdentity,
  session: string,
) {
  return consoleListQuery(
    projectListRereadNamed<ThreadUsage>(
      partition,
      "Session",
      `thread-usage-${session}`,
      (change) => sessionChangeSessionNamed(change.resource) === session,
    ),
    (ports) =>
      threadUsagePaged((page) => apiThread(ports, partition, session, page)),
  );
}
