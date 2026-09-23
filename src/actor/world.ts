/**
 * The world accounting the refinement obligations are priced in: which
 * decisions the world received, counted by decision identity.
 *
 * What the world does with an emission is the trusted fabric's; what the
 * obligations need is arithmetic over which decisions reached it. A spawn is
 * an event that starts a work cycle and so owes its work task — a dispatch,
 * both reworks and the work resume; a completion is the finalization's
 * success. Each is attributed to the ticket its event names.
 *
 * An emitted journal row counts once however many times its seq re-emitted,
 * because the received set is keyed by seq; every orphan counts on its own,
 * because an orphan has no seq to absorb against. That asymmetry is the entire
 * price of the effect-first hazard, stated as arithmetic.
 */

import type { TicketEvent } from "../domain/generated/modelTypes.ts";
import { eventTicket } from "../domain/evolve.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Entry } from "./journal.ts";
import type { ActorState } from "./state.ts";

/** Whether this event starts a work cycle for the ticket. */
export function isSpawnFor(event: TicketEvent, ticket: TicketId): boolean {
  if (eventTicket(event) !== ticket) return false;
  switch (event.type) {
    case "TicketDispatched":
    case "TicketWorkResumed":
    case "TicketEvaluationReworkStarted":
    case "TicketFinalizationNeedsWork":
      return true;
    case "TicketCreated":
    case "TicketRevoked":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
    case "TicketWorkResultAccepted":
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable":
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationBlocked":
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationUnavailable":
      return false;
  }
}

/** Whether this event lands the ticket's diff. */
export function isCompletionFor(event: TicketEvent, ticket: TicketId): boolean {
  return (
    eventTicket(event) === ticket &&
    event.type === "TicketFinalizationSucceeded"
  );
}

/** Distinct decisions the world received for the ticket: emitted rows by position, plus every orphan. */
function worldCountOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly TicketEvent[],
  ticket: TicketId,
  counts: (event: TicketEvent, subject: TicketId) => boolean,
): number {
  return (
    journal.filter(
      (entry, index) =>
        worldEffects.has(index + 1) && counts(entry.event, ticket),
    ).length + orphans.filter((event) => counts(event, ticket)).length
  );
}

/** Decisions the journal records for the ticket, emitted yet or not: the book the world must never exceed. */
function journalCountOn(
  journal: readonly Entry[],
  ticket: TicketId,
  counts: (event: TicketEvent, subject: TicketId) => boolean,
): number {
  return journal.filter((entry) => counts(entry.event, ticket)).length;
}

export function worldSpawnsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly TicketEvent[],
  ticket: TicketId,
): number {
  return worldCountOn(journal, worldEffects, orphans, ticket, isSpawnFor);
}

export function worldCompletionsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly TicketEvent[],
  ticket: TicketId,
): number {
  return worldCountOn(journal, worldEffects, orphans, ticket, isCompletionFor);
}

export function journalSpawnsOn(
  journal: readonly Entry[],
  ticket: TicketId,
): number {
  return journalCountOn(journal, ticket, isSpawnFor);
}

export function journalCompletionsOn(
  journal: readonly Entry[],
  ticket: TicketId,
): number {
  return journalCountOn(journal, ticket, isCompletionFor);
}

/** The same counts over a live actor state, which is how the obligations and the suites read them. */
export function worldSpawns(state: ActorState, ticket: TicketId): number {
  return worldSpawnsOn(
    state.journal,
    state.worldEffects,
    state.orphans,
    ticket,
  );
}

export function worldCompletions(state: ActorState, ticket: TicketId): number {
  return worldCompletionsOn(
    state.journal,
    state.worldEffects,
    state.orphans,
    ticket,
  );
}

export function journalSpawns(state: ActorState, ticket: TicketId): number {
  return journalSpawnsOn(state.journal, ticket);
}

export function journalCompletions(
  state: ActorState,
  ticket: TicketId,
): number {
  return journalCompletionsOn(state.journal, ticket);
}
