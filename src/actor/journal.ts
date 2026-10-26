/**
 * The durable decision log: one `Entry` per decision, replay from `genesis`,
 * and the legality check the refinement obligation `journalLegal` asks.
 *
 * A ROW IS THE EVENT THE DECISION TOOK, and replay folds `evolve` over the
 * rows, and the ledgers' fold beside it over the same rows. No decider and no
 * policy is consulted again: the event already names
 * the edge a failing stage took, so a replay re-applies what happened rather
 * than re-deciding it, and the journal is a sufficient basis for the state
 * because nothing else ever entered one.
 *
 * A FOLD FROM GENESIS COSTS ITS ROWS, NOT ITS ROWS TIMES THE FLEET. An event
 * reads and moves only the ticket it names (`src/domain/evolve.ts`), so each
 * row is stepped over its `eventSlice` and written back into maps the fold
 * owns. `replayStep` over the whole fleet copies both maps, which only a caller
 * keeping the state before the row needs.
 *
 * LEGALITY IS WHAT A ROW COULD NOT BE IF IT WAS DECIDED. Its seq is the next
 * one, its ticket stands (a release's must not) and is the one any report or
 * definition it carries names, a work failure names the work task the ticket
 * is on, and its event moves the prefix it lands on. The last refuses no
 * decided row, because a decided event is never the identity
 * (`eventsNeverIdentity`, an invariant the model checks), and it refuses a
 * replayed row, a stale one and one for a task nothing owes alike — except a
 * work failure, which the package's `evolve` applies to a ticket in Work
 * whatever task it names, and which the check before it refuses instead. It
 * re-checks no decider's guard: a dispatch of a ticket whose dependency is not
 * Done moves the state and passes, so the check trusts that every row was
 * decided under its guard before it was written.
 *
 * A ROW CARRIES THE SEMANTICS IT WAS DECIDED UNDER, and this image has the
 * deciders for exactly one (`src/actor/decisionSemantics.ts`). A row declaring
 * another is refused below rather than replayed.
 */

import type {
  Entry,
  Ticket,
  TicketEvent,
  TicketGraph,
  TicketLedger,
} from "../domain/generated/modelTypes.ts";
import { eventSlice, eventTicket, evolve } from "../domain/evolve.ts";
import { graphEquals } from "../domain/equality.ts";
import { reportTicket } from "../domain/ticket.ts";
import { asTicketId } from "../domain/ids.ts";
import { evolveLedgers, type Ledgers } from "../domain/ledger.ts";
import { taskIdentityEquals, workTaskIdentity } from "../domain/task.ts";
import { ticketAt } from "../domain/ticketGraph.ts";
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

/** What a replay rebuilds: the graph and every ticket's ledger. */
export interface Replayed {
  readonly graph: TicketGraph;
  readonly ledgers: Ledgers;
}

/** One row folded onto a replay: `evolve` and the ledgers' fold, from the same prefix. */
export function replayStep(replayed: Replayed, event: TicketEvent): Replayed {
  return {
    graph: evolve(replayed.graph, event),
    ledgers: evolveLedgers(replayed.graph, replayed.ledgers, event),
  };
}

/**
 * Writes a row's evolved slice back into the fleet a fold owns. The slice
 * holds the ticket the row's event names or nothing, and anything else in it
 * is an event that moved a ticket it does not name.
 */
function storedReplayWrite<Value>(
  fleet: Map<number, Value>,
  slice: ReadonlyMap<number, Value>,
  event: TicketEvent,
): void {
  const named = eventTicket(event);
  for (const [id, value] of slice) {
    if (id !== named)
      throw new Error(
        `journal: a ${event.type} for ticket ${String(named)} moved ticket ${String(id)}`,
      );
    fleet.set(id, value);
  }
}

/**
 * Recovery: fold both over a stored history from `genesis`, each row stepping
 * its event's slice and writing it back. `eachRow` is handed every row with
 * its ticket's slice of the replay either side of it.
 */
export function storedReplay(
  stored: readonly StoredEntry[],
  eachRow: (entry: Entry, before: Replayed, after: Replayed) => void = () => {},
): Replayed {
  const tickets = new Map<number, Ticket>();
  const ledgers = new Map<number, TicketLedger>();
  for (const { entry } of stored) {
    const ticket = eventTicket(entry.event);
    const ledger = ledgers.get(ticket);
    const before: Replayed = {
      graph: eventSlice({ tickets }, entry.event),
      ledgers: new Map(ledger === undefined ? [] : [[ticket, ledger]]),
    };
    const after = replayStep(before, entry.event);
    storedReplayWrite(tickets, after.graph.tickets, entry.event);
    storedReplayWrite(ledgers, after.ledgers, entry.event);
    eachRow(entry, before, after);
  }
  return { graph: { tickets }, ledgers };
}

/** Recovery: fold both over the journal's events from `genesis`. */
export function replayJournal(journal: readonly Entry[]): Replayed {
  return storedReplay(storedAtCurrentSemantics(journal));
}

/** The graph a stored history replays to. */
export function storedReplayGraph(stored: readonly StoredEntry[]): TicketGraph {
  return storedReplay(stored).graph;
}

/** The graph the journal replays to. */
export function replayGraph(journal: readonly Entry[]): TicketGraph {
  return replayJournal(journal).graph;
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
 * Whether the report or the definition an event carries names the ticket the
 * event moves, which holds of every event carrying neither.
 */
export function eventPayloadTicketAgrees(event: TicketEvent): boolean {
  switch (event.type) {
    case "TicketUpdated":
      return event.value.definition.id === event.value.ticket;
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationBlocked":
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
      return reportTicket(event.value.report) === eventTicket(event);
    case "TicketCreated":
    case "TicketDispatched":
    case "TicketRevoked":
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
    case "TicketWorkResultAccepted":
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable":
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return true;
  }
}

/**
 * Whether a work failure names the work task its ticket is on at `graph`,
 * which holds of every event that is not one. The ticket must stand.
 */
export function failureTaskCurrent(
  graph: TicketGraph,
  event: TicketEvent,
): boolean {
  if (
    event.type !== "TicketWorkProcessFailed" &&
    event.type !== "TicketWorkExecutionUnavailable"
  )
    return true;
  const { ticket, task } = event.value;
  return taskIdentityEquals(
    task,
    workTaskIdentity(
      ticket,
      ticketAt(graph, asTicketId(ticket)).workCyclesStarted,
    ),
  );
}

/**
 * Whether a stored history replays with no inert row: this image's semantics
 * on every row, dense seqs, every event's ticket standing at its replayed
 * prefix and named by the report or definition it carries, every work
 * failure naming the current work task, and every event moving that prefix.
 * Each check reads the row's ticket alone, so each is asked of the event's
 * slice of the prefix, as `storedReplay` steps it.
 */
export function storedJournalLegalOn(stored: readonly StoredEntry[]): boolean {
  const tickets = new Map<number, Ticket>();
  let next = 1;
  for (const row of stored) {
    const replayed = eventSlice({ tickets }, row.entry.event);
    if (
      row.semantics !== decisionSemanticsVersionCurrent ||
      row.entry.seq !== next ||
      !eventTicketStands(replayed, row.entry.event) ||
      !eventPayloadTicketAgrees(row.entry.event) ||
      !failureTaskCurrent(replayed, row.entry.event)
    ) {
      return false;
    }
    const evolved = evolve(replayed, row.entry.event);
    if (graphEquals(evolved, replayed)) return false;
    storedReplayWrite(tickets, evolved.tickets, row.entry.event);
    next += 1;
  }
  return true;
}

/** Whether a history this image decided whole is a legal domain trace, as the model asks it. */
export function journalLegalOn(journal: readonly Entry[]): boolean {
  return storedJournalLegalOn(storedAtCurrentSemantics(journal));
}
