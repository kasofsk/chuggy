/**
 * The child process `crash.test.ts` kills: it does the work its argument names
 * and then waits to be killed at that seam.
 *
 * IT NEVER EXITS ON ITS OWN. Every seam ends in a wait that only a signal
 * ends, so the parent decides when the process dies rather than racing an
 * orderly shutdown it did not ask for. A child that exited by itself would
 * prove that a clean close is durable, which is not the claim.
 *
 * `decided` acknowledges a committed decision and then waits, so the parent
 * kills a process holding a commit nobody else has heard about — which is the
 * ambiguous commit exactly as a caller meets it. `undecided` starts the same
 * decision behind a row lock it holds on another connection, so the parent
 * kills a process whose write cannot have committed. Between them they bound
 * the answer: what was acknowledged survives whole, and what was not leaves
 * nothing.
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
import { postgresProjectDecision } from "../../src/adapters/postgres/projectDecision.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import {
  asOwnerId,
  asProjectId,
  asTenantId,
  type Lease,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
  type ProjectWriter,
} from "../../src/interpreter/projectWriter.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessAccept,
  postgresHarnessCrashSubmission,
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

/** Decides the crash rig's one accepted operation, or leaves that decision behind a lock. */
async function crashChildDecide(
  pool: ReturnType<typeof postgresPool>,
  partition: Partition,
  owner: string,
  seam: string,
): Promise<void> {
  const store = postgresProjectStore(pool);
  const writer: ProjectWriter = {
    config: refinementInstance,
    store,
    decisions: postgresProjectDecision(pool),
  };
  const submission = postgresHarnessCrashSubmission(partition);
  const item = await postgresHarnessAccept(
    postgresOperationInbox(pool, postgresHarnessKeying()),
    submission,
  );
  const memory = await projectWriterLoad(
    writer,
    await crashChildLease(store, partition, owner),
  );

  if (seam === "undecided") {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await postgresOwnershipLock(blocker, partition);
    void projectWriterDecide(writer, memory, item);
    crashChildSay("blocked");
    return;
  }
  const step = await projectWriterDecide(writer, memory, item);
  if (step.decided.decided !== "Committed") {
    throw new Error(`crash child: the decision was ${step.decided.decided}`);
  }
  crashChildSay(`committed ${String(step.decided.lease.head)}`);
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
  await crashChildDecide(pool, partition, owner, seam);
}

crashChildSay("waiting");
await crashChildWait();
