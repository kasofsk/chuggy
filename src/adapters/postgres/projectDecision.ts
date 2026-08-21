/**
 * The `ProjectDecision` answered by PostgreSQL: the one transaction that
 * commits a project decision.
 *
 * IT ASSEMBLES AND DECIDES NOTHING, exactly as `./projectStore.ts` does not.
 * Every statement is `./decision.ts`'s, and this file exists so the port has
 * one implementation to name.
 *
 * THE POOL IS THE TICKET SERVICE'S AND IT IS NOT THE API'S, for the reason
 * `./projectDiscovery.ts` states: 006 gives runtime services separate
 * credentials, and one pool answering both ports would undo that.
 */

import type pg from "pg";
import { performance } from "node:perf_hooks";

import type {
  Decided,
  Decision,
  ProjectDecision,
} from "../../interpreter/projectDecision.ts";
import {
  postgresDecisionCommit,
  postgresDispatchViewRebuild,
} from "./decision.ts";
import {
  observe,
  silentTicketServiceMetrics,
  type DecisionMetricOutcome,
  type TicketServiceMetrics,
} from "../../interpreter/ticketService.ts";

function repeat(count: number, observation: () => void): void {
  for (let index = 0; index < count; index += 1) observe(observation);
}

/** The decision transaction over a pool opened for the ticket-service role. */
export function postgresProjectDecision(
  pool: pg.Pool,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): ProjectDecision {
  return {
    rebuildDispatchView: (lease, view) =>
      postgresDispatchViewRebuild(pool, lease, view),
    decide: async (decision: Decision): Promise<Decided> => {
      const started = performance.now();
      const decided = await postgresDecisionCommit(pool, decision);
      const outcome: DecisionMetricOutcome =
        decided.decided === "Committed" ? "Journaled" : decided.decided;
      observe(() => {
        metrics.decision(outcome, performance.now() - started);
      });
      if (
        decided.decided === "Committed" &&
        decision.outcome.outcome === "Journaled"
      ) {
        const materialization = decision.outcome.materialization;
        repeat(materialization.execution.length, () => {
          metrics.focusedRequest("Execution");
        });
        repeat(materialization.finalization.length, () => {
          metrics.focusedRequest("Finalization");
        });
        repeat(materialization.actions.length, () => {
          metrics.nativeAction("Opened");
        });
        if (materialization.resolveAction !== undefined) {
          observe(() => {
            metrics.nativeAction("Resolved");
          });
        }
        repeat(materialization.withdrawActionsFor.length, () => {
          metrics.nativeAction("Withdrawn");
        });
        if (materialization.continuation !== undefined) {
          observe(() => {
            metrics.continuation("Created");
          });
        }
      }
      if (decision.cause.kind === "Continuation") {
        if (decided.decided === "Committed")
          observe(() => {
            metrics.continuation("Journaled");
          });
        if (decided.decided === "Stale")
          observe(() => {
            metrics.continuation("Stale");
          });
      }
      return decided;
    },
  };
}
