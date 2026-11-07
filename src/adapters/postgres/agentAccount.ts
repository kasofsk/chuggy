/**
 * PostgreSQL side of a person's own agent accounts: the read of each agent of
 * one account, and the doors its settings and its press are written through,
 * all three granted to the API and each handed the one principal it serves.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  accountAgents,
  agentPauseReasons,
  runUsageWindows,
  type AccountAgent,
} from "../../contract/rosters.ts";
import type {
  AgentAccountLimit,
  AgentAccountPause,
  AgentAccountReading,
  AgentAccountService,
  AgentAccountView,
} from "../../interpreter/agentAccount.ts";

interface AgentAccountRow {
  readonly agent: string | null;
  readonly five_hour_percent: number | null;
  readonly seven_day_percent: number | null;
  readonly pauses_threads: boolean | null;
  readonly five_hour_utilization: number | null;
  readonly five_hour_resets_at: Date | null;
  readonly five_hour_observed_at: Date | null;
  readonly seven_day_utilization: number | null;
  readonly seven_day_resets_at: Date | null;
  readonly seven_day_observed_at: Date | null;
  readonly limit_window: string | null;
  readonly limit_resets_at: Date | null;
  readonly limit_observed_at: Date | null;
  readonly paused_until: Date | null;
  readonly reasons: string[] | null;
  readonly admitted_by_press: boolean | null;
}

function agentAccountKnown<Value extends string>(
  value: string | null,
  values: readonly Value[],
  what: string,
): Value {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`agent account: unknown ${what}`);
  return found;
}

function agentAccountRequired<Value>(value: Value | null, what: string): Value {
  if (value === null) throw new Error(`agent account: no ${what}`);
  return value;
}

/** One window's reading, or none where the window holds no row. */
function agentAccountReading(
  window: AgentAccountReading["window"],
  utilization: number | null,
  resetsAt: Date | null,
  observedAt: Date | null,
): readonly AgentAccountReading[] {
  if (utilization === null || resetsAt === null || observedAt === null)
    return [];
  return [
    {
      window,
      utilization,
      resetsAt: resetsAt.toISOString(),
      observedAt: observedAt.toISOString(),
    },
  ];
}

function agentAccountLimit(
  row: AgentAccountRow,
): AgentAccountLimit | undefined {
  if (row.limit_observed_at === null) return undefined;
  return {
    ...(row.limit_window === null
      ? {}
      : {
          window: agentAccountKnown(
            row.limit_window,
            runUsageWindows,
            "limit window",
          ),
        }),
    ...(row.limit_resets_at === null
      ? {}
      : { resetsAt: row.limit_resets_at.toISOString() }),
    observedAt: row.limit_observed_at.toISOString(),
  };
}

function agentAccountPause(
  row: AgentAccountRow,
): AgentAccountPause | undefined {
  if (row.paused_until === null) return undefined;
  return {
    until: row.paused_until.toISOString(),
    reasons: agentAccountRequired(row.reasons, "pause reasons").map((reason) =>
      agentAccountKnown(reason, agentPauseReasons, "pause reason"),
    ),
    pressed: row.admitted_by_press === true,
  };
}

function agentAccountView(row: AgentAccountRow): AgentAccountView {
  const limit = agentAccountLimit(row);
  const pause = agentAccountPause(row);
  return {
    agent: agentAccountKnown(row.agent, accountAgents, "agent"),
    settings: {
      fiveHourPercent: agentAccountRequired(
        row.five_hour_percent,
        "five-hour threshold",
      ),
      sevenDayPercent: agentAccountRequired(
        row.seven_day_percent,
        "seven-day threshold",
      ),
      pausesThreads: agentAccountRequired(row.pauses_threads, "thread option"),
    },
    readings: [
      ...agentAccountReading(
        "five_hour",
        row.five_hour_utilization,
        row.five_hour_resets_at,
        row.five_hour_observed_at,
      ),
      ...agentAccountReading(
        "seven_day",
        row.seven_day_utilization,
        row.seven_day_resets_at,
        row.seven_day_observed_at,
      ),
    ],
    ...(limit === undefined ? {} : { limit }),
    ...(pause === undefined ? {} : { pause }),
  };
}

/** The API's read of one person's agent accounts and the doors their settings and press are written through. */
export function postgresAgentAccounts(pool: pg.Pool): AgentAccountService {
  return {
    accounts: async (principal) => {
      const found = await pool.query<AgentAccountRow>(
        sql`SELECT s.agent,s.five_hour_percent,s.seven_day_percent,
                   s.pauses_threads,
                   s.five_hour_utilization,s.five_hour_resets_at,s.five_hour_observed_at,
                   s.seven_day_utilization,s.seven_day_resets_at,s.seven_day_observed_at,
                   s.limit_window,s.limit_resets_at,s.limit_observed_at,
                   s.paused_until,s.reasons,s.admitted_by_press
              FROM agent_account_standing(${principal}) s`,
      );
      const accounts = found.rows.map(agentAccountView);
      if (accounts.length !== accountAgents.length)
        throw new Error("agent account: the read did not answer every agent");
      return accounts;
    },
    write: async (principal, agent, settings) => {
      await pool.query<{ written: string | null }>(
        sql`SELECT write_agent_account_setting(${principal},${agent},
              ${settings.fiveHourPercent}::smallint,${settings.sevenDayPercent}::smallint,
              ${settings.pausesThreads})::text AS written`,
      );
    },
    press: async (principal, agent: AccountAgent) => {
      const found = await pool.query<{ pressed: boolean | null }>(
        sql`SELECT press_agent_account(${principal},${agent})::boolean AS pressed`,
      );
      return found.rows[0]?.pressed === true ? "Pressed" : "NotHardPaused";
    },
  };
}
