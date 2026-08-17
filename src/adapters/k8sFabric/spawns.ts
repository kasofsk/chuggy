/**
 * The fabric's one table in the one database, created here and owned by this
 * adapter alone: the emission keys it has fully served.
 *
 * IT ABSORBS ON THE EMISSION KEY, first write wins, and it exists because the
 * Job names alone cannot keep the ports' promise past garbage collection: a
 * finished Job is collected, and a key that dies with its object would let an
 * old re-emission double-spawn. The row is what outlives the object, so a
 * served key short-circuits a re-delivery however long ago its Jobs went.
 */

import type { DatabaseSync } from "node:sqlite";

/** What the table can be told and asked; the write absorbs on its key. */
export interface FabricSpawns {
  readonly served: (key: string) => boolean;
  readonly record: (key: string) => void;
}

const fabricSpawnsSchema = `
  CREATE TABLE IF NOT EXISTS fabric_spawns (
    emission_key TEXT PRIMARY KEY
  ) STRICT;
`;

/** The table over an open connection, created here and owned alone. */
export function fabricSpawns(db: DatabaseSync): FabricSpawns {
  db.exec(fabricSpawnsSchema);
  const insert = db.prepare(
    "INSERT INTO fabric_spawns (emission_key) VALUES (?) ON CONFLICT (emission_key) DO NOTHING",
  );
  const select = db.prepare(
    "SELECT emission_key FROM fabric_spawns WHERE emission_key = ?",
  );
  return {
    served: (key) => select.get(key) !== undefined,
    record: (key) => {
      insert.run(key);
    },
  };
}
