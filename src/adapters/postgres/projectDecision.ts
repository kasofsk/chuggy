/**
 * The `ProjectDecision` answered by PostgreSQL: the one transaction that
 * commits a project decision.
 *
 * IT ASSEMBLES AND DECIDES NOTHING, exactly as `./projectStore.ts` does not.
 * Every statement is `./decision.ts`'s, and this file exists so the port has
 * one implementation to name.
 *
 * THE POOL IS THE DISPATCHER'S AND IT IS NOT THE INBOX'S, for the reason
 * `./projectDiscovery.ts` states: 006 gives runtime services separate
 * credentials, and one pool answering both ports would undo that.
 */

import type pg from "pg";

import type {
  Decided,
  Decision,
  ProjectDecision,
} from "../../interpreter/projectDecision.ts";
import { postgresDecisionCommit } from "./decision.ts";

/** The decision transaction over a pool the composition root opened for the dispatcher role. */
export function postgresProjectDecision(pool: pg.Pool): ProjectDecision {
  return {
    decide: (decision: Decision): Promise<Decided> =>
      postgresDecisionCommit(pool, decision),
  };
}
