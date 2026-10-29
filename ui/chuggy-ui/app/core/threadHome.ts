/**
 * Where a thread is kept: a project's partition, or its member's own chat at
 * their tenant, which the wire names a session's `scope`.
 *
 * A MEMBER'S OWN THREAD HAS EVERY DOOR A PROJECT'S HAS, at its tenant's chat
 * rather than under a project, and answers each the same way, so the thread
 * surface asks its doors here and is otherwise the same surface wherever the
 * thread is kept.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { threadMessageSchema } from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import {
  apiChatThreadTranscript,
  apiCloseChatThread,
  apiCloseThread,
  apiOpenChatThread,
  apiOpenThread,
  apiRenameChatThread,
  apiRenameThread,
  apiSendChatThreadMessage,
  apiSendThreadMessage,
  apiStopChatThreadTurn,
  apiStopThreadTurn,
  apiThreadTranscript,
} from "./apiRoutes.ts";
import type { LeadTranscriptPage } from "./apiRoutes.ts";
import type { ApiPorts } from "./apiRequest.ts";

export type ThreadHome =
  | { readonly scope: "Project"; readonly partition: PartitionIdentity }
  | { readonly scope: "Member"; readonly tenant: string };

export function threadHomeOf(partition: PartitionIdentity): ThreadHome {
  return { scope: "Project", partition };
}

/** The home as one string, the same while it is the same home, for what an
 * effect depends on. */
export function threadHomeNamed(home: ThreadHome): string {
  return JSON.stringify(
    home.scope === "Project"
      ? [home.scope, home.partition.tenant, home.partition.project]
      : [home.scope, home.tenant],
  );
}

/** The home a `threadHomeNamed` string names. */
export function threadHomeFromNamed(named: string): ThreadHome {
  const [scope, tenant, project] = JSON.parse(named) as readonly string[];
  if (tenant === undefined) throw new TypeError("a thread home names a tenant");
  if (scope === "Member") return { scope, tenant };
  if (scope !== "Project" || project === undefined)
    throw new TypeError("a project's thread home names its project");
  return threadHomeOf({ tenant, project });
}

export function apiThreadTranscriptAt(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
  page: LeadTranscriptPage,
): ReturnType<typeof apiThreadTranscript> {
  return home.scope === "Project"
    ? apiThreadTranscript(ports, home.partition, session, page)
    : apiChatThreadTranscript(ports, home.tenant, session, page);
}

export function apiOpenThreadAt(
  ports: ApiPorts,
  home: ThreadHome,
  key: string,
): ReturnType<typeof apiOpenThread> {
  return home.scope === "Project"
    ? apiOpenThread(ports, home.partition, key)
    : apiOpenChatThread(ports, home.tenant, key);
}

export function apiSendThreadMessageAt(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
  message: z.infer<typeof threadMessageSchema>,
): ReturnType<typeof apiSendThreadMessage> {
  return home.scope === "Project"
    ? apiSendThreadMessage(ports, home.partition, session, message)
    : apiSendChatThreadMessage(ports, home.tenant, session, message);
}

export function apiCloseThreadAt(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
): ReturnType<typeof apiCloseThread> {
  return home.scope === "Project"
    ? apiCloseThread(ports, home.partition, session)
    : apiCloseChatThread(ports, home.tenant, session);
}

export function apiStopThreadTurnAt(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
  turn: string,
): ReturnType<typeof apiStopThreadTurn> {
  return home.scope === "Project"
    ? apiStopThreadTurn(ports, home.partition, session, turn)
    : apiStopChatThreadTurn(ports, home.tenant, session, turn);
}

export function apiRenameThreadAt(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
  title: string,
): ReturnType<typeof apiRenameThread> {
  return home.scope === "Project"
    ? apiRenameThread(ports, home.partition, session, title)
    : apiRenameChatThread(ports, home.tenant, session, title);
}
