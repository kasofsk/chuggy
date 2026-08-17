/**
 * The fabric's read model: told only a decision's identity and a ticket, it
 * answers "what do I run" by folding the journal it is handed to the
 * emission's own seq — never to latest, because a re-emission of an old spawn
 * must see the task set that decision created, not the one the fleet holds
 * now. The live set at that post-state is exactly the fan-out the decision
 * spawned, whatever kind its tasks are.
 *
 * The fold is never a source of truth and decides nothing. A delivery it
 * cannot serve is refused by throwing, so the executor's cursor holds and the
 * row re-emits. The evaluation install's branch is `workBranch` over the
 * ticket's artifact mark at the same post-state, on the ground the deployment
 * fixes: with a one-task work set the producing task's id equals the mark —
 * the constructor refuses any other `nTasks`.
 */

import { replayCore, type Entry } from "../../actor/journal.ts";
import type { Config } from "../../domain/config.ts";
import { ticketAt } from "../../domain/core.ts";
import { asTaskId } from "../../domain/ids.ts";
import type { Ticket } from "../../domain/ticket.ts";
import { workBranch } from "../../interpreter/artifact.ts";
import type { Emission } from "../../interpreter/ports.ts";

/** The emission's ticket as its decision left it, holding the task set that decision spawned. */
export function fabricTicketAt(
  config: Config,
  journal: readonly Entry[],
  emission: Emission,
): Ticket {
  const prefix = journal.slice(0, emission.seq);
  const last = prefix.at(-1);
  if (last === undefined || last.seq !== emission.seq) {
    throw new Error(
      `k8sFabric: the journal holds no decision ${String(emission.seq)} to resolve the spawn against`,
    );
  }
  const ticket = ticketAt(replayCore(config, prefix), emission.ticket);
  if (ticket.tasks.length === 0) {
    throw new Error(
      `k8sFabric: ticket ${String(emission.ticket)} holds no live task at decision ${String(emission.seq)}, so this is not a spawn to serve`,
    );
  }
  return ticket;
}

/** The branch an evaluation task installs from, re-formed from the mark the resolved ticket holds. */
export function fabricProducedBranchOf(
  emission: Emission,
  ticket: Ticket,
): string {
  if (ticket.artifact.artifact !== "ASome") {
    throw new Error(
      `k8sFabric: ticket ${String(emission.ticket)} holds no produced artifact at decision ${String(emission.seq)}`,
    );
  }
  return workBranch(emission.ticket, asTaskId(ticket.artifact.mark));
}
