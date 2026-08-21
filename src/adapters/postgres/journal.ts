/**
 * The journal write, and the load that replays it.
 *
 * THE WRITE IS NOT A TRANSACTION AND HAS NO CALLER BUT ONE. Lifecycle, lease,
 * fencing epoch, recovery epoch and the expected head are rechecked against
 * the locked partition row by `./decision.ts`, which then calls this in the
 * same transaction as the operation outcome, the acknowledgement and the
 * projection. Splitting the checks from the insert here would put them a
 * commit apart, and a caller that verified them a moment earlier verified them
 * against a row another writer may since have taken.
 *
 * THE HEAD AND THE SEQUENCE ARE THE SAME NUMBER. An entry's `seq` is the
 * project's head plus one, so the primary key that stores it is also the
 * concurrency control that guards it: two writers at the same head cannot both
 * insert, whichever of them the row lock releases first. A caller offering an
 * entry numbered anything else has a bug rather than a stale view, and gets an
 * error rather than a typed refusal.
 *
 * THE LOAD TAKES THE SAME LOCK AND THE SAME LEASE. It replays under the tenure
 * the decision will commit in, so a lease the row no longer honours is refused
 * rather than served a prefix.
 *
 * THE ENTRY IS STORED AS THE WIRE TEXT THE PORT PARSES BACK. The domain event
 * never becomes a database type, so the load passes the same schema the
 * in-memory store's does, and a row that no longer parses is refused by
 * returning rather than thrown on.
 *
 * WHAT THE LOAD REQUIRES OF A HISTORY. Stored entries must reach the locked
 * head. Version-two rows must also form the complete-envelope chain written by
 * this adapter, including their direct cause and release configuration. Rows
 * predating that envelope retain version one: their stored digest remains the
 * predecessor of later rows, but cannot retroactively attest to fields it never
 * covered. Turning a verification failure into project-local containment is
 * still I9's responsibility; this boundary refuses to replay the bad record.
 */

import type pg from "pg";

import type { Entry } from "../../actor/journal.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  DecisionCause,
  DraftReleaseFence,
} from "../../interpreter/projectDecision.ts";
import type {
  Lease,
  Partition,
  ProjectStanding,
} from "../../interpreter/projectStore.ts";
import {
  encodeEntry,
  parseJournal,
  type Parsed,
} from "../../interpreter/wire.ts";
import {
  journalChainGenesis,
  journalEnvelopeDigest,
  type JournalIntegrityEnvelope,
} from "./digest.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLockKnown,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowStanding } from "./rows.ts";

interface StoredJournalRow {
  readonly entry: string;
  readonly entry_digest: string;
  readonly prev_digest: string;
  readonly integrity_version: number;
  readonly cause_kind: string;
  readonly cause_id: string;
  readonly release_configuration_revision: string | null;
  readonly release_configuration_digest: string | null;
}

async function storedJournalRows(
  client: pg.PoolClient,
  partition: Partition,
): Promise<readonly StoredJournalRow[]> {
  const { tenant, project } = partition;
  return (
    await client.query<StoredJournalRow>(
      `SELECT entry,entry_digest,prev_digest,integrity_version,cause_kind,cause_id,
       release_configuration_revision,release_configuration_digest
       FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq`,
      [tenant, project],
    )
  ).rows;
}

/** The digest the next entry chains onto: the head entry's, or the partition's genesis at an empty journal. */
async function postgresJournalPrevious(
  client: pg.PoolClient,
  partition: Partition,
  head: number,
): Promise<string> {
  if (head === 0) return journalChainGenesis(partition);
  const found = await client.query<{ entry_digest: string }>(
    "SELECT entry_digest FROM journal_entry WHERE tenant = $1 AND project = $2 AND seq = $3",
    [partition.tenant, partition.project, head],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres journal: ${partition.tenant}/${partition.project} claims head ${String(head)} with no entry there`,
    );
  }
  return row.entry_digest;
}

/** Inserts the entry and advances the head, which are one write as far as any reader is concerned. */
export async function postgresJournalWrite(
  client: pg.PoolClient,
  lease: Lease,
  entry: Entry,
  cause: DecisionCause,
  release?: DraftReleaseFence,
): Promise<void> {
  if (entry.seq !== lease.head + 1) {
    throw new Error(
      `postgres journal: entry ${String(entry.seq)} was offered against head ${String(lease.head)}`,
    );
  }
  const previous = await postgresJournalPrevious(
    client,
    lease.partition,
    lease.head,
  );
  if ((entry.event.type === "ReleaseTicket") !== (release !== undefined)) {
    throw new Error(
      "postgres journal: a release entry and its configuration provenance must be written together",
    );
  }
  const envelope: JournalIntegrityEnvelope = {
    entry,
    cause,
    ...(release === undefined ? {} : { release }),
    eventSchemaVersion: 1,
    decisionSemanticsVersion: 1,
  };
  await client.query(
    `INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
        recovery_epoch, cause_kind, cause_id, release_configuration_revision,
        release_configuration_digest, integrity_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 2)`,
    [
      lease.partition.tenant,
      lease.partition.project,
      entry.seq,
      encodeEntry(entry),
      journalEnvelopeDigest(lease.partition, previous, envelope),
      previous,
      lease.owner,
      lease.fencingEpoch,
      lease.recoveryEpoch,
      cause.kind,
      cause.id,
      release?.configurationRevision ?? null,
      release?.configurationDigest ?? null,
    ],
  );
  await client.query(
    "UPDATE project SET head = $3 WHERE tenant = $1 AND project = $2",
    [lease.partition.tenant, lease.partition.project, entry.seq],
  );
}

/** Every stored entry in sequence order, asserted to reach the head the locked row claims. */
async function postgresJournalEntries(
  client: pg.PoolClient,
  standing: ProjectStanding,
): Promise<Parsed<readonly Entry[]>> {
  const { tenant, project } = standing.partition;
  const rows = await storedJournalRows(client, standing.partition);
  if (rows.length !== standing.head) {
    throw new Error(
      `postgres journal: ${tenant}/${project} claims head ${String(standing.head)} over ${String(rows.length)} stored entries`,
    );
  }
  const raw: unknown[] = [];
  let previous = journalChainGenesis(standing.partition);
  for (const row of rows) {
    try {
      const decoded = JSON.parse(row.entry) as unknown;
      const parsed = parseJournal([decoded]);
      if (parsed.parsed === "Refused") return parsed;
      const entry = parsed.value[0];
      if (entry === undefined) throw new Error("parsed journal row is absent");
      if (row.integrity_version === 2) {
        const cause: DecisionCause | undefined =
          row.cause_kind === "Operation"
            ? { kind: "Operation", id: asOperationId(row.cause_id) }
            : row.cause_kind === "Continuation"
              ? { kind: "Continuation", id: row.cause_id }
              : undefined;
        const release =
          row.release_configuration_revision !== null &&
          row.release_configuration_digest !== null
            ? {
                configurationRevision: row.release_configuration_revision,
                configurationDigest: row.release_configuration_digest,
              }
            : undefined;
        if (
          cause === undefined ||
          (entry.event.type === "ReleaseTicket") !== (release !== undefined) ||
          row.prev_digest !== previous ||
          journalEnvelopeDigest(standing.partition, previous, {
            entry,
            cause,
            ...(release === undefined ? {} : { release }),
            eventSchemaVersion: 1,
            decisionSemanticsVersion: 1,
          }) !== row.entry_digest
        ) {
          return {
            parsed: "Refused",
            why: "a stored journal envelope failed integrity verification",
          };
        }
      }
      raw.push(decoded);
      previous = row.entry_digest;
    } catch {
      return {
        parsed: "Refused",
        why: `a stored row is not JSON: ${row.entry}`,
      };
    }
  }
  return parseJournal(raw);
}

/** Replays the partition under the lease the decision will present, refusing one the row no longer honours. */
export async function postgresJournalLoad(
  pool: pg.Pool,
  lease: Lease,
): Promise<Parsed<readonly Entry[]>> {
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    if (!(await postgresOwnershipHonours(client, row, lease))) {
      const { tenant, project } = lease.partition;
      return {
        parsed: "Refused",
        why: `the lease on ${tenant}/${project} is no longer honoured, so a replay under it would begin outside its tenure`,
      };
    }
    return postgresJournalEntries(client, projectRowStanding(row));
  });
}
