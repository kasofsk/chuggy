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
 * catches an entry removed from the middle, entries reordered, and a chain
 * spliced in from another partition. A journal cut short at its tail is not one
 * of them — a prefix of a valid chain is a valid chain — and is caught by the
 * apparatus around it instead: the head the project row claims, which the load
 * requires the entries to reach, and the recovery epoch, which fences the
 * writers a restore rewound.
 *
 * WHY THE PARTITION IS IN THE HASH. A chain over entries alone is self
 * consistent wherever it is kept, so rows copied into another tenant or
 * project with the key columns rewritten and the head moved to match verify
 * exactly as they did at home — and a mismatched restore is one of the things
 * 006 gives the chain to detect. The genesis is derived from the partition and
 * every digest carries it, so a grafted chain disagrees at its first entry
 * rather than wherever a verifier happens to start.
 *
 * WHAT IS HASHED IS SELF-DELIMITING. Each part is written after its own
 * length, because identities joined by a separator let one pair of them
 * produce another pair's bytes, and a digest is only as good as the input
 * nothing else can imitate.
 */

import { createHash } from "node:crypto";

import type { Entry } from "../../actor/journal.ts";
import type { DecisionCause } from "../../interpreter/projectDecision.ts";
import type { ConfigurationPin } from "../../interpreter/projectDecision.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { encodeEntry } from "../../interpreter/wire.ts";

/** Names the format these digests are of, so a chain cannot be read as a later one's. */
const journalChainFormat = "chuggy:journal:v1";
const journalEnvelopeFormat = "chuggy:journal-envelope:v2";

export interface JournalIntegrityEnvelope {
  readonly entry: Entry;
  readonly cause: DecisionCause;
  readonly configuration: ConfigurationPin;
  readonly eventSchemaVersion: 1;
  readonly decisionSemanticsVersion: 1;
}

/** Joins the parts as bytes no other list of parts produces, by writing each after its length. */
function journalChainInput(parts: readonly string[]): string {
  return parts.map((part) => `${String(part.length)}:${part}`).join("");
}

/**
 * The predecessor digest of the first entry in a partition. It is derived from
 * the partition rather than fixed, so a chain grafted from another one
 * disagrees at its first entry.
 */
export function journalChainGenesis(partition: Partition): string {
  return createHash("sha256")
    .update(
      journalChainInput([
        journalChainFormat,
        "genesis",
        partition.tenant,
        partition.project,
      ]),
    )
    .digest("hex");
}

/** The digest of one entry given its predecessor's, bound to the partition whose chain it is. */
export function journalChainDigest(
  partition: Partition,
  previous: string,
  entry: Entry,
): string {
  return createHash("sha256")
    .update(
      journalChainInput([
        journalChainFormat,
        partition.tenant,
        partition.project,
        previous,
        encodeEntry(entry),
      ]),
    )
    .digest("hex");
}

/** Covers every authoritative field of a newly written journal record. */
export function journalEnvelopeDigest(
  partition: Partition,
  previous: string,
  envelope: JournalIntegrityEnvelope,
): string {
  const configuration = envelope.configuration;
  return createHash("sha256")
    .update(
      journalChainInput([
        journalEnvelopeFormat,
        partition.tenant,
        partition.project,
        previous,
        encodeEntry(envelope.entry),
        envelope.cause.kind,
        envelope.cause.id,
        String(envelope.eventSchemaVersion),
        String(envelope.decisionSemanticsVersion),
        configuration.configurationRevision,
        configuration.configurationDigest,
      ]),
    )
    .digest("hex");
}
