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
 * holds on another connection, so the parent kills a process whose write
 * cannot have committed. Between them they bound the answer: what was
 * acknowledged survives, and what was not leaves nothing.
 */

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

if (seam === "blocked") {
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await postgresOwnershipLock(blocker, partition);
  void store.append(lease, second);
  crashChildSay("blocked");
} else {
  const also = await store.append(lease, second);
  if (also.appended !== "Committed") {
    throw new Error(`crash child: the second append was ${also.appended}`);
  }
  crashChildSay(`committed ${String(also.head)}`);
}

crashChildSay("waiting");
await crashChildWait();
