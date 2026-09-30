/**
 * PostgreSQL side of where a project's executions run: the project's own row,
 * the routing the scheduler publishes at boot, and the door the API writes the
 * row through.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allExecutionPlacementWrites,
  type ExecutionPlacementStore,
} from "../../interpreter/executionPlacement.ts";
import {
  allExecutionRoutes,
  type ExecutionRoute,
  type ExecutionRoutes,
  type ExecutionRouting,
} from "../../interpreter/executionScheduler.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";

function placementRoute(value: string): ExecutionRoute {
  const route = allExecutionRoutes.find((known) => known === value);
  if (route === undefined)
    throw new Error(`execution placement: ${value} is not a known route`);
  return route;
}

function placementRouteOptional(
  value: string | null,
): ExecutionRoute | undefined {
  return value === null ? undefined : placementRoute(value);
}

/** The routes a project chose, read under the scheduler's role. */
export async function postgresProjectPlacement(
  pool: pg.Pool,
  partition: Partition,
): Promise<ExecutionRoutes | undefined> {
  const found = await pool.query<{
    work_route: string;
    evaluation_route: string;
  }>(
    sql`SELECT work_route, evaluation_route FROM project_execution_placement
         WHERE tenant=${partition.tenant} AND project=${partition.project}`,
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        Work: placementRoute(row.work_route),
        Evaluation: placementRoute(row.evaluation_route),
      };
}

/** The overrides as the published document holds them: tenant, then project, then kind. */
function executionRoutingDocument(routing: ExecutionRouting): string {
  return JSON.stringify(
    Object.fromEntries(
      [...routing.projectRoutes].map(([tenant, projects]) => [
        tenant,
        Object.fromEntries(projects),
      ]),
    ),
  );
}

/** Publishes the routing this scheduler registers under, before its loop reads anything. */
export function postgresExecutionRoutingPrecondition(
  pool: pg.Pool,
  routing: ExecutionRouting,
): RuntimePrecondition {
  const document = executionRoutingDocument(routing);
  return {
    name: "execution-routing-published",
    check: async (signal) => {
      signal.throwIfAborted();
      await pool.query(
        sql`INSERT INTO execution_routing
              (singleton,work_route,evaluation_route,project_routes,published_at)
            VALUES (1,${routing.routes.Work},${routing.routes.Evaluation},
                    ${document}::jsonb,now())
            ON CONFLICT (singleton) DO UPDATE
              SET work_route=EXCLUDED.work_route,
                  evaluation_route=EXCLUDED.evaluation_route,
                  project_routes=EXCLUDED.project_routes,
                  published_at=EXCLUDED.published_at`,
      );
      signal.throwIfAborted();
      return { met: "Met" };
    },
  };
}

/** The API's read of one project's placement and the door it writes it through. */
export function postgresExecutionPlacement(
  pool: pg.Pool,
): ExecutionPlacementStore {
  return {
    standing: async (partition) => {
      const found = await pool.query<{
        work_route: string;
        evaluation_route: string;
        work_override: string | null;
        evaluation_override: string | null;
        placed_work: string | null;
        placed_evaluation: string | null;
      }>(
        sql`SELECT r.work_route, r.evaluation_route,
                   r.project_routes #>> ARRAY[${partition.tenant}::text,${partition.project}::text,'Work'] AS work_override,
                   r.project_routes #>> ARRAY[${partition.tenant}::text,${partition.project}::text,'Evaluation'] AS evaluation_override,
                   p.work_route AS placed_work, p.evaluation_route AS placed_evaluation
              FROM execution_routing r
              LEFT JOIN project_execution_placement p
                ON p.tenant=${partition.tenant} AND p.project=${partition.project}
             WHERE r.singleton=1`,
      );
      const row = found.rows[0];
      if (row === undefined)
        throw new Error("execution placement: no routing is published");
      const work = placementRouteOptional(row.work_override);
      const evaluation = placementRouteOptional(row.evaluation_override);
      return {
        defaults: {
          Work: placementRoute(row.work_route),
          Evaluation: placementRoute(row.evaluation_route),
        },
        override: {
          ...(work === undefined ? {} : { Work: work }),
          ...(evaluation === undefined ? {} : { Evaluation: evaluation }),
        },
        placement:
          row.placed_work === null || row.placed_evaluation === null
            ? undefined
            : {
                Work: placementRoute(row.placed_work),
                Evaluation: placementRoute(row.placed_evaluation),
              },
      };
    },
    write: async (partition, placement, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_execution_placement(
              ${partition.tenant},${partition.project},${placement.Work},
              ${placement.Evaluation},${authority.kind},${authority.subject})::text AS outcome`,
      );
      const outcome = allExecutionPlacementWrites.find(
        (known) => known === found.rows[0]?.outcome,
      );
      if (outcome === undefined)
        throw new Error(
          `execution placement: unknown outcome ${String(found.rows[0]?.outcome)}`,
        );
      return outcome;
    },
  };
}
