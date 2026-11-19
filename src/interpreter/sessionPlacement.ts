/** Where one project's threads run, as its administrator reads and chooses it and as every door that spends a thread's turn asks. */

import {
  type LeadOffering,
  type PlacementRoute,
  type PlacementRouteSource,
  type SessionRunnerStanding,
} from "../contract/rosters.ts";
import { memberScopeReserved } from "./agentSession.ts";
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
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";

/** The kinds a project routes. */
export const allSessionRouteKinds = ["Thread"] as const;
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
 * How long after its last poll a runner still counts as live, wherever its
 * liveness is read. A runner polls again as soon as its held poll answers, so
 * this spans several polls and a restart.
 */
export const sessionRunnerPolledSecsMax = 120;

/**
 * How long a turn offered to runners waits for one to take it before it is
 * withdrawn, since until then it holds every turn of its thread behind it. It
 * spans a machine waking from sleep, and not a member left waiting on one that
 * will not.
 */
export const sessionPoolTurnDwellSecs = 30 * 60;

/**
 * The runners a member's thread would run on: `mine` their chat host for a
 * project's thread and `inquiry` their chat host for their own chat's.
 */
export interface SessionRunners {
  readonly mine: SessionRunnerStanding;
  readonly inquiry: SessionRunnerStanding;
}

/** The standing of the runners a member's thread in `partition` would run on. */
export function sessionRunnersServing(
  runners: SessionRunners,
  partition: Partition,
): SessionRunnerStanding {
  return memberScopeReserved(partition) ? runners.inquiry : runners.mine;
}

/** The reads every door that spends a session asks of where it runs. */
export interface SessionRouteReads {
  route(
    partition: Partition,
    kind: SessionRouteKind,
  ): Promise<SessionRouteResolved>;
  /** `mine` and `inquiry` are `Unregistered` where no member is named. */
  runners(
    partition: Partition,
    member: Principal | undefined,
  ): Promise<SessionRunners>;
}

/** A session placement as an administrator writes it and the store keeps it: each kind's route. */
export type SessionPlacementChoice = SessionRoutes;

export interface SessionPlacementStore extends SessionRouteReads {
  write(
    partition: Partition,
    placement: SessionPlacementChoice,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** Each kind's route and where it came from, the routes this caller may choose, and the runners a thread would run on. */
export interface SessionPlacementView {
  readonly routes: Readonly<Record<SessionRouteKind, SessionRouteResolved>>;
  readonly choices: readonly PlacementRoute[];
  readonly runners: SessionRunners;
}

/**
 * What a placement read answers of the project's runners for clients that
 * still parse them: there is no project pool, so they are never registered.
 */
export const sessionPlacementProjectRunnersCompatibility =
  "Unregistered" satisfies SessionRunnerStanding;

/**
 * What a placement read answers of the lead for clients that still parse one:
 * there is no lead, so its route and offering are fixed and never stored.
 */
export const sessionPlacementLeadCompatibility = {
  lead: { route: "InCluster", source: "Default" },
  leadOffering: "Own",
  leadOfferings: ["Own"],
} as const satisfies {
  readonly lead: SessionRouteResolved;
  readonly leadOffering: LeadOffering;
  readonly leadOfferings: readonly LeadOffering[];
};

export type SessionPlacementRead = PlacementRead<SessionPlacementView>;
export type SessionPlacementWritten = PlacementWritten<SessionPlacementView>;

export type SessionPlacementAdministration = PlacementAdministration<
  SessionPlacementChoice,
  SessionPlacementView,
  SessionPlacementWritten
>;

async function sessionPlacementView(
  store: SessionPlacementStore,
  principal: Principal,
  partition: Partition,
  choices: readonly PlacementRoute[],
): Promise<SessionPlacementView> {
  return {
    routes: { Thread: await store.route(partition, "Thread") },
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
      placementWritten<SessionPlacementChoice, SessionPlacementView>(
        access,
        principal,
        partition,
        () =>
          Promise.resolve({
            placement: { Thread: placement.Thread },
            routes: [placement.Thread],
          }),
        (authority, held) => store.write(partition, held, authority),
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

/** A member's turn of their thread admitted on the route it is stamped with, or the reason it is not. */
export type SessionSpendThread =
  | { readonly spend: "Admitted"; readonly route: PlacementRoute }
  | { readonly spend: "HostedRunsNotGranted" | "NoRunner" };

/**
 * The route a member may spend a turn of their thread on now: a hosted one
 * under the tenant's grant, and a runner one where a runner that would take it
 * is registered, the turn stamped with this route and so both asked of the
 * resolution it keeps. A turn of a member's own session is never in cluster,
 * whatever the site's routing says, and only their chat host takes it.
 */
export async function sessionSpendRoute(
  access: ProjectAccess,
  routes: SessionRouteReads,
  principal: Principal,
  partition: Partition,
): Promise<SessionSpendThread> {
  const route: PlacementRoute = memberScopeReserved(partition)
    ? "Pool"
    : (await routes.route(partition, "Thread")).route;
  if (!(await placementRouteGranted(access, principal, partition, route)))
    return { spend: "HostedRunsNotGranted" };
  if (placementRouteHosted[route]) return { spend: "Admitted", route };
  return sessionRunnerServes(
    route,
    sessionRunnersServing(
      await routes.runners(partition, principal),
      partition,
    ),
  )
    ? { spend: "Admitted", route }
    : { spend: "NoRunner" };
}
