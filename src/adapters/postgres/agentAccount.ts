/**
 * PostgreSQL side of a person's own agent accounts: the read of each agent of
 * one account and of each credential it holds, in one snapshot, and the doors
 * its settings, its press and a credential's retirement are written through,
 * all five granted to the API and each handed the one principal it serves.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { agentAccountCredentialsMax } from "../../contract/http.ts";
import {
  accountAgents,
  agentPauseReasons,
  runUsageWindows,
  type AccountAgent,
} from "../../contract/rosters.ts";
import type {
  AgentAccountCredential,
  AgentAccountLimit,
  AgentAccountPause,
  AgentAccountReading,
  AgentAccountRetired,
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

interface AgentAccountCredentialRow {
  readonly agent: string | null;
  readonly credential: string | null;
  readonly five_hour_utilization: number | null;
  readonly five_hour_resets_at: Date | null;
  readonly five_hour_observed_at: Date | null;
  readonly seven_day_utilization: number | null;
  readonly seven_day_resets_at: Date | null;
  readonly seven_day_observed_at: Date | null;
  readonly paused_until: Date | null;
  readonly reasons: string[] | null;
  readonly admitted_by_press: boolean | null;
}

/** The columns a reading of each window and a pause are read from, as both rows hold them. */
type AgentAccountHeld = Omit<AgentAccountCredentialRow, "agent" | "credential">;

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
  row: AgentAccountHeld,
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

function agentAccountReadings(
  row: AgentAccountHeld,
): readonly AgentAccountReading[] {
  return [
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
  ];
}

function agentAccountCredential(
  row: AgentAccountCredentialRow,
): AgentAccountCredential {
  const pause = agentAccountPause(row);
  return {
    name: agentAccountRequired(row.credential, "credential"),
    readings: agentAccountReadings(row),
    ...(pause === undefined ? {} : { pause }),
  };
}

/** Each agent's credentials, in the read's own order, held to the bound the wire names. */
function agentAccountCredentialsOf(
  rows: readonly AgentAccountCredentialRow[],
  agent: AccountAgent,
): readonly AgentAccountCredential[] {
  const credentials = rows
    .filter((row) => row.agent === agent)
    .map(agentAccountCredential);
  if (credentials.length > agentAccountCredentialsMax)
    throw new Error("agent account: more credentials than the wire names");
  return credentials;
}

function agentAccountView(
  row: AgentAccountRow,
  credentials: readonly AgentAccountCredentialRow[],
): AgentAccountView {
  const limit = agentAccountLimit(row);
  const pause = agentAccountPause(row);
  const agent = agentAccountKnown(row.agent, accountAgents, "agent");
  return {
    agent,
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
    readings: agentAccountReadings(row),
    ...(limit === undefined ? {} : { limit }),
    ...(pause === undefined ? {} : { pause }),
    credentials: agentAccountCredentialsOf(credentials, agent),
  };
}

/** Both reads in one snapshot, so a credential's pause and its agent's are taken at one instant. */
async function agentAccountSnapshot(
  pool: pg.Pool,
  principal: string,
): Promise<readonly AgentAccountView[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const found = await client.query<AgentAccountRow>(
      sql`SELECT s.agent,s.five_hour_percent,s.seven_day_percent,
                 s.pauses_threads,
                 s.five_hour_utilization,s.five_hour_resets_at,s.five_hour_observed_at,
                 s.seven_day_utilization,s.seven_day_resets_at,s.seven_day_observed_at,
                 s.limit_window,s.limit_resets_at,s.limit_observed_at,
                 s.paused_until,s.reasons,s.admitted_by_press
            FROM agent_account_standing(${principal}) s`,
    );
    const held = await client.query<AgentAccountCredentialRow>(
      sql`SELECT c.agent,c.credential,
                 c.five_hour_utilization,c.five_hour_resets_at,c.five_hour_observed_at,
                 c.seven_day_utilization,c.seven_day_resets_at,c.seven_day_observed_at,
                 c.paused_until,c.reasons,c.admitted_by_press
            FROM agent_account_credential_standing(${principal}) c`,
    );
    await client.query("COMMIT");
    const accounts = found.rows.map((row) => agentAccountView(row, held.rows));
    const named = accounts.reduce(
      (count, account) => count + account.credentials.length,
      0,
    );
    if (named !== held.rows.length)
      throw new Error(
        "agent account: a credential of no agent the read answered",
      );
    return accounts;
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

const agentAccountRetirements: readonly AgentAccountRetired[] = [
  "Retired",
  "NotHeld",
  "CredentialInUse",
];

/** The API's read of one person's agent accounts and the doors their settings, press and retirements are written through. */
export function postgresAgentAccounts(pool: pg.Pool): AgentAccountService {
  return {
    accounts: async (principal) => {
      const accounts = await agentAccountSnapshot(pool, principal);
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
    retire: async (principal, agent, credential) => {
      const found = await pool.query<{ retired: string | null }>(
        sql`SELECT retire_agent_account_credential(${principal},${agent},${credential})::text AS retired`,
      );
      return agentAccountKnown(
        found.rows[0]?.retired ?? null,
        agentAccountRetirements,
        "retirement",
      );
    },
  };
}
