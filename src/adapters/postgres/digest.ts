/**
 * The per-project digest chain, computed from the entry text the row stores
 * rather than from anything the database renders.
 *
 * WHY THE STORED TEXT AND NOT A RE-ENCODING OF THE PARSED ENTRY. What the
 * chain attests is that these bytes are the bytes that were written, and
 * `encodeEntry` is the model's encoder: a model whose event shape changes — a
 * field dropped, a payload widened — re-encodes an old row into bytes nobody
 * ever stored, so every row written before the change would read as tampered.
 * Digesting the column also covers a tampering the encoder would normalise
 * away, such as a key the current schema strips.
 *
 * WHY NOT `row_to_json` OR A COLUMN HASH. PostgreSQL is free to change how it
 * spaces, orders and numbers its JSON output, and a digest that moved with a
 * server upgrade would report tampering on an untouched journal. `entry` is a
 * text column written from the versioned encoder, so its bytes are fixed at
 * the write and the server renders nothing.
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

import type { DecisionCause } from "../../interpreter/projectDecision.ts";
import type { ConfigurationPin } from "../../interpreter/projectDecision.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** The content address of one canonical authored configuration revision. */
export function configurationRevisionDigest(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Names the format these digests are of, so a chain cannot be read as a later one's. */
const journalChainFormat = "chuggy:journal:v1";
const journalEnvelopeFormat = "chuggy:journal-envelope:v2";

export interface JournalIntegrityEnvelope {
  /** The entry as the row stores it, which is what the encoder wrote. */
  readonly entryText: string;
  readonly cause: DecisionCause;
  readonly configuration: ConfigurationPin;
  readonly eventSchemaVersion: number;
  readonly decisionSemanticsVersion: number;
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
  entryText: string,
): string {
  return createHash("sha256")
    .update(
      journalChainInput([
        journalChainFormat,
        partition.tenant,
        partition.project,
        previous,
        entryText,
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
        envelope.entryText,
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
