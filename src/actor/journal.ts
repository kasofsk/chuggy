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
 * A ROW IS RE-DERIVED BY THE MACHINE THAT DECIDED IT. A store keeps the
 * decision semantics beside each entry, so a history spanning a semantics
 * change replays row by row under its own — `journalLegalOn` and `replayCore`
 * are the same folds over a history this image decided whole, which is every
 * journal `model/` describes.
 *
 * DESCENDING SEMANTICS IS REFUSED, for the same reason it cannot occur: an
 * image writes one version, so a row decided under an older machine than the
 * row before it is a history no deployment took, and replaying it would offer
 * an older decider a state only a newer one can reach.
 */

import type { Config } from "../domain/config.ts";
import type { Core, StepRecord } from "../domain/generated/modelTypes.ts";
import { decisionEventEnabled, type DecisionEvent } from "./decisionEvent.ts";
import {
  decisionSemanticsVersionCurrent,
  execDecisionEventAt,
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
export const genesis: Core = { tickets: new Map() };

/** A history this image decided whole, which is what an in-memory actor and the model both hold. */
export function storedAtCurrentSemantics(
  journal: readonly Entry[],
): readonly StoredEntry[] {
  return journal.map((entry) => ({
    entry,
    semantics: decisionSemanticsVersionCurrent,
  }));
}

/** Recovery: replay a stored history into a fresh state, each row under its own semantics. */
export function storedReplayCore(
  config: Config,
  stored: readonly StoredEntry[],
): Core {
  return stored.reduce(
    (core, row) =>
      execDecisionEventAt(row.semantics, config, core, row.entry.event).post,
    genesis,
  );
}

/** Recovery: replay the journal into a fresh state, one decision at a time from `genesis`. */
export function replayCore(config: Config, journal: readonly Entry[]): Core {
  return storedReplayCore(config, storedAtCurrentSemantics(journal));
}

/**
 * Whether a stored history is a legal domain trace: non-descending semantics,
 * dense seqs, every decision enabled at its replayed prefix, every record
 * reproduced by the decider that wrote it.
 *
 * Enablement is checked before the decider runs, because deciders assume their
 * guards — a tampered journal is refused, never crashed on.
 */
export function storedJournalLegalOn(
  config: Config,
  stored: readonly StoredEntry[],
): boolean {
  let replayed = genesis;
  let next = 1;
  let semantics: DecisionSemanticsVersion = 1;
  for (const row of stored) {
    if (
      row.semantics < semantics ||
      row.entry.seq !== next ||
      !decisionEventEnabled(config, replayed, row.entry.event)
    ) {
      return false;
    }
    const decision = execDecisionEventAt(
      row.semantics,
      config,
      replayed,
      row.entry.event,
    );
    if (!recordEquals(decision.rec, row.entry.rec)) return false;
    replayed = decision.post;
    semantics = row.semantics;
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
