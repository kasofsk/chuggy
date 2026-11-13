/**
 * An agent account's stored state planted as rows: its readings, its limit,
 * its owner's settings and their press, each instant written as seconds from
 * the planting transaction's own `now()`, so a case states an edge exactly.
 *
 * A READING AND A LIMIT ARE KEPT UNDER A CREDENTIAL, their agent's default
 * where a case names none, as a run naming none is.
 *
 * A READING AND A LIMIT POINT AT THE ATTEMPT THEY CAME FROM, and a case here is
 * about the account rather than the attempt, so the transaction that plants
 * them stands the foreign keys down for itself alone.
 */
import { workerRunCredentialDefaults } from "../../src/contract/workerPlane.ts";
import type { PostgresHarness, PostgresTransaction } from "./harness.ts";

export type AgentAccountHarnessAgent = "Claude" | "Codex";

export interface AgentAccountHarnessReading {
  readonly window: "five_hour" | "seven_day";
  readonly utilization: number;
  readonly resetsSecs: number;
  readonly observedSecs: number;
  readonly credential?: string;
}

/** A limit whose reset is unknown where `resetsSecs` is absent. */
export interface AgentAccountHarnessLimit {
  readonly observedSecs: number;
  readonly resetsSecs?: number;
  readonly credential?: string;
}

export interface AgentAccountHarnessState {
  readonly readings?: readonly AgentAccountHarnessReading[];
  readonly limit?: AgentAccountHarnessLimit;
  /** Limits beside `limit`, each of a credential of its own. */
  readonly limits?: readonly AgentAccountHarnessLimit[];
  readonly setting?: {
    readonly fiveHourPercent: number;
    readonly sevenDayPercent: number;
    readonly pausesThreads: boolean;
  };
  readonly press?: {
    readonly pressedSecs: number;
    readonly spentSecs?: number;
  };
}

/** A weekly reading over the default threshold of each credential `ends` names, each resetting that many seconds from now. */
export function agentAccountHarnessCredentialsOver(
  ends: Readonly<Record<string, number>>,
): AgentAccountHarnessState {
  return {
    readings: Object.entries(ends).map(([credential, resetsSecs]) => ({
      window: "seven_day",
      utilization: 0.95,
      resetsSecs,
      observedSecs: -60,
      credential,
    })),
  };
}

/** What the person chose of the account: their settings and their press. */
async function agentAccountHarnessChosen(
  transaction: PostgresTransaction,
  principal: string,
  agent: AgentAccountHarnessAgent,
  state: AgentAccountHarnessState,
): Promise<void> {
  if (state.setting !== undefined)
    await transaction.query(
      `INSERT INTO agent_account_setting
         (principal,agent,five_hour_percent,seven_day_percent,pauses_threads)
       VALUES($1,$2,$3,$4,$5)`,
      [
        principal,
        agent,
        state.setting.fiveHourPercent,
        state.setting.sevenDayPercent,
        state.setting.pausesThreads,
      ],
    );
  if (state.press !== undefined)
    await transaction.query(
      `INSERT INTO agent_account_press(principal,agent,pressed_at,spent_at)
       VALUES($1,$2,now()+make_interval(secs=>$3),now()+make_interval(secs=>$4))`,
      [
        principal,
        agent,
        state.press.pressedSecs,
        state.press.spentSecs ?? null,
      ],
    );
}

/** Writes `state` for one account's agent through `transaction`, replacing whatever it held. */
export async function agentAccountHarnessPlanted(
  transaction: PostgresTransaction,
  principal: string,
  agent: AgentAccountHarnessAgent,
  state: AgentAccountHarnessState,
): Promise<void> {
  await transaction.query("SET LOCAL session_replication_role=replica");
  for (const relation of [
    "agent_account_usage",
    "agent_account_limit",
    "agent_account_setting",
    "agent_account_press",
  ])
    await transaction.query(
      `DELETE FROM ${relation} WHERE principal=$1 AND agent=$2`,
      [principal, agent],
    );
  for (const reading of state.readings ?? [])
    await transaction.query(
      `INSERT INTO agent_account_usage
         (principal,agent,credential,usage_window,utilization,resets_at,observed_at,
          tenant,project,execution,attempt)
       VALUES($1,$2,$3,$4,$5,now()+make_interval(secs=>$6),now()+make_interval(secs=>$7),
              'tenant','project','execution','attempt')`,
      [
        principal,
        agent,
        reading.credential ?? workerRunCredentialDefaults[agent],
        reading.window,
        reading.utilization,
        reading.resetsSecs,
        reading.observedSecs,
      ],
    );
  for (const limit of [
    ...(state.limit === undefined ? [] : [state.limit]),
    ...(state.limits ?? []),
  ])
    await transaction.query(
      `INSERT INTO agent_account_limit
         (principal,agent,credential,resets_at,observed_at,tenant,project,execution,attempt)
       VALUES($1,$2,$3,now()+make_interval(secs=>$4),now()+make_interval(secs=>$5),
              'tenant','project','execution','attempt')`,
      [
        principal,
        agent,
        limit.credential ?? workerRunCredentialDefaults[agent],
        limit.resetsSecs ?? null,
        limit.observedSecs,
      ],
    );
  await agentAccountHarnessChosen(transaction, principal, agent, state);
}

/** Plants `state` and commits it, for a case whose claims run on connections of their own. */
export async function agentAccountHarnessCommitted(
  harness: PostgresHarness,
  principal: string,
  agent: AgentAccountHarnessAgent,
  state: AgentAccountHarnessState,
): Promise<void> {
  const planting = await harness.begin();
  try {
    await agentAccountHarnessPlanted(planting, principal, agent, state);
  } catch (error) {
    await planting.rollback();
    throw error;
  }
  await planting.commit();
}

/** A press made now and not yet spent, beside what the account already holds. */
export async function agentAccountHarnessPressed(
  harness: PostgresHarness,
  principal: string,
  agent: AgentAccountHarnessAgent,
): Promise<void> {
  await harness.query(
    `INSERT INTO agent_account_press(principal,agent,pressed_at) VALUES($1,$2,now())
     ON CONFLICT (principal,agent) DO UPDATE SET pressed_at=EXCLUDED.pressed_at,spent_at=NULL`,
    [principal, agent],
  );
}
