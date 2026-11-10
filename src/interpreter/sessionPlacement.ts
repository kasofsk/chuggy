/** Where one project's sessions run, as its administrator reads and chooses it and as every door that spends a session asks. */

import {
  leadAdmissionRefusals,
  leadOfferings,
  type LeadAdmissionRefusal,
  type LeadOffering,
  type PlacementRoute,
  type PlacementRouteSource,
  type SessionRunnerStanding,
} from "../contract/rosters.ts";
import type { SessionEffort } from "../contract/http.ts";
import { memberScopeReserved, type SessionKind } from "./agentSession.ts";
import type { Authority } from "./operationInbox.ts";
import {
  placementChoices,
  placementReader,
  placementRouteGranted,
  placementRouteHosted,
  placementWritten,
  type PlacementAdministration,
  type PlacementHeld,
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
 * How long after its last poll a runner still counts as live, for a session and
 * for a pool deferring to it under `Preferred`. A runner polls again as soon as
 * its held poll answers, so this spans several polls and a restart; erring long
 * only delays the lead's skip, or a pool's claim, by as much.
 */
export const sessionRunnerPolledSecsMax = 120;

/**
 * How long a turn offered to runners waits for one to take it before it is
 * withdrawn, since until then it holds its session: an inquiry its asker's
 * slot, a thread every turn behind it. It spans a machine waking from sleep,
 * and not a member left waiting on one that will not.
 */
export const sessionPoolTurnDwellSecs = 30 * 60;

/**
 * The runners a session would run on: the member's chat host for their thread
 * and for their inquiry, and any of the project's pools for the lead.
 */
export interface SessionRunners {
  readonly mine: SessionRunnerStanding;
  readonly inquiry: SessionRunnerStanding;
  readonly project: SessionRunnerStanding;
}

/** The standing of the runners a member's session of `kind` would run on. */
export function sessionRunnersServing(
  runners: SessionRunners,
  kind: SessionKind,
): SessionRunnerStanding {
  switch (kind) {
    case "Thread":
      return runners.mine;
    case "Inquiry":
      return runners.inquiry;
    case "Lead":
      return runners.project;
  }
}

/**
 * Whether a live runner of the project could take its lead now: `Paused`
 * where every live one's owner has their Claude account paused, and `Offline`
 * where none is live.
 */
export const leadRunnerStandings = ["Live", "Paused", "Offline"] as const;
export type LeadRunnerStanding = (typeof leadRunnerStandings)[number];

/** The reads every door that spends a session asks of where it runs. */
export interface SessionRouteReads {
  route(partition: Partition, kind: SessionKind): Promise<SessionRouteResolved>;
  /** The offering the project's lead resolves to, which is `Own` wherever its stored choice does not hold. */
  leadOffering(partition: Partition): Promise<LeadOffering>;
  /** `mine` and `inquiry` are `Unregistered` where no member is named. */
  runners(
    partition: Partition,
    member: Principal | undefined,
  ): Promise<SessionRunners>;
}

/** The reads a lead's admission asks: where it runs, as which offering, and whether a runner there could take it. */
export interface LeadRouteReads extends Pick<
  SessionRouteReads,
  "route" | "leadOffering"
> {
  leadRunners(partition: Partition): Promise<LeadRunnerStanding>;
}

/**
 * What a deployment's subsidized lead runs on: a credential slot of its own, a
 * pinned model and effort, and the bounds one of its decisions is held to.
 */
export interface SubsidizedLeadProfile {
  readonly credentialSlot: string;
  readonly model: string;
  readonly effort: SessionEffort;
  readonly autoCompactWindow: number;
  readonly inputBytesPerDecision: number;
  readonly turnTokensMax: number;
}

/** A session placement as an administrator writes it: each kind's route, and the lead's offering where it names one. */
export interface SessionPlacementChoice extends SessionRoutes {
  readonly leadOffering?: LeadOffering;
}

/** A session placement as the store writes it: each kind's route, and the lead's offering the hosted grant was decided on. */
export interface SessionPlacementStored extends SessionRoutes {
  readonly leadOffering: LeadOffering;
}

export interface SessionPlacementStore extends SessionRouteReads {
  /** The offering the project's own row keeps, however it resolves: the one a write naming none keeps while its lead stays in cluster. */
  storedLeadOffering(partition: Partition): Promise<LeadOffering>;
  /** Whether the deployment publishes a subsidized lead. */
  subsidizedLeadOffered(): Promise<boolean>;
  write(
    partition: Partition,
    placement: SessionPlacementStored,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** Each kind's route and where it came from, the lead's offering and the ones the deployment admits, the routes this caller may choose, and the runners each would run on. */
export interface SessionPlacementView {
  readonly routes: Readonly<Record<SessionRouteKind, SessionRouteResolved>>;
  readonly leadOffering: LeadOffering;
  readonly leadOfferings: readonly LeadOffering[];
  readonly choices: readonly PlacementRoute[];
  readonly runners: SessionRunners;
}

/** What a write naming an offering its lead's route does not admit on this deployment is refused with. */
export type SessionPlacementRefusal = "LeadOfferingNotAdmitted";

export type SessionPlacementRead = PlacementRead<SessionPlacementView>;
export type SessionPlacementWritten = PlacementWritten<
  SessionPlacementView,
  SessionPlacementRefusal
>;

export type SessionPlacementAdministration = PlacementAdministration<
  SessionPlacementChoice,
  SessionPlacementView,
  SessionPlacementWritten
>;

/** The offerings the deployment admits a lead: `Subsidized` only while it publishes the profile. */
export function sessionPlacementLeadOfferings(
  offered: boolean,
): readonly LeadOffering[] {
  return leadOfferings.filter((each) => offered || each !== "Subsidized");
}

async function sessionPlacementView(
  store: SessionPlacementStore,
  principal: Principal,
  partition: Partition,
  choices: readonly PlacementRoute[],
): Promise<SessionPlacementView> {
  return {
    routes: {
      Thread: await store.route(partition, "Thread"),
      Lead: await store.route(partition, "Lead"),
    },
    leadOffering: await store.leadOffering(partition),
    leadOfferings: sessionPlacementLeadOfferings(
      await store.subsidizedLeadOffered(),
    ),
    choices,
    runners: await store.runners(partition, principal),
  };
}

/**
 * The placement a write stores and the routes it is held to the hosted grant
 * for, or its refusal: a subsidized lead needs no grant, and is admitted only
 * in cluster while the profile is published. An offering not named is the
 * row's stored one while the lead stays in cluster, and `Own` otherwise.
 */
async function sessionPlacementHeld(
  store: SessionPlacementStore,
  partition: Partition,
  choice: SessionPlacementChoice,
): Promise<PlacementHeld<SessionPlacementStored> | SessionPlacementRefusal> {
  const placement: SessionPlacementStored = {
    Thread: choice.Thread,
    Lead: choice.Lead,
    leadOffering:
      choice.leadOffering ??
      (choice.Lead === "InCluster"
        ? await store.storedLeadOffering(partition)
        : "Own"),
  };
  switch (placement.leadOffering) {
    case "Own":
      return { placement, routes: [placement.Thread, placement.Lead] };
    case "Subsidized":
      return placement.Lead === "InCluster" &&
        (await store.subsidizedLeadOffered())
        ? { placement, routes: [placement.Thread] }
        : "LeadOfferingNotAdmitted";
  }
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
      placementWritten<
        SessionPlacementStored,
        SessionPlacementView,
        SessionPlacementRefusal
      >(
        access,
        principal,
        partition,
        () => sessionPlacementHeld(store, partition, placement),
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

/**
 * A member's turn admitted on the route it is stamped with, and whether on the
 * lead's subsidy rather than their grant, or the reason it is not.
 */
export type SessionSpend =
  | {
      readonly spend: "Admitted";
      readonly route: PlacementRoute;
      readonly subsidized: boolean;
    }
  | { readonly spend: "HostedRunsNotGranted" | "NoRunner" };

/**
 * Whether a member's turn of this kind on this route may be spent without
 * their hosted grant: an inquiry of a subsidized lead, which the offering pays
 * for. The inquiry door forks it only from a lead on the profile's slot, since
 * one opened before the project chose the subsidy stands on the hosted one, so
 * it is asked only of a member the grant does not already admit.
 */
async function sessionSpendSubsidized(
  routes: SessionRouteReads,
  partition: Partition,
  kind: SessionKind,
  route: PlacementRoute,
): Promise<boolean> {
  return (
    kind === "Inquiry" &&
    placementRouteHosted[route] &&
    (await routes.leadOffering(partition)) === "Subsidized"
  );
}

/**
 * The route a member may spend a turn of this kind on now: a hosted one under
 * the tenant's grant, or under the lead's subsidy for an inquiry, and a runner
 * one where a runner that would take it is registered, the turn stamped with
 * this route and so both asked of the resolution it keeps. A turn of a
 * member's own session is never in cluster, whatever the site's routing says,
 * and only their chat host takes it.
 */
export async function sessionSpendRoute(
  access: ProjectAccess,
  routes: SessionRouteReads,
  principal: Principal,
  partition: Partition,
  kind: SessionKind,
): Promise<SessionSpend> {
  if (memberScopeReserved(partition))
    return sessionRunnerServes(
      "Pool",
      (await routes.runners(partition, principal)).inquiry,
    )
      ? { spend: "Admitted", route: "Pool", subsidized: false }
      : { spend: "NoRunner" };
  const { route } = await routes.route(partition, kind);
  const granted = await placementRouteGranted(
    access,
    principal,
    partition,
    route,
  );
  const subsidized =
    !granted && (await sessionSpendSubsidized(routes, partition, kind, route));
  if (!granted && !subsidized) return { spend: "HostedRunsNotGranted" };
  if (placementRouteHosted[route])
    return { spend: "Admitted", route, subsidized };
  return sessionRunnerServes(
    route,
    sessionRunnersServing(await routes.runners(partition, principal), kind),
  )
    ? { spend: "Admitted", route, subsidized }
    : { spend: "NoRunner" };
}

export const allLeadAdmissions = [
  "Admitted",
  ...leadAdmissionRefusals,
] as const;
export type LeadAdmission = (typeof allLeadAdmissions)[number];

/** A lead's admission, carrying the route an admitted turn is stamped with and the offering it was admitted as. */
export type LeadRouteAdmission =
  | {
      readonly admission: "Admitted";
      readonly route: PlacementRoute;
      readonly offering: LeadOffering;
    }
  | { readonly admission: LeadAdmissionRefusal };

/**
 * Whether a project's lead may take a turn now: on a hosted route a subsidized
 * lead is admitted as one and asks no grant, and otherwise the tenant must
 * grant the lead's principal; on a runner route one of the project's must be
 * live with its owner's account not paused, since a turn offered to none that
 * may take it would hold its decision until the decision's deadline.
 */
export async function leadAdmission(
  access: ProjectAccess,
  routes: LeadRouteReads,
  principal: Principal,
  partition: Partition,
): Promise<LeadRouteAdmission> {
  const { route } = await routes.route(partition, "Lead");
  if (placementRouteHosted[route]) {
    if ((await routes.leadOffering(partition)) === "Subsidized")
      return { admission: "Admitted", route, offering: "Subsidized" };
    return (await hostedRunsGranted(access, principal, partition.tenant))
      ? { admission: "Admitted", route, offering: "Own" }
      : { admission: "HostedRunsNotGranted" };
  }
  switch (await routes.leadRunners(partition)) {
    case "Live":
      return { admission: "Admitted", route, offering: "Own" };
    case "Paused":
      return { admission: "UsagePaused" };
    case "Offline":
      return { admission: "RunnerOffline" };
  }
}
