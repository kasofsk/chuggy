/**
 * The `ProjectStore` answered by PostgreSQL: the durable authority a
 * dispatcher holds one project partition under.
 *
 * IT ASSEMBLES AND DECIDES NOTHING. Ownership is `./ownership.ts`'s and the
 * load is `./journal.ts`'s, and this file exists so the port has one
 * implementation to name rather than a caller assembling six functions and
 * getting the argument order wrong once. The split is by transaction:
 * every function this file names opens and closes its own, and the helpers
 * those modules share take the client rather than the pool, so the row lock a
 * load holds is the one its own transaction took.
 *
 * THE POOL IS THE CALLER'S. A store that opened its own connection would put a
 * deployment choice inside the adapter, and `src/compose.ts` is the only file
 * in this tree allowed to make one.
 */

import type pg from "pg";

import type { Entry } from "../../actor/journal.ts";
import type {
  Acquired,
  Lease,
  Lifecycle,
  OwnerId,
  Partition,
  ProjectStanding,
  ProjectStore,
  RecoveryEpoch,
  Renewed,
} from "../../interpreter/projectStore.ts";
import type { Parsed } from "../../interpreter/wire.ts";
import { postgresJournalLoad } from "./journal.ts";
import {
  postgresOwnershipAcquire,
  postgresOwnershipCreate,
  postgresOwnershipEpoch,
  postgresOwnershipEstablishEpoch,
  postgresOwnershipFence,
  postgresOwnershipRelease,
  postgresOwnershipRenew,
  postgresOwnershipStanding,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";

/** The store over a pool the composition root opened, which is every deployment choice this adapter makes. */
export function postgresProjectStore(pool: pg.Pool): ProjectStore {
  return {
    currentRecoveryEpoch: (): Promise<RecoveryEpoch> =>
      postgresTransaction(pool, postgresOwnershipEpoch),

    establishRecoveryEpoch: (epoch: RecoveryEpoch): Promise<RecoveryEpoch> =>
      postgresTransaction(pool, (client) =>
        postgresOwnershipEstablishEpoch(client, epoch),
      ),

    createProject: (partition: Partition): Promise<ProjectStanding> =>
      postgresOwnershipCreate(pool, partition),

    standing: (partition: Partition): Promise<ProjectStanding | undefined> =>
      postgresOwnershipStanding(pool, partition),

    acquire: (
      partition: Partition,
      owner: OwnerId,
      leaseSecs: number,
    ): Promise<Acquired> =>
      postgresOwnershipAcquire(pool, partition, owner, leaseSecs),

    renew: (lease: Lease, leaseSecs: number): Promise<Renewed> =>
      postgresOwnershipRenew(pool, lease, leaseSecs),

    release: (lease: Lease): Promise<void> =>
      postgresOwnershipRelease(pool, lease),

    load: (lease: Lease): Promise<Parsed<readonly Entry[]>> =>
      postgresJournalLoad(pool, lease),

    fence: (
      partition: Partition,
      lifecycle: Lifecycle,
    ): Promise<ProjectStanding> =>
      postgresOwnershipFence(pool, partition, lifecycle),
  };
}
