/**
 * PostgreSQL side of where a project's sessions run: the routing the scheduler
 * publishes at boot, the subsidized lead the selector publishes at boot, the
 * one resolution every reader asks, the runners a session would run on,
 * whether one could take the lead now, and the door the API writes a
 * project's row through.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  leadOfferings,
  placementRouteSources,
  placementRoutes,
  sessionRunnerStandings,
} from "../../contract/rosters.ts";
import type { SessionKind } from "../../interpreter/agentSession.ts";
import type { Principal } from "../../interpreter/principal.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  leadRunnerStandings,
  sessionRunnerPolledSecsMax,
  type LeadRouteReads,
  type SessionPlacementStore,
  type SessionRouteReads,
  type SessionRouteResolved,
  type SessionRouting,
  type SessionRunners,
  type SubsidizedLeadProfile,
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

/**
 * Publishes the subsidized lead this selector offers, or withdraws the one a
 * previous start published where it offers none, before its loop reads
 * anything.
 */
export function postgresSubsidizedLeadPrecondition(
  pool: pg.Pool,
  profile: SubsidizedLeadProfile | undefined,
): RuntimePrecondition {
  return {
    name: "subsidized-lead-published",
    check: async (signal) => {
      signal.throwIfAborted();
      if (profile === undefined)
        await pool.query(sql`DELETE FROM subsidized_lead`);
      else
        await pool.query(
          sql`INSERT INTO subsidized_lead
                (singleton,credential_slot,model,effort,auto_compact_window,
                 input_bytes_per_decision,turn_tokens_max,published_at)
              VALUES (1,${profile.credentialSlot},${profile.model},
                      ${profile.effort},${profile.autoCompactWindow},
                      ${profile.inputBytesPerDecision},
                      ${profile.turnTokensMax},now())
              ON CONFLICT (singleton) DO UPDATE
                SET credential_slot=EXCLUDED.credential_slot,
                    model=EXCLUDED.model,
                    effort=EXCLUDED.effort,
                    auto_compact_window=EXCLUDED.auto_compact_window,
                    input_bytes_per_decision=EXCLUDED.input_bytes_per_decision,
                    turn_tokens_max=EXCLUDED.turn_tokens_max,
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
    inquiry_standing: string | null;
    project_standing: string | null;
  }>(
    sql`SELECT member_standing, inquiry_standing, project_standing
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
    inquiry: sessionRowMember(
      sessionRunnerStandings,
      row?.inquiry_standing ?? null,
      "runner standing",
    ),
    project: sessionRowMember(
      sessionRunnerStandings,
      row?.project_standing ?? null,
      "runner standing",
    ),
  };
}

/** Where a session of each kind runs and the runners it would run on, read under the API's role. */
export function postgresSessionRouteReads(pool: pg.Pool): SessionRouteReads {
  return {
    route: (partition, kind) => sessionRoute(pool, partition, kind),
    runners: (partition, member) => sessionRunners(pool, partition, member),
  };
}

/** Where a project's lead runs and whether a runner there could take it, read under the selector's role. */
export function postgresLeadRouteReads(pool: pg.Pool): LeadRouteReads {
  return {
    route: (partition, kind) => sessionRoute(pool, partition, kind),
    leadRunners: async (partition) => {
      const found = await pool.query<{ standing: string | null }>(
        sql`SELECT standing
              FROM lead_runner_standing(${partition.tenant},${partition.project},
                                        ${sessionRunnerPolledSecsMax})`,
      );
      return sessionRowMember(
        leadRunnerStandings,
        found.rows[0]?.standing ?? null,
        "lead runner standing",
      );
    },
  };
}

/** The API's read of one project's session placement and the door it writes it through. */
export function postgresSessionPlacement(pool: pg.Pool): SessionPlacementStore {
  return {
    ...postgresSessionRouteReads(pool),
    leadOffering: async (partition) => {
      const found = await pool.query<{ offering: string | null }>(
        sql`SELECT session_lead_offering(
              ${partition.tenant},${partition.project})::text AS offering`,
      );
      return sessionRowMember(
        leadOfferings,
        found.rows[0]?.offering ?? null,
        "lead offering",
      );
    },
    storedLeadOffering: async (partition) => {
      const found = await pool.query<{ offering: string | null }>(
        sql`SELECT stored_lead_offering(
              ${partition.tenant},${partition.project})::text AS offering`,
      );
      return sessionRowMember(
        leadOfferings,
        found.rows[0]?.offering ?? null,
        "lead offering",
      );
    },
    subsidizedLeadOffered: async () => {
      const found = await pool.query<{ credential_slot: string | null }>(
        sql`SELECT credential_slot FROM read_subsidized_lead()`,
      );
      return found.rows.length > 0;
    },
    write: async (partition, placement, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_session_placement(
              ${partition.tenant},${partition.project},${placement.Thread},
              ${placement.Lead},${placement.leadOffering},
              ${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
  };
}
