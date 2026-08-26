/**
 * The query-key scheme, and the only place in this console a key is built.
 *
 * A key for one resource of one kind is
 * `["project", tenant, project, kind, resource]`, and a key for a list over
 * that kind is `["project", tenant, project, kind, "list", name]`; every key
 * under one partition shares its first three elements, so a `reset` invalidates
 * the partition by prefix and a project switch leaves the other partition's
 * entries where they are. `["projects"]` is the inventory, which belongs to no
 * partition. The `resource` element is what the change frame carries for that
 * kind: a ticket number for `Ticket` and `Draft`, an execution id, an operation
 * id, a configuration revision, and the project's own identity for `Project`.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";

export const projectQueryScope = "project";
export const projectsQueryScope = "projects";
export const projectListMarker = "list";

export type ProjectQueryKey = readonly unknown[];

export function projectsInventoryKey(): ProjectQueryKey {
  return [projectsQueryScope];
}

export function projectPartitionKey(
  partition: PartitionIdentity,
): ProjectQueryKey {
  return [projectQueryScope, partition.tenant, partition.project];
}

export function projectResourceKey(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resource: string,
): ProjectQueryKey {
  return [...projectPartitionKey(partition), kind, resource];
}

export function projectListKey(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
): ProjectQueryKey {
  return [...projectPartitionKey(partition), kind, projectListMarker, name];
}
