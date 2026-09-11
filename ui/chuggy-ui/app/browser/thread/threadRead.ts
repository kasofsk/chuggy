/**
 * One thread's read, re-read on the `Session` frames that name it and left
 * alone by the rest.
 *
 * A project holds a session per member beside its lead, so a read that
 * re-answered on every `Session` frame would re-read every thread on every
 * other thread's turn. The frame is a pointer and carries no body, so there is
 * nothing to fold and the read is what answers.
 */

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import { apiThread } from "../../core/apiRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { leadSessionNamed } from "../../core/leadTranscript.ts";
import { projectListRereadNamed } from "../../core/projectQueryKeys.ts";
import { usePanelList } from "../api.ts";

/** The list entry the whole listing keeps, which the chat pane's history reads
 * and every thread read is named apart from. */
export const threadsListName = "threads";

/** The list entry one thread read keeps, named by the session it draws so two
 * threads open at once are two entries and not one. */
export function threadListName(session: string): string {
  return `thread-${session}`;
}

export function useThread(
  partition: PartitionIdentity,
  session: string,
): PanelState<ThreadResponse> {
  return usePanelList(
    projectListRereadNamed<ThreadResponse>(
      partition,
      "Session",
      threadListName(session),
      (change) => leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiThread(ports, partition, session),
  );
}
