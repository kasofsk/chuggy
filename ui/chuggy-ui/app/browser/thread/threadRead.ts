/**
 * One thread's read, re-read on the `Session` frames that name it and left
 * alone by the rest.
 *
 * A project holds a session per member beside its lead, so a read that
 * re-answered on every `Session` frame would re-read every thread on every
 * other thread's turn. The frame is a pointer and carries no body, so there is
 * nothing to fold and the read is what answers.
 *
 * A MEMBER'S OWN CHAT HAS NO STREAM. Its threads are kept at their tenant and
 * under no project, so no frame names one and its reads are polled instead.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ChatAbilitiesResponse,
  ChatThreadsResponse,
  ThreadResponse,
} from "../../../../../src/contract/responses.ts";
import {
  apiChatAbilities,
  apiChatThread,
  apiChatThreads,
  apiThread,
} from "../../core/apiRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { leadSessionNamed } from "../../core/leadTranscript.ts";
import { memberChatThreadPolledMs } from "../../core/memberChat.ts";
import {
  projectListRereadNamed,
  tenantResourceKey,
} from "../../core/projectQueryKeys.ts";
import { sessionPlacementPolledMs } from "../../core/sessionRunners.ts";
import { threadWriting } from "../../core/threads.ts";
import { usePanelList, usePanelTenantResource } from "../api.ts";

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

/** One thread of the reader's own chat, which no frame names and so is read
 * again on its own clock: briskly while its newest turn is still being
 * written, and otherwise at the pace a session's standing is. A message sent
 * is read again at once by whoever sent it. */
export function useMemberThread(
  tenant: string,
  session: string,
): PanelState<ThreadResponse> {
  const [writing, setWriting] = useState(false);
  const state = usePanelTenantResource(
    tenant,
    memberChatThreadResource(session),
    (ports) => apiChatThread(ports, tenant, session),
    writing ? memberChatThreadPolledMs : sessionPlacementPolledMs,
  );
  const now = state.state === "Ready" && threadWriting(state.value);
  if (now !== writing) setWriting(now);
  return state;
}

/** The tenant's entry one thread of the reader's own chat is kept under. */
export function memberChatThreadResource(session: string): string {
  return `chat-${threadListName(session)}`;
}

/** The tenant's entry the reader's own chat keeps its listing under. */
export const memberChatThreadsResource = `chat-${threadsListName}`;

/** What the reader may do at their tenant's chat, read as a screen drawing it
 * mounts. */
export function useChatAbilities(
  tenant: string,
): PanelState<ChatAbilitiesResponse> {
  return usePanelTenantResource(tenant, "chat-abilities", (ports) =>
    apiChatAbilities(ports, tenant),
  );
}

/** Reads the reader's own chat again now, its listing and the one thread a
 * change was made to, which no frame will name. */
export async function memberChatReread(
  client: QueryClient,
  tenant: string,
  session: string,
): Promise<void> {
  await Promise.all(
    [memberChatThreadsResource, memberChatThreadResource(session)].map(
      (resource) =>
        client.invalidateQueries({
          queryKey: tenantResourceKey(tenant, resource),
        }),
    ),
  );
}

/** The reader's own threads at their tenant, read again at the pace a
 * session's standing is, and at once where the chat opens one. */
export function useMemberChatThreads(
  tenant: string,
): PanelState<ChatThreadsResponse> {
  return usePanelTenantResource(
    tenant,
    memberChatThreadsResource,
    (ports) => apiChatThreads(ports, tenant),
    sessionPlacementPolledMs,
  );
}
