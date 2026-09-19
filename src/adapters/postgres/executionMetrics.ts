import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { ExecutionMetricSample } from "../../interpreter/executionMetrics.ts";

/**
 * The samples one scrape reads, drawn in four queries over the rows the ticket
 * execution path already keeps. Each is grouped in the database, so a scrape
 * costs a scan of the project's own rows rather than a row per execution
 * crossing this boundary.
 */

/** A bigint arrives as text, because a sum past the safe range must not read as one. */
function counted(value: string | null): number {
  const held = Number(value ?? 0);
  return Number.isFinite(held) && held >= 0 ? held : 0;
}

export interface ExecutionMetricsPort {
  samples(silenceSecs: number): Promise<readonly ExecutionMetricSample[]>;
}

/** How many executions stand in each state, and what their silent attempts add up to. */
async function stateSamples(
  pool: pg.Pool,
): Promise<readonly ExecutionMetricSample[]> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    state: string;
    held: string;
    unreported: string | null;
  }>(sql`SELECT tenant,project,state,count(*)::text AS held,
      sum(attempts_unreported)::text AS unreported
    FROM ticket_execution GROUP BY tenant,project,state`);
  return found.rows.flatMap((row) => {
    const labels = {
      tenant: row.tenant,
      project: row.project,
      state: row.state,
    };
    return [
      {
        name: "chug_ticket_executions",
        labels,
        value: counted(row.held),
      },
      {
        name: "chug_ticket_execution_attempts_unreported",
        labels,
        value: counted(row.unreported),
      },
    ];
  });
}

/** How many live claims hold a workload that has said nothing inside the bound. */
async function silentSamples(
  pool: pg.Pool,
  silenceSecs: number,
): Promise<readonly ExecutionMetricSample[]> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    held: string;
  }>(sql`SELECT tenant,project,count(*)::text AS held
    FROM ticket_execution
    WHERE state='Running' AND claim_expires_at>now()
      AND (last_reported_at IS NULL
        OR last_reported_at < now()-make_interval(secs=>${silenceSecs}::double precision))
    GROUP BY tenant,project`);
  return found.rows.map((row) => ({
    name: "chug_ticket_execution_workloads_silent",
    labels: { tenant: row.tenant, project: row.project },
    value: counted(row.held),
  }));
}

/** What every attempt of a project reported spending, summed. */
async function totalSamples(
  pool: pg.Pool,
): Promise<readonly ExecutionMetricSample[]> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    cost: string | null;
    turns: string | null;
    input: string | null;
    output: string | null;
    cache_creation: string | null;
    cache_read: string | null;
  }>(sql`SELECT tenant,project,
      sum(cost_usd_micros)::text AS cost, sum(turns)::text AS turns,
      sum(tokens_input)::text AS input, sum(tokens_output)::text AS output,
      sum(tokens_cache_creation)::text AS cache_creation,
      sum(tokens_cache_read)::text AS cache_read
    FROM ticket_execution_run_total GROUP BY tenant,project`);
  return found.rows.flatMap((row) => {
    const labels = { tenant: row.tenant, project: row.project };
    return [
      {
        name: "chug_ticket_execution_run_cost_usd_micros",
        labels,
        value: counted(row.cost),
      },
      {
        name: "chug_ticket_execution_run_turns",
        labels,
        value: counted(row.turns),
      },
      ...(
        [
          ["input", row.input],
          ["output", row.output],
          ["cache_creation", row.cache_creation],
          ["cache_read", row.cache_read],
        ] as const
      ).map(([kind, value]) => ({
        name: "chug_ticket_execution_run_tokens",
        labels: { ...labels, kind },
        value: counted(value),
      })),
    ];
  });
}

export function postgresExecutionMetrics(pool: pg.Pool): ExecutionMetricsPort {
  return {
    samples: async (silenceSecs) => [
      ...(await stateSamples(pool)),
      ...(await silentSamples(pool, silenceSecs)),
      ...(await totalSamples(pool)),
    ],
  };
}
