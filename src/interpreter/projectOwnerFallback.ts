/**
 * Whether a project's executions may run on their owner's personal runner, and
 * when a pool may take one instead: one setting, the project's own, read by
 * its members and written by its administrators.
 *
 * ABSENT IS NOT A THIRD FALLBACK. A project that names none registers its
 * executions as it did before personal runners existed: no personal runner
 * takes one and every pool may. Naming one is the model's
 * `personalRunnerAllowed` with that `ownerFallback`, pinned on each execution
 * registered after it, as its route is.
 */

import type { Authority } from "./operationInbox.ts";
import type { PlacementRead, PlacementWrite } from "./placementRoute.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** The model's `OwnerFallback`: whether a pool other than a personal one may take an owned execution while its owner has a personal pool for it. */
export const allWorkerPoolOwnerFallbacks = ["Strict", "Preferred"] as const;
export type WorkerPoolOwnerFallback =
  (typeof allWorkerPoolOwnerFallbacks)[number];

/** Narrows text to the fallback it names, refusing one the model does not know. */
export function asWorkerPoolOwnerFallback(
  value: string,
): WorkerPoolOwnerFallback {
  const known = allWorkerPoolOwnerFallbacks.find((named) => named === value);
  if (known === undefined)
    throw new RangeError(`owner fallback: ${value} is not a known fallback`);
  return known;
}

/** The project's row and the door it is written through, undefined where it names no fallback. */
export interface ProjectOwnerFallbackStore {
  fallback(partition: Partition): Promise<WorkerPoolOwnerFallback | undefined>;
  write(
    partition: Partition,
    fallback: WorkerPoolOwnerFallback | undefined,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** The project's fallback, and whether the reader may change it. */
export interface ProjectOwnerFallbackView {
  readonly fallback: WorkerPoolOwnerFallback | undefined;
  readonly administers: boolean;
}

export type ProjectOwnerFallbackWritten =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Written" | "Unchanged";
      readonly view: ProjectOwnerFallbackView;
    };

/** One project's fallback, read under `Read` and written by an administrator. */
export interface ProjectOwnerFallbackAdministration {
  read(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<ProjectOwnerFallbackView>>;
  write(
    principal: Principal,
    partition: Partition,
    fallback: WorkerPoolOwnerFallback | undefined,
  ): Promise<ProjectOwnerFallbackWritten>;
}

async function projectOwnerFallbackRead(
  access: ProjectAccess,
  store: ProjectOwnerFallbackStore,
  principal: Principal,
  partition: Partition,
): Promise<PlacementRead<ProjectOwnerFallbackView>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  return {
    result: "Found",
    view: { fallback: await store.fallback(partition), administers },
  };
}

async function projectOwnerFallbackWrite(
  access: ProjectAccess,
  store: ProjectOwnerFallbackStore,
  principal: Principal,
  partition: Partition,
  fallback: WorkerPoolOwnerFallback | undefined,
): Promise<ProjectOwnerFallbackWritten> {
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const written = await store.write(partition, fallback, authority);
  if (written === "NotFound") return { result: "NotFound" };
  return {
    result: written,
    view: { fallback: await store.fallback(partition), administers: true },
  };
}

export function projectOwnerFallbackAdministration(
  access: ProjectAccess,
  store: ProjectOwnerFallbackStore,
): ProjectOwnerFallbackAdministration {
  return {
    read: (principal, partition) =>
      projectOwnerFallbackRead(access, store, principal, partition),
    write: (principal, partition, fallback) =>
      projectOwnerFallbackWrite(access, store, principal, partition, fallback),
  };
}
