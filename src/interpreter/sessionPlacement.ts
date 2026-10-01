/** Where one project's sessions run, as its administrator reads and chooses it and as every door that spends a session asks. */

import type {
  PlacementRoute,
  PlacementRouteSource,
  SessionRunnerStanding,
} from "../contract/rosters.ts";
import type { SessionKind } from "./agentSession.ts";
import type { Authority } from "./operationInbox.ts";
import {
  placementChoices,
  placementReader,
  placementRouteGranted,
  placementRouteHosted,
  placementWritten,
  type PlacementAdministration,
  type PlacementRead,
  type PlacementWrite,
  type PlacementWritten,
} from "./placementRoute.ts";
import type { Principal } from "./principal.ts";
import { hostedRunsGranted, type ProjectAccess } from "./projectAccess.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";

/** The kinds a project routes; an inquiry runs where its lead does. */
export const allSessionRouteKinds = ["Thread", "Lead"] as const;
export type SessionRouteKind = (typeof allSessionRouteKinds)[number];

export type SessionRoutes = Readonly<Record<SessionRouteKind, PlacementRoute>>;

/**
 * Where a deployment routes each session kind, and the projects it routes
 * otherwise. An override names only the kinds it changes.
 */
export interface SessionRouting {
  readonly routes: SessionRoutes;
  readonly projectRoutes: ReadonlyMap<
    TenantId,
    ReadonlyMap<ProjectId, Partial<SessionRoutes>>
  >;
}

/** One kind's route and the place it came from. */
export interface SessionRouteResolved {
  readonly route: PlacementRoute;
  readonly source: PlacementRouteSource;
}

/**
 * How long after its last poll a runner still counts as live. A runner polls
 * again as soon as its held poll answers, so this spans several polls and a
 * restart; erring long only delays the lead's skip by as much.
 */
export const sessionRunnerPolledSecsMax = 120;

/**
 * How long a turn offered to runners waits for one to take it before it is
 * withdrawn, since until then it holds its session: an inquiry its asker's
 * slot, a thread every turn behind it. It spans a machine waking from sleep,
 * and not a member left waiting on one that will not.
 */
export const sessionPoolTurnDwellSecs = 30 * 60;

/** The runners a session would run on: the member's own for a thread, and any of the project's for the lead. */
export interface SessionRunners {
  readonly mine: SessionRunnerStanding;
  readonly project: SessionRunnerStanding;
}

/** The reads every door that spends a session asks of where it runs. */
export interface SessionRouteReads {
  route(partition: Partition, kind: SessionKind): Promise<SessionRouteResolved>;
  /** `mine` is `Unregistered` where no member is named. */
  runners(
    partition: Partition,
    member: Principal | undefined,
  ): Promise<SessionRunners>;
}

export interface SessionPlacementStore extends SessionRouteReads {
  write(
    partition: Partition,
    placement: SessionRoutes,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** Each kind's route and where it came from, the routes this caller may choose, and the runners each would run on. */
export interface SessionPlacementView {
  readonly routes: Readonly<Record<SessionRouteKind, SessionRouteResolved>>;
  readonly choices: readonly PlacementRoute[];
  readonly runners: SessionRunners;
}

export type SessionPlacementRead = PlacementRead<SessionPlacementView>;
export type SessionPlacementWritten = PlacementWritten<SessionPlacementView>;

export type SessionPlacementAdministration = PlacementAdministration<
  SessionRoutes,
  SessionPlacementView
>;

async function sessionPlacementView(
  store: SessionRouteReads,
  principal: Principal,
  partition: Partition,
  choices: readonly PlacementRoute[],
): Promise<SessionPlacementView> {
  return {
    routes: {
      Thread: await store.route(partition, "Thread"),
      Lead: await store.route(partition, "Lead"),
    },
    choices,
    runners: await store.runners(partition, principal),
  };
}

export function sessionPlacementAdministration(
  access: ProjectAccess,
  store: SessionPlacementStore,
): SessionPlacementAdministration {
  return {
    read: async (principal, partition) => {
      const reader = await placementReader(access, principal, partition);
      if (reader === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        view: await sessionPlacementView(
          store,
          principal,
          partition,
          placementChoices(reader.administers, reader.hosted),
        ),
      };
    },
    write: (principal, partition, placement) =>
      placementWritten(
        access,
        principal,
        partition,
        [placement.Thread, placement.Lead],
        (authority) => store.write(partition, placement, authority),
        (hosted) =>
          sessionPlacementView(
            store,
            principal,
            partition,
            placementChoices(true, hosted),
          ),
      ),
  };
}

/**
 * Whether a member's turn on this route has a runner that could take it. One
 * offline may come back, and with none registered the turn would only hold its
 * session until it is withdrawn.
 */
export function sessionRunnerServes(
  route: PlacementRoute,
  mine: SessionRunnerStanding,
): boolean {
  return placementRouteHosted[route] || mine !== "Unregistered";
}

/** A member's turn admitted on the route it is stamped with, or the reason it is not. */
export type SessionSpend =
  | { readonly spend: "Admitted"; readonly route: PlacementRoute }
  | { readonly spend: "HostedRunsNotGranted" | "NoRunner" };

/**
 * The route a member may spend a turn of this kind on now: a hosted one under
 * the tenant's grant, and a runner one where they have registered a runner.
 * The turn is stamped with this route, so both are asked of the resolution the
 * turn keeps.
 */
export async function sessionSpendRoute(
  access: ProjectAccess,
  routes: SessionRouteReads,
  principal: Principal,
  partition: Partition,
  kind: SessionKind,
): Promise<SessionSpend> {
  const { route } = await routes.route(partition, kind);
  if (!(await placementRouteGranted(access, principal, partition, route)))
    return { spend: "HostedRunsNotGranted" };
  if (placementRouteHosted[route]) return { spend: "Admitted", route };
  return sessionRunnerServes(
    route,
    (await routes.runners(partition, principal)).mine,
  )
    ? { spend: "Admitted", route }
    : { spend: "NoRunner" };
}

export const allLeadAdmissions = [
  "Admitted",
  "HostedRunsNotGranted",
  "RunnerOffline",
] as const;
export type LeadAdmission = (typeof allLeadAdmissions)[number];

/** A lead's admission, carrying the route an admitted turn is stamped with. */
export type LeadRouteAdmission =
  | { readonly admission: "Admitted"; readonly route: PlacementRoute }
  | { readonly admission: Exclude<LeadAdmission, "Admitted"> };

/**
 * Whether a project's lead may take a turn now: on a hosted route the tenant
 * must grant the lead's principal, and on a runner one of the project's must
 * be live, since a turn offered to none would hold its decision until the
 * decision's deadline.
 */
export async function leadAdmission(
  access: ProjectAccess,
  routes: SessionRouteReads,
  principal: Principal,
  partition: Partition,
): Promise<LeadRouteAdmission> {
  const { route } = await routes.route(partition, "Lead");
  if (placementRouteHosted[route])
    return (await hostedRunsGranted(access, principal, partition.tenant))
      ? { admission: "Admitted", route }
      : { admission: "HostedRunsNotGranted" };
  return (await routes.runners(partition, undefined)).project === "Live"
    ? { admission: "Admitted", route }
    : { admission: "RunnerOffline" };
}
