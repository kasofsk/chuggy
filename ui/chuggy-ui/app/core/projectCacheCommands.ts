/**
 * What one stream event does to the cache, decided without touching it.
 *
 * A change frame already carries the representation the kind's GET would have
 * answered with, so the console writes it and never refetches; a null
 * representation is a tombstone and the entry is dropped rather than left
 * stale, and a representation the kind's schema rejects invalidates the
 * partition instead, because a refetch is the honest answer to a frame this
 * console cannot read. The commands are returned rather than performed, which
 * is what lets every case be held against the contract's own events with no
 * cache present.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ProjectChangeKind,
  ProjectStreamEvent,
} from "../../../../src/contract/events.ts";

import { projectPartitionKey, projectResourceKey } from "./projectQueryKeys.ts";
import type { ProjectQueryKey } from "./projectQueryKeys.ts";
import { projectChangeRepresentationParsers } from "./projectRepresentations.ts";

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
  const kind = event.event;
  const key = projectResourceKey(partition, kind, event.data.resource);
  if (event.data.representation === null)
    return [
      { command: "DropResource", key },
      {
        command: "FoldLists",
        kind,
        resource: event.data.resource,
        representation: null,
      },
    ];
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
    {
      command: "FoldLists",
      kind,
      resource: event.data.resource,
      representation,
    },
  ];
}
