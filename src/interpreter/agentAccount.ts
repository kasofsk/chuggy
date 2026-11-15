/**
 * A person's own agent accounts: how each agent of one pauses, each window's
 * newest reading and the newest limit a provider stopped it at across its
 * credentials, the pause they come to, each credential's own readings and
 * pause by its name, the press that tries the agent again after a limit, a
 * credential retired from it, and a credential turned off and on by name.
 *
 * EVERY CALL IS THE CALLER'S OWN. Each is handed the principal its request
 * authenticated as and names no other, so no person reads or writes another's
 * settings, readings or pause, presses for them, or retires or turns off their
 * credentials.
 *
 * THE PAUSE IS `agent_account_pause`'S ANSWER AT THE READ, holding only while
 * every credential the account's live runners name is paused, or while any is
 * where they name none, and a credential's is `agent_account_named_pause`'s of
 * its one name, never derived here: the rule is stated once, over the
 * database's own clock.
 *
 * A PAUSE HELD ONLY BY CREDENTIALS TURNED OFF NEVER ENDS BY ITSELF, so it is
 * read `off` and names no end; every other pause names one.
 */

import type {
  AccountAgent,
  AgentPauseReason,
  RunUsageWindow,
} from "../contract/rosters.ts";
import type { Principal } from "./principal.ts";

/** The share of each window a reading pauses an agent at, as a whole percentage, and whether threads and inquiries pause with it. */
export interface AgentAccountSettings {
  readonly fiveHourPercent: number;
  readonly sevenDayPercent: number;
  readonly pausesThreads: boolean;
}

/** One window's reading, of one credential or the newest across an agent's, its utilization a share of the window where the whole is one. */
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

/** Until when the agent is paused, or that only credentials turned off hold it, why, and whether an unspent press lets one claim through the limit. */
export type AgentAccountPause = (
  | { readonly until: string; readonly off?: never }
  | { readonly off: true; readonly until?: never }
) & {
  readonly reasons: readonly AgentPauseReason[];
  readonly pressed: boolean;
};

/** The pause an agent comes to, and the names of the credentials holding it, in the order the agent's credentials are listed. */
export type AgentAccountHeldPause = AgentAccountPause & {
  readonly credentials: readonly string[];
};

/** One credential an agent holds a reading or a limit of or is turned off, by its name: each window's reading of it and the pause holding it alone. */
export interface AgentAccountCredential {
  readonly name: string;
  readonly readings: readonly AgentAccountReading[];
  readonly pause?: AgentAccountPause;
}

export interface AgentAccountView {
  readonly agent: AccountAgent;
  readonly settings: AgentAccountSettings;
  readonly readings: readonly AgentAccountReading[];
  readonly limit?: AgentAccountLimit;
  readonly pause?: AgentAccountHeldPause;
  /** In name order. */
  readonly credentials: readonly AgentAccountCredential[];
}

/** A press recorded, or none because no limit holds the agent paused. */
export type AgentAccountPressed = "Pressed" | "NotHardPaused";

/** A credential's readings and limit dropped, none held under that name, or refused because a live runner of the account still names it while it is on. */
export type AgentAccountRetired = "Retired" | "NotHeld" | "CredentialInUse";

/** A credential off, already or now, or refused because as many of the agent's credentials as the account holds off are off. */
export type AgentAccountTurnedOff = "Off" | "OffFull";

/** A credential on again, or none of that name was off. */
export type AgentAccountTurnedOn = "On" | "NotOff";

/**
 * The caller's own accounts: every agent of theirs read in roster order, one
 * agent's settings written whole, a press of one agent, which is recorded
 * only while a limit holds it paused, one credential of an agent retired,
 * which a credential reporting again is kept again after, and one credential
 * of an agent turned off or on by name.
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
  retire(
    principal: Principal,
    agent: AccountAgent,
    credential: string,
  ): Promise<AgentAccountRetired>;
  turnOff(
    principal: Principal,
    agent: AccountAgent,
    credential: string,
  ): Promise<AgentAccountTurnedOff>;
  turnOn(
    principal: Principal,
    agent: AccountAgent,
    credential: string,
  ): Promise<AgentAccountTurnedOn>;
}
