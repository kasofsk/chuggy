/**
 * The `ProjectDiscovery` answered by PostgreSQL: how the ticket-service fleet finds
 * the projects with work waiting.
 *
 * IT ASSEMBLES AND DECIDES NOTHING, exactly as `./projectStore.ts` does not.
 * Every statement is `./readiness.ts`'s, and this file exists so the port has
 * one implementation to name.
 *
 * THE POOL IS THE CALLER'S AND IT IS NOT THE INBOX'S. Where the connection
 * comes from is a deployment choice a process root alone may make, and these
 * calls are the ticket-service role's while `./operationInbox.ts`'s are the API
 * role's — so the two ports are handed separate pools carrying the separate
 * credentials 006 requires of runtime services.
 */

import type pg from "pg";

import type {
  DecisionInput,
  ProjectDiscovery,
  Readiness,
  ReadinessCleared,
} from "../../interpreter/projectDiscovery.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  silentTicketServiceMetrics,
  type TicketServiceMetrics,
} from "../../interpreter/ticketService.ts";
import {
  postgresReadinessClear,
  postgresReadinessConsumable,
  postgresReadinessReady,
} from "./readiness.ts";

/** Discovery over a pool opened for the ticket-service role. */
export function postgresProjectDiscovery(
  pool: pg.Pool,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): ProjectDiscovery {
  return {
    ready: (partitionsMax: number): Promise<readonly Readiness[]> =>
      postgresReadinessReady(pool, partitionsMax),

    next: (
      partition: Partition,
      agingIntervalSeconds?: number,
    ): Promise<DecisionInput | undefined> =>
      postgresReadinessConsumable(
        pool,
        partition,
        agingIntervalSeconds,
        metrics,
      ),

    clearReadiness: (readiness: Readiness): Promise<ReadinessCleared> =>
      postgresReadinessClear(pool, readiness),
  };
}
