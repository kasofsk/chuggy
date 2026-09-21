/**
 * The durable decision log: one `Entry` per decision, replay from `genesis`,
 * and the legality check the refinement obligation `journalLegal` asks.
 *
 * A row carries the decision event and the record it produced when first
 * decided. The record is derivable from the event — `journalLegalOn` proves
 * exactly that, row by row — so storing both makes the consistency a checked
 * claim instead of a storage convention, which is the model's own choice.
 *
 * REPLAY IS DETERMINISTIC BY PURITY: `execDecisionEvent` is a pure function, so the fold
 * has one result, and that is the whole mechanism behind recovery — the
 * journal is a sufficient basis for the state because nothing else ever
 * entered a decision.
 *
 * A ROW CARRIES THE SEMANTICS IT WAS DECIDED UNDER, and this image has the
 * deciders for exactly one (`src/actor/decisionSemantics.ts`). A row declaring
 * another is refused below rather than replayed. A rolling deploy runs two
 * images at once, and each refuses the other's rows on read while both demand
 * a single version, which is what makes the refusal total rather than a
 * restatement of a guarantee held elsewhere.
 */

import type { Config } from "../domain/config.ts";
import type {
  TicketGraph,
  StepRecord,
} from "../domain/generated/modelTypes.ts";
import {
  decisionEventEnabled,
  execDecisionEvent,
  type DecisionEvent,
} from "./decisionEvent.ts";
import {
  decisionSemanticsVersionCurrent,
  type DecisionSemanticsVersion,
} from "./decisionSemantics.ts";
import { recordEquals } from "./equality.ts";

/** One journal row: dense monotone seq, the decision event, and its record. */
export interface Entry {
  readonly seq: number;
  readonly event: DecisionEvent;
  readonly rec: StepRecord;
}

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

/** Recovery: replay a stored history into a fresh state, one decision at a time. */
export function storedReplayGraph(stored: readonly StoredEntry[]): TicketGraph {
  return stored.reduce(
    (graph, row) => execDecisionEvent(graph, row.entry.event).post,
    genesis,
  );
}

/** Recovery: replay the journal into a fresh state, one decision at a time from `genesis`. */
export function replayGraph(journal: readonly Entry[]): TicketGraph {
  return storedReplayGraph(storedAtCurrentSemantics(journal));
}

/**
 * Whether a stored history is a legal domain trace: this image's semantics on
 * every row, dense seqs, every decision enabled at its replayed prefix, every
 * record reproduced by the decider that wrote it. Enablement is checked before
 * the decider runs, because deciders assume their guards.
 */
export function storedJournalLegalOn(
  config: Config,
  stored: readonly StoredEntry[],
): boolean {
  let replayed = genesis;
  let next = 1;
  for (const row of stored) {
    if (
      row.semantics !== decisionSemanticsVersionCurrent ||
      row.entry.seq !== next ||
      !decisionEventEnabled(config, replayed, row.entry.event)
    ) {
      return false;
    }
    const decision = execDecisionEvent(replayed, row.entry.event);
    if (!recordEquals(decision.rec, row.entry.rec)) return false;
    replayed = decision.post;
    next += 1;
  }
  return true;
}

/** Whether a history this image decided whole is a legal domain trace, as the model asks it. */
export function journalLegalOn(
  config: Config,
  journal: readonly Entry[],
): boolean {
  return storedJournalLegalOn(config, storedAtCurrentSemantics(journal));
}
