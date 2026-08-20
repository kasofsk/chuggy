/**
 * The child process `crash.test.ts` kills: it does the work its argument names
 * and then waits to be killed at that seam.
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
 *
 * `accepted` and `unaccepted` are the same pair for the submission side, and
 * they take no lease at all — acceptance is the API's transaction and 006
 * requires it to work with no owner anywhere near the project. The submission
 * is derived from the partition rather than announced, so the parent names the
 * same operation without a channel to this process.
 */

import { postgresOperationInbox } from "../../src/adapters/postgres/operationInbox.ts";
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
import {
  postgresHarnessCrashSubmission,
  postgresHarnessJournal,
  postgresHarnessKeying,
} from "./harness.ts";

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

/** Appends under a lease, either acknowledging both entries or leaving the second behind a lock. */
async function crashChildAppend(
  pool: ReturnType<typeof postgresPool>,
  partition: Partition,
  owner: string,
  seam: string,
): Promise<void> {
  const store = postgresProjectStore(pool);
  const journal = postgresHarnessJournal();
  const first = journal[0];
  const second = journal[1];
  if (first === undefined || second === undefined) {
    throw new Error(
      "crash child: the fixture journal is shorter than the seams need",
    );
  }
  let lease = await crashChildLease(store, partition, owner);
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
    return;
  }
  const also = await store.append(lease, second);
  if (also.appended !== "Committed") {
    throw new Error(`crash child: the second append was ${also.appended}`);
  }
  crashChildSay(`committed ${String(also.head)}`);
}

/** Accepts with no lease, either acknowledging the acceptance or leaving it behind a lock. */
async function crashChildAccept(
  pool: ReturnType<typeof postgresPool>,
  partition: Partition,
  seam: string,
): Promise<void> {
  const inbox = postgresOperationInbox(pool, postgresHarnessKeying());
  const submission = postgresHarnessCrashSubmission(partition);

  if (seam === "unaccepted") {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await postgresOwnershipLock(blocker, partition);
    void inbox.accept(submission);
    crashChildSay("blocked");
    return;
  }
  const accepted = await inbox.accept(submission);
  if (accepted.accepted !== "Accepted") {
    throw new Error(`crash child: the acceptance was ${accepted.accepted}`);
  }
  crashChildSay(`accepted ${String(accepted.operation.ordinal)}`);
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
const partition: Partition = {
  tenant: asTenantId(tenant),
  project: asProjectId(project),
};

if (seam === "accepted" || seam === "unaccepted") {
  await crashChildAccept(pool, partition, seam);
} else {
  await crashChildAppend(pool, partition, owner, seam);
}

crashChildSay("waiting");
await crashChildWait();
