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
 * kind: a ticket number for `Ticket`, `Draft` and `NativeAction`, an execution
 * id, an operation id, a configuration revision, and the project's own identity
 * for `Project`.
 *
 * A resource key and a list key are refreshed by different halves of the
 * stream, which is why only one of them is a bare function here. The stream
 * writes a resource key itself, from the frame that carries that resource; a
 * list key it has not been told about is touched by nothing, and its entry then
 * stands until the reader reloads. So `projectListKey` is private and a list is
 * built by `projectListFolded` or `projectListReread`, which is where its
 * refresh is chosen — what that stops is a list assembled without one, not a
 * list taken apart, a spread of a built one being a value of the type like any
 * other.
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

function projectListKey(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
): ProjectQueryKey {
  return [...projectPartitionKey(partition), kind, projectListMarker, name];
}

/** One resource of the list's kind, as the frame carrying it presents it. */
export interface ProjectListChange {
  readonly resource: string;
  readonly representation: unknown;
}

/**
 * What a frame of the list's kind does to its entry — `Fold` where the frame
 * carries the whole truth about it, `Reread` where the server derives it and
 * the frame does not — neither being optional, since an entry with no refresh
 * is the defect this pair exists to make unwritable.
 *
 * `Reread` NAMES NO RESOURCE AND THE KIND IS THE WHOLE OF ITS FILTER, because a
 * derived entry is derived from more than the resource a frame happens to carry
 * — candidacy is every dependency being Done, the creation context is whichever
 * revision is ready — and narrowing to one resource is what left the dispatch
 * panel waiting on a frame that never arrives.
 */
export type ProjectListRefresh<T> =
  | {
      readonly refresh: "Fold";
      readonly fold: (
        previous: T | undefined,
        change: ProjectListChange,
      ) => T | undefined;
    }
  | { readonly refresh: "Reread" };

/** Held by no literal a caller can write, so a `ProjectList` is one of the
 * constructors' own — though a spread of one is still a value of the type, and
 * what the brand stops is a list assembled rather than one taken apart. */
const projectListWitness: unique symbol = Symbol("projectListWitness");

/** A list entry and the refresh that keeps it live, which are one value. */
export interface ProjectList<T> {
  readonly kind: ProjectChangeKind;
  readonly key: ProjectQueryKey;
  readonly refresh: ProjectListRefresh<T>;
  readonly [projectListWitness]: true;
}

function projectListOf<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
  refresh: ProjectListRefresh<T>,
): ProjectList<T> {
  return {
    kind,
    key: projectListKey(partition, kind, name),
    refresh,
    [projectListWitness]: true,
  };
}

export function projectListFolded<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
  fold: (previous: T | undefined, change: ProjectListChange) => T | undefined,
): ProjectList<T> {
  return projectListOf(partition, kind, name, { refresh: "Fold", fold });
}

/** Every frame of the kind stales the entry, this being for entries no frame
 * carries and none of them therefore settles. */
export function projectListReread<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
): ProjectList<T> {
  return projectListOf(partition, kind, name, { refresh: "Reread" });
}
