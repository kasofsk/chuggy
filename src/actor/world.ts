/**
 * The world accounting the refinement obligations are priced in: which
 * decisions the world received, counted by decision identity.
 *
 * What the world does with an emission is the trusted fabric's; what the
 * obligations need is arithmetic over which decisions reached it. A spawn is a
 * record carrying the paid task fan-out effect; a completion is the ticket's
 * single landing step. Attribution is the record's head transition — the
 * stepped ticket — exactly as the model states it; the interpreter's
 * per-effect subject routing is a different question and a different layer.
 *
 * An emitted journal row counts once however many times its seq re-emitted,
 * because the received set is keyed by seq; every orphan counts on its own,
 * because an orphan has no seq to absorb against. That asymmetry is the entire
 * price of the effect-first hazard, stated as arithmetic.
 */

import type { StepRecord } from "../domain/core.ts";
import type { Effect } from "../domain/effect.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Entry } from "./journal.ts";
import type { ActorState } from "./state.ts";

/** Whether the record asks the world for this effect. */
export function hasEffect(rec: StepRecord, effect: Effect): boolean {
  return rec.effects.includes(effect);
}

/** Whether the record's head transition steps this ticket. */
export function stepsTicket(rec: StepRecord, ticket: TicketId): boolean {
  const first = rec.transitions[0];
  return first !== undefined && first.ticket === ticket;
}

/** A paid task fan-out for this ticket. */
export function isSpawnFor(rec: StepRecord, ticket: TicketId): boolean {
  return hasEffect(rec, "SpawnWorkTasks") && stepsTicket(rec, ticket);
}

/** This ticket's single landing step. */
export function isCompletionFor(rec: StepRecord, ticket: TicketId): boolean {
  return rec.label === "ticket-done" && stepsTicket(rec, ticket);
}

/** Distinct decisions the world received for the ticket: emitted rows by position, plus every orphan. */
function worldCountOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
  ticket: TicketId,
  counts: (rec: StepRecord, subject: TicketId) => boolean,
): number {
  return (
    journal.filter(
      (entry, index) =>
        worldEffects.has(index + 1) && counts(entry.rec, ticket),
    ).length + orphans.filter((rec) => counts(rec, ticket)).length
  );
}

/** Decisions the journal records for the ticket, emitted yet or not: the book the world must never exceed. */
function journalCountOn(
  journal: readonly Entry[],
  ticket: TicketId,
  counts: (rec: StepRecord, subject: TicketId) => boolean,
): number {
  return journal.filter((entry) => counts(entry.rec, ticket)).length;
}

export function worldSpawnsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
  ticket: TicketId,
): number {
  return worldCountOn(journal, worldEffects, orphans, ticket, isSpawnFor);
}

export function worldCompletionsOn(
  journal: readonly Entry[],
  worldEffects: ReadonlySet<number>,
  orphans: readonly StepRecord[],
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
