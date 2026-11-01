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
 * `["tenant", tenant, resource]` is a tenant's own entry, outside
 * `projectPartitionKey` for the same reason `["projects"]` is: a forge account
 * is the tenant's and not any one of its projects', so two projects of one
 * tenant read the same entry rather than each holding a copy a connect on the
 * other leaves stale, and neither a `Project` frame nor the partition's own
 * invalidation reaches it.
 *
 * `["caller", resource]` is the reader's own entry, outside every tenant for
 * the same reason again: which workspaces hold them is a fact about the
 * reader, asked on a page that is in none yet.
 *
 * NOT EVERY ENTRY IS A READ. `projectHeldKey` is what a screen keeps for itself
 * — the cache being the only thing under a partition that outlives the screen
 * that wrote it. Its marker is outside the kinds, so nothing addressed by kind
 * reaches it: neither a frame's write or drop, which name a resource under one,
 * nor a list refresh, which names a list under one. What does reach it is
 * everything addressed by the partition prefix — the reset's invalidation and
 * the fallback's — and that is safe rather than accidental: an invalidation
 * refetches the queries a reader is watching, and a held entry is watched by no
 * reader and has no fetch to run, so being marked stale is the whole of what
 * happens to it. Being under that prefix is what scopes it: one partition's
 * held state is named apart from another's, and a reader who leaves a project
 * leaves what a screen there was holding behind rather than carrying it over.
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
export const tenantQueryScope = "tenant";
export const callerQueryScope = "caller";
export const projectListMarker = "list";

/** Neither a kind nor a list of one, which is what keeps a held entry out of
 * the reach of everything the stream applies. */
export const projectHeldMarker = "held";

export type ProjectQueryKey = readonly unknown[];

export function projectsInventoryKey(): ProjectQueryKey {
  return [projectsQueryScope];
}

/** One tenant's own resource, one entry shared by every project under it. */
export function tenantResourceKey(
  tenant: string,
  resource: string,
): ProjectQueryKey {
  return [tenantQueryScope, tenant, resource];
}

/** The reader's own resource, of no tenant and no project. */
export function callerResourceKey(resource: string): ProjectQueryKey {
  return [callerQueryScope, resource];
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

const projectStreamedTicket = /^[1-9][0-9]*$/u;
const projectStreamedIdentity = /^[^/=]+$/u;

/**
 * The kinds a frame carries a one-resource read's whole body for, under the
 * key that read is held at, or for `Execution` marks that key to be read again,
 * and what the resource is for each: a ticket number, or an identity with
 * nothing under it. A part below one is past a `/` and a
 * view carries a `=`, and no frame names either; nor does a `Project` frame,
 * which invalidates the partition rather than naming what it changed.
 */
export const projectStreamedResources: Readonly<
  Partial<Record<ProjectChangeKind, RegExp>>
> = {
  Ticket: projectStreamedTicket,
  Draft: projectStreamedTicket,
  Configuration: projectStreamedIdentity,
  Operation: projectStreamedIdentity,
  Execution: projectStreamedIdentity,
};

/** Whether a frame names this resource of this kind, and so keeps its key. */
export function projectStreamedNamed(
  kind: ProjectChangeKind,
  resource: string,
): boolean {
  const pattern = projectStreamedResources[kind];
  return (
    pattern !== undefined &&
    resource !== projectListMarker &&
    pattern.test(resource)
  );
}

/** Every held entry of one partition, which is what an option registered for
 * all of them at once is registered against. */
export function projectHeldScope(
  partition: PartitionIdentity,
): ProjectQueryKey {
  return [...projectPartitionKey(partition), projectHeldMarker];
}

/** One partition's own working state, named by the screen that keeps it. */
export function projectHeldKey(
  partition: PartitionIdentity,
  name: string,
): ProjectQueryKey {
  return [...projectHeldScope(partition), name];
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
 * the frame does not, `FoldElseReread` where a frame carries the whole of a
 * row the entry holds but not of one it lacks — none being optional, since an
 * entry with no refresh is the defect this exists to make unwritable.
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
  | { readonly refresh: "Reread" }
  | {
      readonly refresh: "FoldElseReread";
      readonly fold: (
        previous: T | undefined,
        change: ProjectListChange,
      ) => T | undefined;
      /** Whether the frame stales the entry rather than folding into it. */
      readonly rereads: (
        previous: T | undefined,
        change: ProjectListChange,
      ) => boolean;
    }
  | {
      readonly refresh: "RereadNamed";
      readonly names: (
        change: ProjectListChange,
        previous: T | undefined,
      ) => boolean;
    };

/** Held by no literal a caller can write, so a `ProjectList` is one of the
 * constructors' own — though a spread of one is still a value of the type, and
 * what the brand stops is a list assembled rather than one taken apart. */
const projectListWitness: unique symbol = Symbol("projectListWitness");

/** What a frame of a kind other than the list's own folds into its entry. */
export type ProjectListFold<T> = (
  previous: T | undefined,
  change: ProjectListChange,
) => T | undefined;

/** A list entry and the refresh that keeps it live, which are one value. */
export interface ProjectList<T> {
  readonly kind: ProjectChangeKind;
  readonly key: ProjectQueryKey;
  readonly refresh: ProjectListRefresh<T>;
  /** The other kinds whose frames reach the entry, each by its own refresh. */
  readonly alongside: Partial<Record<ProjectChangeKind, ProjectListRefresh<T>>>;
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
    alongside: {},
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

/** `projectListFolded`, except that a frame `rereads` answers for stales the
 * entry and the server is asked again. */
export function projectListFoldedElseReread<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
  fold: (previous: T | undefined, change: ProjectListChange) => T | undefined,
  rereads: (previous: T | undefined, change: ProjectListChange) => boolean,
): ProjectList<T> {
  return projectListOf(partition, kind, name, {
    refresh: "FoldElseReread",
    fold,
    rereads,
  });
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

/**
 * The frames of the kind that name this entry stale it and the rest leave it
 * alone — `Reread`'s narrowing for where the frame's resource IS a fact about
 * the entry rather than a fragment of something derived from more than it, as a
 * `Session` frame names one session and a page draws one, so a project holding
 * several would otherwise re-read every page on every one of them.
 *
 * THE FRAME IS STILL NEVER THE ANSWER: like `Reread`, this stales the entry and
 * the server is asked again, and what the frame supplies is only whether to ask.
 */
export function projectListRereadNamed<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  name: string,
  names: (change: ProjectListChange, previous: T | undefined) => boolean,
): ProjectList<T> {
  return projectListOf(partition, kind, name, {
    refresh: "RereadNamed",
    names,
  });
}

/**
 * The same list, with frames of a further kind folded into its entry too —
 * where a list of one kind's rows carries a fact of another's, as a ticket's
 * row carries its latest execution.
 */
export function projectListAlongside<T>(
  list: ProjectList<T>,
  kind: ProjectChangeKind,
  fold: ProjectListFold<T>,
): ProjectList<T> {
  return projectListAlongsideOf(list, kind, { refresh: "Fold", fold });
}

/**
 * The same list, read again on every frame of a further kind — where a list
 * holds what the server derives from that kind as well as from its own, as the
 * inbox holds a ticket because an action is open on it.
 */
export function projectListAlongsideReread<T>(
  list: ProjectList<T>,
  kind: ProjectChangeKind,
): ProjectList<T> {
  return projectListAlongsideOf(list, kind, { refresh: "Reread" });
}

function projectListAlongsideOf<T>(
  list: ProjectList<T>,
  kind: ProjectChangeKind,
  refresh: ProjectListRefresh<T>,
): ProjectList<T> {
  if (kind === list.kind)
    throw new RangeError(`a list's own kind ${kind} folds by its own refresh`);
  return { ...list, alongside: { ...list.alongside, [kind]: refresh } };
}
