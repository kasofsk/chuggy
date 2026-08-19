/**
 * The expected-head journal append, and the load that replays it.
 *
 * ONE TRANSACTION CHECKS EVERYTHING AND THEN WRITES. Lifecycle, lease, fencing
 * epoch, recovery epoch and the expected head are all rechecked against the
 * locked partition row in the same transaction as the insert and the head
 * advance. A caller that verified them a moment earlier verified them against
 * a row another writer may since have taken, which is why the lease is an
 * argument rather than an assumption.
 *
 * THE HEAD AND THE SEQUENCE ARE THE SAME NUMBER. An entry's `seq` is the
 * project's head plus one, so the primary key that stores it is also the
 * concurrency control that guards it: two writers at the same head cannot both
 * insert, whichever of them the row lock releases first. A caller offering an
 * entry numbered anything else has a bug rather than a stale view, and gets an
 * error rather than a typed refusal.
 *
 * THE ENTRY IS STORED AS THE WIRE TEXT THE PORT PARSES BACK. The domain event
 * never becomes a database type, so the load passes the same schema the
 * in-memory store's does, and a row that no longer parses is refused by
 * returning rather than thrown on.
 *
 * WHAT THE LOAD DOES NOT DO IS VERIFY THE CHAIN. It checks shape, not
 * integrity: an edit that stays inside the schema — a ticket identity changed,
 * an entry removed from the middle — loads as `Ok` and replays as history. The
 * digests are written here so that format version one carries them, because a
 * chain added later is a migration over authoritative history; recomputing and
 * comparing them is project-local integrity containment, which 006 places at
 * slice I9 along with what a project fails closed into when the comparison
 * disagrees.
 */

import type pg from "pg";

import type { Entry } from "../../actor/journal.ts";
import type {
  Appended,
  Lease,
  Partition,
} from "../../interpreter/projectStore.ts";
import {
  encodeEntry,
  parseJournal,
  type Parsed,
} from "../../interpreter/wire.ts";
import { journalChainDigest, journalChainGenesis } from "./digest.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLockKnown,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowStanding } from "./rows.ts";

/** The digest the next entry chains onto: the head entry's, or the genesis label at an empty journal. */
async function postgresJournalPrevious(
  client: pg.PoolClient,
  partition: Partition,
  head: number,
): Promise<string> {
  if (head === 0) return journalChainGenesis;
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
async function postgresJournalWrite(
  client: pg.PoolClient,
  lease: Lease,
  entry: Entry,
): Promise<void> {
  const previous = await postgresJournalPrevious(
    client,
    lease.partition,
    lease.head,
  );
  await client.query(
    `INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch, recovery_epoch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      lease.partition.tenant,
      lease.partition.project,
      entry.seq,
      encodeEntry(entry),
      journalChainDigest(previous, entry),
      previous,
      lease.owner,
      lease.fencingEpoch,
      lease.recoveryEpoch,
    ],
  );
  await client.query(
    "UPDATE project SET head = $3 WHERE tenant = $1 AND project = $2",
    [lease.partition.tenant, lease.partition.project, entry.seq],
  );
}

/** Appends one entry if the lease is still honoured and the head is still where the caller left it. */
export async function postgresJournalAppend(
  pool: pg.Pool,
  lease: Lease,
  entry: Entry,
): Promise<Appended> {
  if (entry.seq !== lease.head + 1) {
    throw new Error(
      `postgres journal: entry ${String(entry.seq)} was offered against head ${String(lease.head)}`,
    );
  }
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    const standing = projectRowStanding(row);
    if (standing.lifecycle !== "Active") {
      return { appended: "NotActive", lifecycle: standing.lifecycle };
    }
    if (!(await postgresOwnershipHonours(client, row, lease))) {
      return { appended: "Fenced", fencingEpoch: standing.fencingEpoch };
    }
    if (standing.head !== lease.head) {
      return { appended: "StaleHead", head: standing.head };
    }
    await postgresJournalWrite(client, lease, entry);
    return { appended: "Committed", head: entry.seq };
  });
}

/** Every stored entry for the partition in sequence order, parsed here and refused rather than thrown. */
export async function postgresJournalLoad(
  pool: pg.Pool,
  partition: Partition,
): Promise<Parsed<readonly Entry[]>> {
  const found = await pool.query<{ entry: string }>(
    "SELECT entry FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq",
    [partition.tenant, partition.project],
  );
  const raw: unknown[] = [];
  for (const row of found.rows) {
    try {
      raw.push(JSON.parse(row.entry) as unknown);
    } catch {
      return {
        parsed: "Refused",
        why: `a stored row is not JSON: ${row.entry}`,
      };
    }
  }
  return parseJournal(raw);
}
