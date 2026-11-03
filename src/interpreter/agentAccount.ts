/**
 * A person's own agent accounts: how each agent of one pauses, each window's
 * newest reading and the newest limit a provider stopped it at, the pause they
 * come to, and the press that tries it again after that limit.
 *
 * EVERY CALL IS THE CALLER'S OWN. Each is handed the principal its request
 * authenticated as and names no other, so no person reads or writes another's
 * settings, readings or pause, or presses for them.
 *
 * THE PAUSE IS `agent_account_pause`'S ANSWER AT THE READ, never derived here:
 * the rule is stated once, over the database's own clock.
 */

import type {
  AccountAgent,
  AgentPauseReason,
  RunUsageWindow,
} from "../contract/rosters.ts";
import type { Principal } from "./principal.ts";

/** The share of each window a reading pauses an agent at, as a whole percentage, and whether threads and inquiries and the lead pause with it. */
export interface AgentAccountSettings {
  readonly fiveHourPercent: number;
  readonly sevenDayPercent: number;
  readonly pausesThreads: boolean;
  readonly pausesLead: boolean;
}

/** One window's newest reading, its utilization a share of the window where the whole is one. */
export interface AgentAccountReading {
  readonly window: RunUsageWindow;
  readonly utilization: number;
  readonly resetsAt: string;
  readonly observedAt: string;
}

/** The newest limit a provider stopped the agent at, its window and reopening where the run named them. */
export interface AgentAccountLimit {
  readonly window?: RunUsageWindow;
  readonly resetsAt?: string;
  readonly observedAt: string;
}

/** Until when the agent is paused, why, and whether an unspent press lets one claim through the limit. */
export interface AgentAccountPause {
  readonly until: string;
  readonly reasons: readonly AgentPauseReason[];
  readonly pressed: boolean;
}

export interface AgentAccountView {
  readonly agent: AccountAgent;
  readonly settings: AgentAccountSettings;
  readonly readings: readonly AgentAccountReading[];
  readonly limit?: AgentAccountLimit;
  readonly pause?: AgentAccountPause;
}

/** A press recorded, or none because no limit holds the agent paused. */
export type AgentAccountPressed = "Pressed" | "NotHardPaused";

/**
 * The caller's own accounts: every agent of theirs read in roster order, one
 * agent's settings written whole, and a press of one agent, which is recorded
 * only while a limit holds it paused.
 */
export interface AgentAccountService {
  accounts(principal: Principal): Promise<readonly AgentAccountView[]>;
  write(
    principal: Principal,
    agent: AccountAgent,
    settings: AgentAccountSettings,
  ): Promise<void>;
  press(
    principal: Principal,
    agent: AccountAgent,
  ): Promise<AgentAccountPressed>;
}
