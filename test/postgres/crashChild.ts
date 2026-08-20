/**
 * The child process `crash.test.ts` kills: it takes a lease, writes, and then
 * waits to be killed at the seam its argument names.
 *
 * IT NEVER EXITS ON ITS OWN. Every seam ends in a wait that only a signal
 * ends, so the parent decides when the process dies rather than racing an
 * orderly shutdown it did not ask for. A child that exited by itself would
 * prove that a clean close is durable, which is not the claim.
 *
 * `commit` acknowledges every append and then waits, so the parent kills a
 * process whose writes the store has already promised are durable. `blocked`
 * acknowledges the first, then starts a second append behind a row lock it
 * holds on another connection, so the parent kills a process whose second write
 * never began. `inserted` opens that write's transaction itself and stops one
 * statement short of the head advance, so the parent kills a process between
 * the two writes one append makes. Between them they bound the answer: what was
 * acknowledged survives, and what was not leaves neither an entry nor a head.
 */

import type { Entry } from "../../src/actor/journal.ts";
import { journalChainDigest } from "../../src/adapters/postgres/digest.ts";
import { postgresOwnershipLock } from "../../src/adapters/postgres/ownership.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import {
  asOwnerId,
  asProjectId,
  asTenantId,
  type Lease,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { encodeEntry } from "../../src/interpreter/wire.ts";
import { postgresHarnessJournal } from "./harness.ts";

/** Waits for a signal and nothing else, which is how every seam ends. */
function crashChildWait(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Says what has happened, flushed line by line so the parent can act on it. */
function crashChildSay(what: string): void {
  process.stdout.write(`${what}\n`);
}

/** Takes the lease this child writes under, refusing to continue without one. */
async function crashChildLease(
  store: ReturnType<typeof postgresProjectStore>,
  partition: Partition,
  owner: string,
): Promise<Lease> {
  const acquired = await store.acquire(partition, asOwnerId(owner), 60);
  if (acquired.acquired !== "Granted") {
    throw new Error(`crash child: the lease was ${acquired.acquired}`);
  }
  return acquired.lease;
}

/**
 * Writes the row an append writes and stops there, on a connection whose
 * transaction only this process's death will end. The head advance is the
 * statement it deliberately never reaches.
 */
async function crashChildInsert(
  pool: ReturnType<typeof postgresPool>,
  lease: Lease,
  entry: Entry,
): Promise<void> {
  const client = await pool.connect();
  await client.query("BEGIN");
  const found = await client.query<{ entry_digest: string }>(
    "SELECT entry_digest FROM journal_entry WHERE tenant = $1 AND project = $2 AND seq = $3",
    [lease.partition.tenant, lease.partition.project, lease.head],
  );
  const previous = found.rows[0]?.entry_digest;
  if (previous === undefined) {
    throw new Error(
      `crash child: the project claims head ${String(lease.head)} with no entry there`,
    );
  }
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
}

const [, , url, tenant, project, owner, seam] = process.argv;
if (
  url === undefined ||
  tenant === undefined ||
  project === undefined ||
  owner === undefined ||
  seam === undefined
) {
  throw new Error(
    "crash child: usage is <url> <tenant> <project> <owner> <seam>",
  );
}

const pool = postgresPool(url);
const store = postgresProjectStore(pool);
const partition: Partition = {
  tenant: asTenantId(tenant),
  project: asProjectId(project),
};
const journal = postgresHarnessJournal();
let lease = await crashChildLease(store, partition, owner);

const first = journal[0];
const second = journal[1];
if (first === undefined || second === undefined) {
  throw new Error(
    "crash child: the fixture journal is shorter than the seams need",
  );
}

const committed = await store.append(lease, first);
if (committed.appended !== "Committed") {
  throw new Error(`crash child: the first append was ${committed.appended}`);
}
lease = { ...lease, head: committed.head };
crashChildSay(`committed ${String(committed.head)}`);

if (seam === "commit") {
  const also = await store.append(lease, second);
  if (also.appended !== "Committed") {
    throw new Error(`crash child: the second append was ${also.appended}`);
  }
  crashChildSay(`committed ${String(also.head)}`);
} else if (seam === "blocked") {
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await postgresOwnershipLock(blocker, partition);
  void store.append(lease, second);
  crashChildSay("blocked");
} else if (seam === "inserted") {
  await crashChildInsert(pool, lease, second);
  crashChildSay("inserted");
} else {
  throw new Error(`crash child: there is no seam named ${seam}`);
}

crashChildSay("waiting");
await crashChildWait();
