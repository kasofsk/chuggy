/**
 * The durable decision log: one `Entry` per decision, replay from `genesis`,
 * and the legality check the refinement obligation `journalLegal` asks.
 *
 * A row carries the decision event and the record it produced when first
 * decided. The record is derivable from the event — `journalLegalOn` proves
 * exactly that, row by row — so storing both makes the consistency a checked
 * claim instead of a storage convention, which is the model's own choice.
 *
 * REPLAY IS DETERMINISTIC BY PURITY: `execCmd` is a pure function, so the fold
 * has one result, and that is the whole mechanism behind recovery — the
 * journal is a sufficient basis for the state because nothing else ever
 * entered a decision.
 */

import type { Config } from "../domain/config.ts";
import type { Core, StepRecord } from "../domain/core.ts";
import { cmdEnabled, execCmd, type Cmd } from "./command.ts";
import { recordEquals } from "./equality.ts";

/** One journal row: dense monotone seq, the decision event, and its record. */
export interface Entry {
  readonly seq: number;
  readonly cmd: Cmd;
  readonly rec: StepRecord;
}

/** The journal's base state: the machine's init fleet, empty. */
export const genesis: Core = { tickets: new Map() };

/** Recovery: replay the journal into a fresh state, one decision at a time from `genesis`. */
export function replayCore(config: Config, journal: readonly Entry[]): Core {
  return journal.reduce(
    (core, entry) => execCmd(config, core, entry.cmd).post,
    genesis,
  );
}

/**
 * Whether the journal is a legal domain trace: dense seqs, every decision
 * enabled at its replayed prefix, every record reproduced by the decider.
 * Enablement is checked before the decider runs, because deciders assume their
 * guards — a tampered journal is refused, never crashed on.
 */
export function journalLegalOn(
  config: Config,
  journal: readonly Entry[],
): boolean {
  let replayed = genesis;
  let next = 1;
  for (const entry of journal) {
    if (entry.seq !== next || !cmdEnabled(config, replayed, entry.cmd)) {
      return false;
    }
    const decision = execCmd(config, replayed, entry.cmd);
    if (!recordEquals(decision.rec, entry.rec)) return false;
    replayed = decision.post;
    next += 1;
  }
  return true;
}
