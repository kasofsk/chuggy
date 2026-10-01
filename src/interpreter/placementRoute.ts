/** What reading and choosing where a project's work or sessions run asks of the caller. */

import { placementRoutes, type PlacementRoute } from "../contract/rosters.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import { hostedRunsGranted, type ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/**
 * Whether a route runs on this deployment's own credentials, which is what the
 * tenant's hosted grant covers. It is exhaustive, so a new route decides it.
 */
export const placementRouteHosted: Readonly<Record<PlacementRoute, boolean>> = {
  InCluster: true,
  Pool: false,
};

export const allPlacementWrites = ["Written", "Unchanged", "NotFound"] as const;
export type PlacementWrite = (typeof allPlacementWrites)[number];

export type PlacementRead<View> =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly view: View };

export type PlacementWritten<View> =
  | { readonly result: "NotFound" }
  | { readonly result: "HostedRunsNotGranted" }
  | { readonly result: "Written" | "Unchanged"; readonly view: View };

/** One project's placement of some kind of work, read under `Read` and written whole by an administrator. */
export interface PlacementAdministration<Routes, View> {
  read(
    principal: Principal,
    partition: Partition,
  ): Promise<PlacementRead<View>>;
  write(
    principal: Principal,
    partition: Partition,
    placement: Routes,
  ): Promise<PlacementWritten<View>>;
}

/** The routes a caller may choose: none unless it administers, and a hosted one only under the grant. */
export function placementChoices(
  administers: boolean,
  hosted: boolean,
): readonly PlacementRoute[] {
  if (!administers) return [];
  return placementRoutes.filter(
    (route) => hosted || !placementRouteHosted[route],
  );
}

/** Whether a placement names a route the caller's grants do not cover. */
function placementRefused(
  routes: readonly PlacementRoute[],
  hosted: boolean,
): boolean {
  return !hosted && routes.some((route) => placementRouteHosted[route]);
}

/** Whether a principal may spend work on a route: the tenant's hosted grant on a hosted one, and nothing more otherwise. */
export async function placementRouteGranted(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
  route: PlacementRoute,
): Promise<boolean> {
  return (
    !placementRouteHosted[route] ||
    hostedRunsGranted(access, principal, partition.tenant)
  );
}

/** What a reader of a project's placement may do with it, or nothing where it may not read the project. */
export async function placementReader(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
): Promise<
  { readonly administers: boolean; readonly hosted: boolean } | undefined
> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return undefined;
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  const hosted =
    administers &&
    (await hostedRunsGranted(access, principal, partition.tenant));
  return { administers, hosted };
}

/** A placement an administrator writes, refused where it names a hosted route the tenant does not grant them, and answered with the view read after it. */
export async function placementWritten<View>(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
  routes: readonly PlacementRoute[],
  write: (authority: Authority) => Promise<PlacementWrite>,
  view: (hosted: boolean) => Promise<View>,
): Promise<PlacementWritten<View>> {
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const hosted = await hostedRunsGranted(access, principal, partition.tenant);
  if (placementRefused(routes, hosted))
    return { result: "HostedRunsNotGranted" };
  const written = await write(authority);
  if (written === "NotFound") return { result: "NotFound" };
  return { result: written, view: await view(hosted) };
}
