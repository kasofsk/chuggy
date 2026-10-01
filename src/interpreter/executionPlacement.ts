/** Where one project's executions run, as its administrator reads and chooses it. */

import {
  allExecutionRoutes,
  executionRoutesResolved,
  type ExecutionRoute,
  type ExecutionRoutes,
  type ExecutionRoutesResolved,
} from "./executionScheduler.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import { hostedRunsGranted, type ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/**
 * Whether a route runs on this deployment's own credentials, which is what the
 * tenant's hosted grant covers. It is exhaustive, so a new route decides it.
 */
export const executionRouteHosted: Readonly<Record<ExecutionRoute, boolean>> = {
  InCluster: true,
  Pool: false,
};

/** The deployment's routing as it bears on one project, and the project's own placement. */
export interface ExecutionPlacementStanding {
  readonly defaults: ExecutionRoutes;
  readonly override: Partial<ExecutionRoutes>;
  readonly placement: ExecutionRoutes | undefined;
}

export const allExecutionPlacementWrites = [
  "Written",
  "Unchanged",
  "NotFound",
] as const;
export type ExecutionPlacementWrite =
  (typeof allExecutionPlacementWrites)[number];

export interface ExecutionPlacementStore {
  standing(partition: Partition): Promise<ExecutionPlacementStanding>;
  write(
    partition: Partition,
    placement: ExecutionRoutes,
    authority: Authority,
  ): Promise<ExecutionPlacementWrite>;
}

/** Each kind's route and where it came from, and the routes this caller may choose. */
export interface ExecutionPlacementView {
  readonly routes: ExecutionRoutesResolved;
  readonly choices: readonly ExecutionRoute[];
}

export type ExecutionPlacementRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly view: ExecutionPlacementView };

export type ExecutionPlacementWritten =
  | { readonly result: "NotFound" }
  | { readonly result: "HostedRunsNotGranted" }
  | {
      readonly result: "Written" | "Unchanged";
      readonly view: ExecutionPlacementView;
    };

export interface ExecutionPlacementAdministration {
  read(
    principal: Principal,
    partition: Partition,
  ): Promise<ExecutionPlacementRead>;
  write(
    principal: Principal,
    partition: Partition,
    placement: ExecutionRoutes,
  ): Promise<ExecutionPlacementWritten>;
}

/** The routes a caller may choose: none unless it administers, and a hosted one only under the grant. */
export function executionPlacementChoices(
  administers: boolean,
  hosted: boolean,
): readonly ExecutionRoute[] {
  if (!administers) return [];
  return allExecutionRoutes.filter(
    (route) => hosted || !executionRouteHosted[route],
  );
}

/** Whether a placement names a route the caller's grants do not cover. */
export function executionPlacementRefused(
  placement: ExecutionRoutes,
  hosted: boolean,
): boolean {
  return (
    !hosted &&
    (executionRouteHosted[placement.Work] ||
      executionRouteHosted[placement.Evaluation])
  );
}

function executionPlacementView(
  standing: ExecutionPlacementStanding,
  administers: boolean,
  hosted: boolean,
): ExecutionPlacementView {
  return {
    routes: executionRoutesResolved(
      standing.defaults,
      standing.override,
      standing.placement,
    ),
    choices: executionPlacementChoices(administers, hosted),
  };
}

async function executionPlacementRead(
  access: ProjectAccess,
  store: ExecutionPlacementStore,
  principal: Principal,
  partition: Partition,
): Promise<ExecutionPlacementRead> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  const hosted =
    administers &&
    (await hostedRunsGranted(access, principal, partition.tenant));
  const standing = await store.standing(partition);
  return {
    result: "Found",
    view: executionPlacementView(standing, administers, hosted),
  };
}

async function executionPlacementWrite(
  access: ProjectAccess,
  store: ExecutionPlacementStore,
  principal: Principal,
  partition: Partition,
  placement: ExecutionRoutes,
): Promise<ExecutionPlacementWritten> {
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const hosted = await hostedRunsGranted(access, principal, partition.tenant);
  if (executionPlacementRefused(placement, hosted))
    return { result: "HostedRunsNotGranted" };
  const written = await store.write(partition, placement, authority);
  if (written === "NotFound") return { result: "NotFound" };
  const standing = await store.standing(partition);
  return {
    result: written,
    view: executionPlacementView(standing, true, hosted),
  };
}

export function executionPlacementAdministration(
  access: ProjectAccess,
  store: ExecutionPlacementStore,
): ExecutionPlacementAdministration {
  return {
    read: (principal, partition) =>
      executionPlacementRead(access, store, principal, partition),
    write: (principal, partition, placement) =>
      executionPlacementWrite(access, store, principal, partition, placement),
  };
}
