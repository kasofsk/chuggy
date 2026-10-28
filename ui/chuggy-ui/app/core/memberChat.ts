/**
 * A member's own chat, derived: whether their tenant lets them open one, the
 * door its turns go through, and its listing parted into their own threads and
 * the ones they hold in projects.
 *
 * ITS TURNS RUN ON THE MEMBER'S CHAT HOST ALONE. The server takes every turn
 * of a member's own chat by the runners' route, so its door is that route and
 * the host's standing, and the hosted grant decides nothing in it.
 *
 * A PROJECT'S THREAD IS LISTED AND NEVER READ HERE. The listing names it and
 * the project that keeps it, and it is read on that project's own thread page
 * by whoever may read the project.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ChatAbilitiesResponse,
  ChatHostResponse,
  ChatThreadEntryResponse,
  ThreadEntryResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../../src/contract/rosters.ts";

import type { PanelState } from "./freshness.ts";
import type { ThreadDoor } from "./threads.ts";

/** The chat's own addresses, outside every project as a workspace's settings
 * are, and for the same reason. */
export const memberChatRoutes = {
  chat: "/tenants/$tenant/chat",
  thread: "/tenants/$tenant/chat/$session",
} as const;

/** What a member is told where their workspace has taken their own chat away. */
export const memberChatWithheld =
  "A workspace admin lets members chat outside a project";

/** What the project switcher names a workspace's own chat. */
export const memberChatProjectNone = "No project";

/**
 * How often a member's own thread is read again. No frame names one, so this
 * is what moves its turns on screen: a message sent is listed, and a turn the
 * live stream is answering is settled, on this clock.
 */
export const memberChatThreadPolledMs = 2_000;

/** Whether the reader may open a chat of their own, which a reader whose
 * abilities were not read may not. */
export function memberChatOpens(
  abilities: ChatAbilitiesResponse | undefined,
): boolean {
  return abilities?.openUnscopedChat ?? false;
}

/** The standing of the chat host the member's turns wait on, once its read
 * has said: none registered, or live or not. */
function memberChatRunner(
  host: PanelState<ChatHostResponse>,
): SessionRunnerStanding | undefined {
  switch (host.state) {
    case "Ready":
      return host.value.live ? "Live" : "Offline";
    case "Absent":
      return "Unregistered";
    case "Pending":
    case "Failed":
      return undefined;
  }
}

/** The door a member's own thread is drawn against: the runners' route, and
 * their chat host as its read stands after `reads` answers. */
export function memberChatDoor(
  host: PanelState<ChatHostResponse>,
  reads: number,
): ThreadDoor {
  return {
    route: "Pool",
    granted: undefined,
    runner: memberChatRunner(host),
    reads,
  };
}

/** One of the member's threads that a project keeps. */
export interface MemberChatProjectThread {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse;
}

export interface MemberChatThreadsParted {
  readonly own: readonly ThreadEntryResponse[];
  readonly projects: readonly MemberChatProjectThread[];
}

/** The listing as the chat draws it: the threads of its own scope, and each
 * project's apart, in the order the listing gave. */
export function memberChatThreadsParted(
  tenant: string,
  threads: readonly ChatThreadEntryResponse[],
): MemberChatThreadsParted {
  const own: ThreadEntryResponse[] = [];
  const projects: MemberChatProjectThread[] = [];
  for (const { scope, project, ...thread } of threads) {
    if (scope === "Member") own.push(thread);
    else if (project !== undefined)
      projects.push({ partition: { tenant, project }, thread });
  }
  return { own, projects };
}
