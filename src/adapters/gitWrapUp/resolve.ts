/**
 * The performer's read model: told only a decision's identity and a ticket, it
 * answers "which branch does this gate merge" by folding the journal it is
 * handed with the actor's own `execCmd`, to the emission's own seq — never to
 * latest, because a re-delivered instruction from before a rework must merge
 * the branch that decision held, not the one the fleet holds now.
 *
 * The fold is never a source of truth and decides nothing. The branch is
 * `workBranch` over the ticket's artifact mark, on the ground the deployment
 * fixes: with a one-task work set the producing task's id equals the mark,
 * because ids are dense from one and the mark is the spawn count at the work
 * reduce — the constructor refuses any other `nTasks`. A delivery this fold
 * cannot serve is refused by throwing, so the executor's cursor holds and the
 * instruction re-emits.
 */

import { replayCore, type Entry } from "../../actor/journal.ts";
import type { Config } from "../../domain/config.ts";
import { ticketAt } from "../../domain/core.ts";
import { asTaskId } from "../../domain/ids.ts";
import { workBranch } from "../../interpreter/artifact.ts";
import type { Emission } from "../../interpreter/ports.ts";

/** The branch the emission's gate merges, read off the journal at that decision. */
export function wrapUpBranchAt(
  config: Config,
  journal: readonly Entry[],
  emission: Emission,
): string {
  const prefix = journal.slice(0, emission.seq);
  const last = prefix.at(-1);
  if (last === undefined || last.seq !== emission.seq) {
    throw new Error(
      `gitWrapUp: the journal holds no decision ${String(emission.seq)} to resolve the gate against`,
    );
  }
  const ticket = ticketAt(replayCore(config, prefix), emission.ticket);
  if (ticket.artifact.artifact !== "ASome") {
    throw new Error(
      `gitWrapUp: ticket ${String(emission.ticket)} holds no produced artifact at decision ${String(emission.seq)}`,
    );
  }
  return workBranch(emission.ticket, asTaskId(ticket.artifact.mark));
}
