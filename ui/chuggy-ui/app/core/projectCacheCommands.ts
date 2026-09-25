/**
 * What one stream event does to the cache, decided without touching it.
 *
 * The frame arrives already parsed by the kind's own schema — that is
 * `parseProjectStreamEvent`'s job and this module takes its word for it — so
 * every case here is a total function of a typed event. A representation the
 * wire's schema rejects never reaches this module at all: the parse throws in
 * the transport, `projectStreamDrain` ends the connection, and the reopen with
 * its backoff and its open-failure budget is the handling.
 *
 * `Project` IS THE KIND THAT INVALIDATES RATHER THAN WRITES, as the contract's
 * own header says: its representation is the inventory entry, which is less
 * than reading the project returns, so the partition is invalidated and every
 * query under it reads again. Every other kind carries its GET body and is
 * written under its resource's key — `Ticket` through `ticketArrival`, the rule
 * the page's own confirmations are written by too, so the command carries that
 * rule as a function of whatever the key holds when it is applied.
 *
 * The commands are returned rather than performed, which is what lets every
 * case be held against the contract's own events with no cache present.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ProjectChangeEvent,
  ProjectChangeKind,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";

import { projectPartitionKey, projectResourceKey } from "./projectQueryKeys.ts";
import type { ProjectQueryKey } from "./projectQueryKeys.ts";
import { ticketArrival } from "./ticketArrival.ts";

export type ProjectRepresentation = unknown;

/** What an arriving representation does to the one held under its key. */
export type ProjectResourceArrival =
  | { readonly arrival: "Write"; readonly representation: unknown }
  | { readonly arrival: "Keep" }
  | { readonly arrival: "Reread" };

export type ProjectCacheCommand =
  | {
      readonly command: "WriteResource";
      readonly key: ProjectQueryKey;
      readonly representation: unknown;
    }
  | {
      readonly command: "ReviseResource";
      readonly key: ProjectQueryKey;
      readonly revise: (held: unknown) => ProjectResourceArrival;
    }
  | { readonly command: "DropResource"; readonly key: ProjectQueryKey }
  | {
      readonly command: "FoldLists";
      readonly kind: ProjectChangeKind;
      readonly resource: string;
      readonly representation: ProjectRepresentation;
    }
  | { readonly command: "InvalidatePartition"; readonly key: ProjectQueryKey };

function projectCacheInvalidation(
  partition: PartitionIdentity,
): readonly ProjectCacheCommand[] {
  return [
    { command: "InvalidatePartition", key: projectPartitionKey(partition) },
  ];
}

/** Every writer of a ticket's key writes a ticket, which is what lets the held
 * value be taken as one. */
function projectCacheResource(
  key: ProjectQueryKey,
  event: ProjectChangeEvent,
): ProjectCacheCommand {
  if (event.event === "Ticket" && event.data.representation !== null) {
    const ticket = event.data.representation;
    return {
      command: "ReviseResource",
      key,
      revise: (held) =>
        ticketArrival(held as TicketResponse | undefined, {
          carried: "OwnRead",
          ticket,
        }),
    };
  }
  const representation: unknown = event.data.representation;
  return representation === null
    ? { command: "DropResource", key }
    : { command: "WriteResource", key, representation };
}

export function projectCacheCommands(
  partition: PartitionIdentity,
  event: ProjectStreamEvent,
): readonly ProjectCacheCommand[] {
  if (event.event === "reset") return projectCacheInvalidation(partition);
  if (event.event === "ready" || event.event === "source") return [];
  if (event.event === "Project") return projectCacheInvalidation(partition);
  const kind: ProjectChangeKind = event.event;
  const resource = event.data.resource;
  const representation: unknown = event.data.representation;
  const key = projectResourceKey(partition, kind, resource);
  const fold = {
    command: "FoldLists",
    kind,
    resource,
    representation,
  } as const;
  return [projectCacheResource(key, event), fold];
}
