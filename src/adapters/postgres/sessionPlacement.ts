/**
 * PostgreSQL side of where a project's sessions run: the routing the scheduler
 * publishes at boot, the one resolution every reader asks, the runners a
 * session would run on, and the door the API writes a project's row through.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  placementRouteSources,
  placementRoutes,
  sessionRunnerStandings,
} from "../../contract/rosters.ts";
import type { SessionKind } from "../../interpreter/agentSession.ts";
import type { Principal } from "../../interpreter/principal.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  sessionRunnerPolledSecsMax,
  type SessionPlacementStore,
  type SessionRouteReads,
  type SessionRouteResolved,
  type SessionRouting,
  type SessionRunners,
} from "../../interpreter/sessionPlacement.ts";
import {
  placementWriteOutcome,
  projectRoutesDocument,
} from "./executionPlacement.ts";
import { sessionRowMember } from "./sessionRows.ts";

/** Publishes the session routing this scheduler places under, before its loop reads anything. */
export function postgresSessionRoutingPrecondition(
  pool: pg.Pool,
  routing: SessionRouting,
): RuntimePrecondition {
  const document = projectRoutesDocument(routing.projectRoutes);
  return {
    name: "session-routing-published",
    check: async (signal) => {
      signal.throwIfAborted();
      await pool.query(
        sql`INSERT INTO session_routing
              (singleton,thread_route,lead_route,project_routes,published_at)
            VALUES (1,${routing.routes.Thread},${routing.routes.Lead},
                    ${document}::jsonb,now())
            ON CONFLICT (singleton) DO UPDATE
              SET thread_route=EXCLUDED.thread_route,
                  lead_route=EXCLUDED.lead_route,
                  project_routes=EXCLUDED.project_routes,
                  published_at=EXCLUDED.published_at`,
      );
      signal.throwIfAborted();
      return { met: "Met" };
    },
  };
}

async function sessionRoute(
  pool: pg.Pool,
  partition: Partition,
  kind: SessionKind,
): Promise<SessionRouteResolved> {
  const found = await pool.query<{
    route: string | null;
    source: string | null;
  }>(
    sql`SELECT route, source
          FROM session_route(${partition.tenant},${partition.project},${kind})`,
  );
  const row = found.rows[0];
  return {
    route: sessionRowMember(placementRoutes, row?.route ?? null, "route"),
    source: sessionRowMember(
      placementRouteSources,
      row?.source ?? null,
      "route source",
    ),
  };
}

async function sessionRunners(
  pool: pg.Pool,
  partition: Partition,
  member: Principal | undefined,
): Promise<SessionRunners> {
  const found = await pool.query<{
    member_standing: string | null;
    project_standing: string | null;
  }>(
    sql`SELECT member_standing, project_standing
          FROM session_runner_standing(${partition.tenant},${partition.project},
                                       ${member ?? null}::text,
                                       ${sessionRunnerPolledSecsMax})`,
  );
  const row = found.rows[0];
  return {
    mine: sessionRowMember(
      sessionRunnerStandings,
      row?.member_standing ?? null,
      "runner standing",
    ),
    project: sessionRowMember(
      sessionRunnerStandings,
      row?.project_standing ?? null,
      "runner standing",
    ),
  };
}

/** Where a session of each kind runs and the runners it would run on, read under the API's or the selector's role. */
export function postgresSessionRouteReads(pool: pg.Pool): SessionRouteReads {
  return {
    route: (partition, kind) => sessionRoute(pool, partition, kind),
    runners: (partition, member) => sessionRunners(pool, partition, member),
  };
}

/** The API's read of one project's session placement and the door it writes it through. */
export function postgresSessionPlacement(pool: pg.Pool): SessionPlacementStore {
  return {
    ...postgresSessionRouteReads(pool),
    write: async (partition, placement, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_session_placement(
              ${partition.tenant},${partition.project},${placement.Thread},
              ${placement.Lead},${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
  };
}
