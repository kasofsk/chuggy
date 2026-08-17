/**
 * The dispatch pick: first ticket id first.
 *
 * Ticket ids are dense and never reused, so the least id is the earliest
 * arrival and the pick is a queue discipline without a queue. Any total pick
 * refines the model's unrestricted choice, and the placement is the point:
 * the pick lives above the deciders and above replay — a decider never sees
 * it, and a journal replays the same fleet whatever policy chose — so a
 * change of policy can leak into neither.
 */

import type { TicketId } from "../domain/ids.ts";

/** The dispatcher's choice among the launchable tickets: the least id, or nothing to pick. */
export function policyPick(
  candidates: readonly TicketId[],
): TicketId | undefined {
  return candidates.reduce(
    (least: TicketId | undefined, candidate) =>
      least === undefined || candidate < least ? candidate : least,
    undefined,
  );
}
