/**
 * What one stream event does to the cache, decided without touching it.
 *
 * A change frame carries the representation the kind's GET would have answered
 * with, so the console writes it and never refetches; a null representation is
 * a tombstone and the entry is dropped rather than left stale, and a
 * representation the kind's schema rejects invalidates the partition instead,
 * because a refetch is the honest answer to a frame this console cannot read.
 *
 * `Project` IS THE ONE KIND THAT INVALIDATES RATHER THAN WRITES, and it is the
 * exception because of what its frame carries: the inventory entry, which is
 * the partition's identity and not the project's head. There is nothing in it
 * to write into a project query, so the partition is invalidated and every
 * query under it reads again. Every other kind carries its own GET body and is
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
import { projectChangeRepresentationParsers } from "./projectRepresentations.ts";
import type { ProjectWrittenKind } from "./projectRepresentations.ts";

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

function projectCacheTombstone(
  key: ProjectQueryKey,
  kind: ProjectWrittenKind,
  resource: string,
): readonly ProjectCacheCommand[] {
  return [
    { command: "DropResource", key },
    { command: "FoldLists", kind, resource, representation: null },
  ];
}

export function projectCacheCommands(
  partition: PartitionIdentity,
  event: ProjectStreamEvent,
): readonly ProjectCacheCommand[] {
  if (event.event === "reset") return projectCacheInvalidation(partition);
  if (event.event === "ready" || event.event === "source") return [];
  if (event.event === "Project") return projectCacheInvalidation(partition);
  const kind = event.event;
  const resource = event.data.resource;
  const key = projectResourceKey(partition, kind, resource);
  if (event.data.representation === null)
    return projectCacheTombstone(key, kind, resource);
  let representation: unknown;
  try {
    representation = projectChangeRepresentationParsers[kind](
      event.data.representation,
    );
  } catch {
    return projectCacheInvalidation(partition);
  }
  return [
    { command: "WriteResource", key, representation },
    { command: "FoldLists", kind, resource, representation },
  ];
}
