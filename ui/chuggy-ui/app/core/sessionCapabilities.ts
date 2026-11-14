/**
 * What a session may do, in words: one label for each capability, and a set of
 * them said as one line, which is how a chat host's setting and the
 * capabilities a chat holds on it are both drawn.
 */

import type { SessionCapability } from "../../../../src/contract/rosters.ts";
import type { Copy, CopyText } from "./copy.ts";

export function sessionCapabilityLabel(capability: SessionCapability): Copy {
  switch (capability) {
    case "RepositoryRead":
      return { id: "chat-capability-repository-read" };
    case "RepositoryWrite":
      return { id: "chat-capability-repository-write" };
    case "RunCommands":
      return { id: "chat-capability-run-commands" };
    case "ProjectRead":
      return { id: "chat-capability-project-read" };
    case "DraftAuthor":
      return { id: "chat-capability-draft-author" };
    case "DraftOriginate":
      return { id: "chat-capability-draft-originate" };
    case "TicketDispatch":
      return { id: "chat-capability-ticket-dispatch" };
    case "LeadDecision":
      return { id: "chat-capability-lead-decision" };
    case "MemberRead":
      return { id: "chat-capability-member-read" };
    case "ThreadOffer":
      return { id: "chat-capability-thread-offer" };
  }
}

/** `capabilities` as one line, in the order they are named, and as nothing where they are none. */
export function sessionCapabilitiesSaid(
  text: CopyText,
  capabilities: readonly SessionCapability[],
): string {
  return capabilities.length === 0
    ? text({ id: "chat-capabilities-none" })
    : capabilities
        .map((capability) => text(sessionCapabilityLabel(capability)))
        .join(", ");
}
