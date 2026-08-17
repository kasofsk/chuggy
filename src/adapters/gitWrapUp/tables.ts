/**
 * The performer's two tables in the one database, created here and owned by
 * this adapter alone: the instructions it was handed, and the attempts it
 * concluded.
 *
 * BOTH ABSORB ON THE EMISSION KEY, first write wins, which is the ports'
 * promise in the same shape the desk keeps it. The notices are the advisory
 * record — the true queue is derived from the core, so a notice is audit and
 * nothing more. An attempts row is written only when an attempt CONCLUDES: it
 * is what lets a re-delivered gate instruction re-answer the same attempt's
 * outcome instead of running a second distinct attempt, while an attempt that
 * crashed before concluding left no row and legitimately re-runs — the
 * ancestor check is what keeps that re-run from re-merging.
 */

import type { DatabaseSync } from "node:sqlite";

import type { Effect } from "../../domain/effect.ts";
import type { WrapUpOutcome } from "../../domain/wrapUp.ts";
import { emissionKey, type Emission } from "../../interpreter/ports.ts";

/** What the adapter's tables can be told and asked; every write absorbs on its key. */
export interface WrapUpTables {
  readonly notice: (effect: Effect, emission: Emission) => void;
  readonly concludedOf: (key: string) => WrapUpOutcome | undefined;
  readonly conclude: (
    key: string,
    outcome: WrapUpOutcome,
    detail: string,
  ) => void;
}

const wrapUpTablesSchema = `
  CREATE TABLE IF NOT EXISTS wrapup_notices (
    emission_key TEXT PRIMARY KEY,
    effect TEXT NOT NULL,
    ticket INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS wrapup_attempts (
    emission_key TEXT PRIMARY KEY,
    outcome TEXT NOT NULL,
    detail TEXT NOT NULL
  ) STRICT;
`;

/** Reads a stored outcome back as the constructor it was, refusing a row some other writer bent. */
function wrapUpTablesOutcome(stored: unknown): WrapUpOutcome {
  if (stored === "WOk" || stored === "WFailed") return stored;
  throw new Error(
    `gitWrapUp: a stored attempt holds ${String(stored)}, which is no outcome this machine draws`,
  );
}

/** The two tables over an open connection, created here and owned alone. */
export function wrapUpTables(db: DatabaseSync): WrapUpTables {
  db.exec(wrapUpTablesSchema);
  const insertNotice = db.prepare(
    "INSERT INTO wrapup_notices (emission_key, effect, ticket) VALUES (?, ?, ?) ON CONFLICT (emission_key) DO NOTHING",
  );
  const selectAttempt = db.prepare(
    "SELECT outcome FROM wrapup_attempts WHERE emission_key = ?",
  );
  const insertAttempt = db.prepare(
    "INSERT INTO wrapup_attempts (emission_key, outcome, detail) VALUES (?, ?, ?) ON CONFLICT (emission_key) DO NOTHING",
  );
  return {
    notice: (effect, emission) => {
      insertNotice.run(emissionKey(emission), effect, emission.ticket);
    },
    concludedOf: (key) => {
      const row = selectAttempt.get(key);
      return row === undefined
        ? undefined
        : wrapUpTablesOutcome(row["outcome"]);
    },
    conclude: (key, outcome, detail) => {
      insertAttempt.run(key, outcome, detail);
    },
  };
}
