/** Where one project's executions run, as its administrator reads and chooses it. */

import {
  executionRoutesResolved,
  type ExecutionRoute,
  type ExecutionRoutes,
  type ExecutionRoutesResolved,
} from "./executionScheduler.ts";
import type { Authority } from "./operationInbox.ts";
import {
  placementChoices,
  placementReader,
  placementWritten,
  type PlacementAdministration,
  type PlacementRead,
  type PlacementWrite,
  type PlacementWritten,
} from "./placementRoute.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** The deployment's routing as it bears on one project, and the project's own placement. */
export interface ExecutionPlacementStanding {
  readonly defaults: ExecutionRoutes;
  readonly override: Partial<ExecutionRoutes>;
  readonly placement: ExecutionRoutes | undefined;
}

export interface ExecutionPlacementStore {
  standing(partition: Partition): Promise<ExecutionPlacementStanding>;
  write(
    partition: Partition,
    placement: ExecutionRoutes,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** Each kind's route and where it came from, and the routes this caller may choose. */
export interface ExecutionPlacementView {
  readonly routes: ExecutionRoutesResolved;
  readonly choices: readonly ExecutionRoute[];
}

export type ExecutionPlacementRead = PlacementRead<ExecutionPlacementView>;
export type ExecutionPlacementWritten =
  PlacementWritten<ExecutionPlacementView>;

export type ExecutionPlacementAdministration = PlacementAdministration<
  ExecutionRoutes,
  ExecutionPlacementView
>;

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
    choices: placementChoices(administers, hosted),
  };
}

async function executionPlacementRead(
  access: ProjectAccess,
  store: ExecutionPlacementStore,
  principal: Principal,
  partition: Partition,
): Promise<ExecutionPlacementRead> {
  const reader = await placementReader(access, principal, partition);
  if (reader === undefined) return { result: "NotFound" };
  const standing = await store.standing(partition);
  return {
    result: "Found",
    view: executionPlacementView(standing, reader.administers, reader.hosted),
  };
}

function executionPlacementWrite(
  access: ProjectAccess,
  store: ExecutionPlacementStore,
  principal: Principal,
  partition: Partition,
  placement: ExecutionRoutes,
): Promise<ExecutionPlacementWritten> {
  return placementWritten(
    access,
    principal,
    partition,
    [placement.Work, placement.Evaluation],
    (authority) => store.write(partition, placement, authority),
    async (hosted) =>
      executionPlacementView(await store.standing(partition), true, hosted),
  );
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
