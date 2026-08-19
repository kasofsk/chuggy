/**
 * The per-project digest chain, computed from the canonical wire encoding of
 * the complete entry rather than from anything the database renders.
 *
 * WHY NOT `row_to_json` OR A COLUMN HASH. PostgreSQL is free to change how it
 * spaces, orders and numbers its JSON output, and a digest that moved with a
 * server upgrade would report tampering on an untouched journal.
 * `encodeEntry` is the versioned encoder that fixes object, set, numeric and
 * string representation, and it is already what every stored row is written
 * from, so the digest covers exactly the bytes the load parses back.
 *
 * WHY THE CHAIN AND NOT A PER-ROW DIGEST. A per-row digest catches an edited
 * payload and nothing else; chaining each digest onto its predecessor also
 * catches truncation, reordering and a restore spliced onto the wrong
 * history, which are the failures a backup actually produces.
 */

import { createHash } from "node:crypto";

import type { Entry } from "../../actor/journal.ts";
import { encodeEntry } from "../../interpreter/wire.ts";

/**
 * The predecessor digest of the first entry in a project. It is a fixed label
 * rather than an empty string so a chain that lost its head cannot be mistaken
 * for one that never had entries.
 */
export const journalChainGenesis = "chuggy:journal:genesis:v1";

/** The digest of one entry given its predecessor's, which is what makes the chain a chain. */
export function journalChainDigest(previous: string, entry: Entry): string {
  return createHash("sha256")
    .update(previous)
    .update("\n")
    .update(encodeEntry(entry))
    .digest("hex");
}
