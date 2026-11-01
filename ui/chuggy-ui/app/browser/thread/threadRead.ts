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
import type { PanelState } from "../../core/freshness.ts";
import { threadQuery } from "../../core/sessionQueries.ts";
import {
  chatAbilitiesQuery,
  memberChatThreadQuery,
  memberChatThreadsQuery,
} from "../../core/tenantQueries.ts";
import { threadWriting } from "../../core/threads.ts";
import { usePanelState } from "../api.ts";

export function useThread(
  partition: PartitionIdentity,
  session: string,
): PanelState<ThreadResponse> {
  return usePanelState(threadQuery(partition, session));
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
  const state = usePanelState(memberChatThreadQuery(tenant, session, writing));
  const now = state.state === "Ready" && threadWriting(state.value);
  if (now !== writing) setWriting(now);
  return state;
}

/** What the reader may do at their tenant's chat, read as a screen drawing it
 * mounts. */
export function useChatAbilities(
  tenant: string,
): PanelState<ChatAbilitiesResponse> {
  return usePanelState(chatAbilitiesQuery(tenant));
}

/** Reads the reader's own chat again now, its listing and the one thread a
 * change was made to, which no frame will name. */
export async function memberChatReread(
  client: QueryClient,
  tenant: string,
  session: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({
      queryKey: memberChatThreadsQuery(tenant).queryKey,
    }),
    client.invalidateQueries({
      queryKey: memberChatThreadQuery(tenant, session).queryKey,
    }),
  ]);
}

/** The reader's own threads at their tenant, read again at the pace a
 * session's standing is, and at once where the chat opens one. */
export function useMemberChatThreads(
  tenant: string,
): PanelState<ChatThreadsResponse> {
  return usePanelState(memberChatThreadsQuery(tenant));
}
