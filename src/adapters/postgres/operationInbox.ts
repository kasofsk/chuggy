/**
 * The `OperationInbox` answered by PostgreSQL: the durable submission side of
 * one project partition.
 *
 * IT ASSEMBLES AND DECIDES NOTHING, exactly as `./projectStore.ts` does not.
 * Every statement is `./operations.ts`'s, and this file exists so the port has
 * one implementation to name. The split is by transaction: every function in
 * that module opens and closes its own, and none of them is called from inside
 * another's.
 *
 * THE POOL AND THE KEYING SET ARE BOTH THE CALLER'S. Where the connection
 * comes from is a deployment choice `src/compose.ts` alone may make, and so is
 * where the idempotency secrets come from — an adapter that read either from
 * its environment would be making that choice inside the layer that must not
 * have one. This pool is the API role's; the dispatcher's is
 * `./projectDiscovery.ts`'s, because 006 gives runtime services separate
 * credentials and one pool answering both ports would undo that.
 */

import type pg from "pg";

import type {
  Accepted,
  Cancellation,
  Cancelled,
  OperationId,
  OperationInbox,
  OperationStanding,
  Submission,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { IdempotencyKeying } from "./keying.ts";
import {
  postgresOperationsAccept,
  postgresOperationsCancel,
  postgresOperationsRead,
} from "./operations.ts";

/** The inbox over a pool and a keying set the composition root supplied. */
export function postgresOperationInbox(
  pool: pg.Pool,
  keying: IdempotencyKeying,
): OperationInbox {
  return {
    accept: (submission: Submission): Promise<Accepted> =>
      postgresOperationsAccept(pool, keying, submission),

    cancel: (cancellation: Cancellation): Promise<Cancelled> =>
      postgresOperationsCancel(pool, cancellation),

    operation: (
      partition: Partition,
      operation: OperationId,
    ): Promise<OperationStanding | undefined> =>
      postgresOperationsRead(pool, partition, operation),
  };
}
