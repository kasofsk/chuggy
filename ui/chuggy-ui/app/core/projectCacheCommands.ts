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
 * written under its resource's key.
 *
 * The commands are returned rather than performed, which is what lets every
 * case be held against the contract's own events with no cache present.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ProjectChangeKind,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";

import { projectPartitionKey, projectResourceKey } from "./projectQueryKeys.ts";
import type { ProjectQueryKey } from "./projectQueryKeys.ts";

export type ProjectRepresentation = unknown;

export type ProjectCacheCommand =
  | {
      readonly command: "WriteResource";
      readonly key: ProjectQueryKey;
      readonly representation: unknown;
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
  if (representation === null) return [{ command: "DropResource", key }, fold];
  return [{ command: "WriteResource", key, representation }, fold];
}
