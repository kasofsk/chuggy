/**
 * What one stream event does to the cache, decided without touching it.
 *
 * The envelope arrives already parsed — that is `parseProjectStreamEvent`'s job
 * and this module takes its word for it — so every case here is a total
 * function of a typed event. The representation inside it is NOT parsed, by the
 * contract's own decision: the routes this stream names answer bodies they do
 * not themselves parse, so the envelope is all the wire can promise.
 *
 * WHICH IS WHY A CHANGE STALES ITS RESOURCE RATHER THAN WRITING IT. Writing an
 * unparsed body under a key that `usePanelResource` hands back as its own type
 * would install a shape nothing has checked and no compiler can catch; the
 * contract says the representation is parsed where it is stored, and this layer
 * holds no schema and so is not such a place. Staling it costs the round trip
 * the frame could have saved and gets the route's own parsed answer back.
 *
 * A NULL REPRESENTATION IS STILL THE TOMBSTONE, and it needs no schema to be
 * read: the resource is no longer readable, so the entry is dropped rather than
 * left to be refetched into an error a panel draws as a failed read.
 *
 * The representation is passed on to the lists untouched and typed `unknown`,
 * which is the one place a consumer holding that route's own schema receives
 * it. The commands are returned rather than performed, which is what lets every
 * case be held against the contract's own events with no cache present.
 */

import type { ProjectStreamEvent } from "../../../../src/contract/events.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import { projectPartitionKey, projectResourceKey } from "./projectQueryKeys.ts";
import type {
  ProjectQueryKey,
  ProjectResourceKind,
} from "./projectQueryKeys.ts";

export type ProjectCacheCommand =
  | { readonly command: "StaleResource"; readonly key: ProjectQueryKey }
  | { readonly command: "DropResource"; readonly key: ProjectQueryKey }
  | {
      readonly command: "FoldLists";
      readonly kind: ProjectResourceKind;
      readonly resource: string;
      readonly representation: unknown;
    }
  | { readonly command: "InvalidatePartition"; readonly key: ProjectQueryKey };

export function projectCacheCommands(
  partition: PartitionIdentity,
  event: ProjectStreamEvent,
): readonly ProjectCacheCommand[] {
  if (event.event === "reset")
    return [
      { command: "InvalidatePartition", key: projectPartitionKey(partition) },
    ];
  if (event.event === "ready" || event.event === "source") return [];
  const kind: ProjectResourceKind = event.event;
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
  return [{ command: "StaleResource", key }, fold];
}
