/**
 * A console read: one per resource, holding its key, its fetch, the type of
 * what it answers and how it is kept fresh, so that a screen reads a resource
 * by naming it and a sibling invalidates it by the same name.
 *
 * A query holds the resource itself and not a wrapper, so that a live change
 * frame can be written into the same key with `setQueryData`; a failed read
 * therefore arrives as the error, carrying the outcome the contract classified.
 * The key carries the resource's type, so a read or a write of it at another
 * type does not compile.
 *
 * WHAT IS UNWRITABLE IS A LIST ENTRY WITH NO REFRESH, and only that:
 * `consoleListQuery` and `consolePagesQuery` take a `ProjectList`, which
 * cannot be made without one, and are the only builders whose key is a list's.
 *
 * A PAGED LIST IS ONE ENTRY OF PAGES, read a page at a time from where the
 * pages before it say the next begins, and read again from its first page as
 * many pages as it holds. Its rows are derived from its pages.
 *
 * IT PROMISES NOTHING ABOUT A RESOURCE. A resource is named by a string, and a
 * name no frame carries typechecks: the evidence panels read parts under an
 * execution — a run's turns, its configuration, an artifact's body — while the
 * change log names the bare execution id. Those entries are reached by the
 * partition's own refetch and by nothing else, which is the freshness a
 * finished run's evidence needs and is not live.
 *
 * A READ IS KEPT ONLY WHERE ITS CALLER SAYS SO. `Streamed` marks a key a frame
 * writes or rereads, which is not read again on a visit while the stream holds
 * its position, since the frames have kept it; a key `projectStreamedNamed`
 * does not admit is refused when its read is made.
 */

import type { InfiniteData } from "@tanstack/query-core";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  callerResourceKey,
  projectPartitionResourceKey,
  projectResourceKey,
  projectStreamedNamed,
  projectsInventoryKey,
  tenantResourceKey,
} from "./projectQueryKeys.ts";
import type {
  ProjectList,
  ProjectQueryKey,
  ProjectQueryKeyOf,
} from "./projectQueryKeys.ts";

/** Whether a resource read is kept while the stream holds its position, as
 * one a frame writes or rereads is, or read again whenever a screen mounts. */
export type ConsoleQueryKept = "Streamed" | "Read";

/** The fetch, handed what the key holds as it starts, for a read that gathers
 * on top of the entry it is about to replace. */
export type ConsoleRead<T> = (
  ports: ApiPorts,
  signal: AbortSignal,
  held: T | undefined,
) => Promise<ApiResult<T>>;

/** One resource's read. One that moves where no frame says so is read again
 * every `polledMs` while a screen draws it and the tab is in view. */
export interface ConsoleResourceQuery<T> {
  readonly queryKey: ProjectQueryKeyOf<T>;
  readonly read: ConsoleRead<T>;
  readonly kept: ConsoleQueryKept;
  readonly polledMs: number | undefined;
}

/** A list entry's read, whose refresh the list itself carries. */
export interface ConsoleListQuery<T> {
  readonly queryKey: ProjectQueryKeyOf<T>;
  readonly list: ProjectList<T>;
  readonly read: ConsoleRead<T>;
  readonly kept: "Read";
  readonly polledMs: number | undefined;
}

export type ConsoleQuery<T> = ConsoleResourceQuery<T> | ConsoleListQuery<T>;

/** How a paged list is read and drawn: `P` a page, `Param` where one is read
 * from, and `R` the rows the pages draw. */
export interface ConsolePaging<P, Param, R> {
  /** One page, read from `at`. */
  readonly read: (
    ports: ApiPorts,
    signal: AbortSignal,
    at: Param,
  ) => Promise<ApiResult<P>>;
  readonly first: Param;
  /** Where the page after the pages is read, or undefined where none is. */
  readonly next: (pages: InfiniteData<P, Param>) => Param | undefined;
  readonly rows: (pages: InfiniteData<P, Param>) => R;
  /** Whether a reader's press reads on past the page it has just read. */
  readonly readsPast: (pages: InfiniteData<P, Param>) => boolean;
  /** How many pages the list holds at the most, which bounds a press too. */
  readonly pagesMax: number;
}

/** A paged list entry's read, whose refresh the list itself carries. */
export interface ConsolePagesQuery<P, Param, R> extends ConsolePaging<
  P,
  Param,
  R
> {
  readonly queryKey: ProjectQueryKeyOf<InfiniteData<P, Param>>;
  readonly list: ProjectList<InfiniteData<P, Param>>;
  readonly polledMs: number | undefined;
}

/** What asking for the next page came to: the pages held once it was over,
 * and whether the read it ended on failed. */
export interface ConsolePagesAnswer<P, Param> {
  readonly pages: InfiniteData<P, Param> | undefined;
  readonly failed: boolean;
}

/**
 * A reader's press: the next page asked for until one lands that the list does
 * not read past, the list has no next page, or a read fails. An ask that joins
 * a reread already running lands no page, so the next is asked for again over
 * what the reread answered; `pagesMax` asks at the most.
 */
export async function consolePagesMore<P, Param, R>(
  paging: ConsolePaging<P, Param, R>,
  held: number,
  asked: () => Promise<ConsolePagesAnswer<P, Param>>,
): Promise<void> {
  let pagesHeld = held;
  for (let ask = 0; ask < paging.pagesMax; ask += 1) {
    const answered = await asked();
    const pages = answered.pages;
    if (answered.failed || pages === undefined) return;
    const landed = pages.pages.length > pagesHeld;
    pagesHeld = pages.pages.length;
    if (paging.next(pages) === undefined) return;
    if (landed && !paging.readsPast(pages)) return;
  }
}

function consoleResourceQueryOf<T>(
  key: ProjectQueryKey,
  read: ConsoleRead<T>,
  polledMs: number | undefined,
  kept: ConsoleQueryKept = "Read",
): ConsoleResourceQuery<T> {
  return {
    queryKey: key as ProjectQueryKeyOf<T>,
    read,
    kept,
    polledMs,
  };
}

/** One resource of one kind, written by the frame that names it — or a part
 * under one, which no frame names and the partition's refetch reaches. */
export function consoleProjectQuery<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resource: string,
  read: ConsoleRead<T>,
  polledMs?: number,
  kept: ConsoleQueryKept = "Read",
): ConsoleResourceQuery<T> {
  if (kept === "Streamed" && !projectStreamedNamed(kind, resource))
    throw new Error(
      `a ${kind} read of ${resource} is kept, and no frame names it`,
    );
  return consoleResourceQueryOf(
    projectResourceKey(partition, kind, resource),
    read,
    polledMs,
    kept,
  );
}

/** One partition's resource that no frame names, reached by the partition's
 * own refetch and read again every `polledMs` where a caller names one. */
export function consolePartitionQuery<T>(
  partition: PartitionIdentity,
  resource: string,
  read: ConsoleRead<T>,
  polledMs?: number,
): ConsoleResourceQuery<T> {
  return consoleResourceQueryOf(
    projectPartitionResourceKey(partition, resource),
    read,
    polledMs,
  );
}

/** A list entry, read again every `polledMs` as well where a caller names one. */
export function consoleListQuery<T>(
  list: ProjectList<T>,
  read: ConsoleRead<T>,
  polledMs?: number,
): ConsoleListQuery<T> {
  return { queryKey: list.key, list, read, kept: "Read", polledMs };
}

/** A paged list entry, read again every `polledMs` as well where a caller names one. */
export function consolePagesQuery<P, Param, R>(
  list: ProjectList<InfiniteData<P, Param>>,
  paging: ConsolePaging<P, Param, R>,
  polledMs?: number,
): ConsolePagesQuery<P, Param, R> {
  return { ...paging, queryKey: list.key, list, polledMs };
}

/** One tenant's own resource, shared by every project under it and so outside
 * any one partition's refresh path. */
export function consoleTenantQuery<T>(
  tenant: string,
  resource: string,
  read: ConsoleRead<T>,
  polledMs?: number,
): ConsoleResourceQuery<T> {
  return consoleResourceQueryOf(
    tenantResourceKey(tenant, resource),
    read,
    polledMs,
  );
}

/** The reader's own resource, outside every tenant and so every refresh path:
 * read when a screen drawing it mounts. */
export function consoleCallerQuery<T>(
  resource: string,
  read: ConsoleRead<T>,
): ConsoleResourceQuery<T> {
  return consoleResourceQueryOf(callerResourceKey(resource), read, undefined);
}

/**
 * The inventory, which belongs to no partition and so has no refresh path of
 * its own: `["projects"]` is outside `projectPartitionKey`, so neither a
 * `Project` frame nor the fallback's refetch reaches it and the switcher's list
 * is the one this tab opened with, or last created a project in
 * (kasofsk/chuggy#439).
 */
export function consoleInventoryQuery<T>(
  read: ConsoleRead<T>,
): ConsoleResourceQuery<T> {
  return consoleResourceQueryOf(projectsInventoryKey(), read, undefined);
}
