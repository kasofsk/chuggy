/** Where a case's sessions run, fixed rather than resolved, for the suites about what a route decides. */

import type { PlacementRoute } from "../../src/contract/rosters.ts";
import type {
  SessionRouteKind,
  SessionRouteReads,
  SessionRunners,
} from "../../src/interpreter/sessionPlacement.ts";

/** Routes fixed per routed kind, an inquiry following the lead as the definer has it. */
export function sessionRoutesAt(
  routes: Partial<Record<SessionRouteKind, PlacementRoute>> = {},
  runners: SessionRunners = { mine: "Unregistered", project: "Unregistered" },
): SessionRouteReads {
  return {
    route: (_partition, kind) =>
      Promise.resolve({
        route: routes[kind === "Thread" ? "Thread" : "Lead"] ?? "InCluster",
        source: "Project",
      }),
    runners: () => Promise.resolve(runners),
  };
}

/**
 * Routes that answer `first` on the first read and alternate after, so a case
 * can tell the route a door checked from one it read again before stamping.
 */
export function sessionRoutesFlipping(
  first: PlacementRoute,
  runners: SessionRunners,
): SessionRouteReads {
  let reads = 0;
  return {
    route: () => {
      reads += 1;
      return Promise.resolve({
        route:
          reads % 2 === 1 ? first : first === "Pool" ? "InCluster" : "Pool",
        source: "Project",
      });
    },
    runners: () => Promise.resolve(runners),
  };
}
