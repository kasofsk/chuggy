/**
 * The durable decision log: one `Entry` per decision, replay from `genesis`,
 * and the legality check the refinement obligation `journalLegal` asks.
 *
 * A ROW IS THE EVENT THE DECISION TOOK, and replay folds `evolve` over the
 * rows. No decider and no policy is consulted again: the event already names
 * the edge a failing stage took, so a replay re-applies what happened rather
 * than re-deciding it, and the journal is a sufficient basis for the state
 * because nothing else ever entered one.
 *
 * LEGALITY IS WHAT A ROW COULD NOT BE IF IT WAS DECIDED. Its seq is the next
 * one, its ticket stands (a release's must not), and its event moves the
 * prefix it lands on. The last is exact because a decided event is never the
 * identity (`eventsNeverIdentity`, proved by the model), so a replayed row, a
 * stale one and one for a task nothing owes are all refused by the same check.
 *
 * A ROW CARRIES THE SEMANTICS IT WAS DECIDED UNDER, and this image has the
 * deciders for exactly one (`src/actor/decisionSemantics.ts`). A row declaring
 * another is refused below rather than replayed.
 */

import type {
  Entry,
  TicketEvent,
  TicketGraph,
} from "../domain/generated/modelTypes.ts";
import { eventTicket, evolve } from "../domain/evolve.ts";
import { graphEquals } from "../domain/equality.ts";
import {
  decisionSemanticsVersionCurrent,
  type DecisionSemanticsVersion,
} from "./decisionSemantics.ts";

export type { Entry };

/** One row as a store holds it: the entry, and the semantics it was decided under. */
export interface StoredEntry {
  readonly entry: Entry;
  readonly semantics: DecisionSemanticsVersion;
}

/** The journal's base state: the machine's init fleet, empty. */
export const genesis: TicketGraph = { tickets: new Map() };

/** A history this image decided whole, which is what an in-memory actor and the model both hold. */
export function storedAtCurrentSemantics(
  journal: readonly Entry[],
): readonly StoredEntry[] {
  return journal.map((entry) => ({
    entry,
    semantics: decisionSemanticsVersionCurrent,
  }));
}

/** Recovery: fold `evolve` over a stored history from `genesis`. */
export function storedReplayGraph(stored: readonly StoredEntry[]): TicketGraph {
  return stored.reduce((graph, row) => evolve(graph, row.entry.event), genesis);
}

/** Recovery: fold `evolve` over the journal's events from `genesis`. */
export function replayGraph(journal: readonly Entry[]): TicketGraph {
  return storedReplayGraph(storedAtCurrentSemantics(journal));
}

/** Whether the ticket an event names stands where it would apply: a release's must not exist yet, every other's must. */
export function eventTicketStands(
  graph: TicketGraph,
  event: TicketEvent,
): boolean {
  const exists = graph.tickets.has(eventTicket(event));
  return event.type === "TicketCreated" ? !exists : exists;
}

/**
 * Whether a stored history is one the machine could have decided: this
 * image's semantics on every row, dense seqs, every event's ticket standing
 * at its replayed prefix, and every event moving that prefix.
 */
export function storedJournalLegalOn(stored: readonly StoredEntry[]): boolean {
  let replayed = genesis;
  let next = 1;
  for (const row of stored) {
    if (
      row.semantics !== decisionSemanticsVersionCurrent ||
      row.entry.seq !== next ||
      !eventTicketStands(replayed, row.entry.event)
    ) {
      return false;
    }
    const evolved = evolve(replayed, row.entry.event);
    if (graphEquals(evolved, replayed)) return false;
    replayed = evolved;
    next += 1;
  }
  return true;
}

/** Whether a history this image decided whole is a legal domain trace, as the model asks it. */
export function journalLegalOn(journal: readonly Entry[]): boolean {
  return storedJournalLegalOn(storedAtCurrentSemantics(journal));
}
