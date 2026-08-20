/**
 * Discovery: the readiness rows a fleet reads, the inbox items an activation
 * verifies against, and the clearing an idle owner is allowed to do.
 *
 * DISCOVERY READS READINESS AND NOTHING ELSE. `docs/design/006-durable-project-dispatch.md`
 * limits fleet discovery to durable project-readiness metadata, never another
 * project's journal or ticket contents — so the query here selects a partition
 * key and a generation, and any replica may act on the result without having
 * read a row it does not own.
 *
 * READINESS IS AN INDEX AND THE INBOX IS THE AUTHORITY. A ready project whose
 * items were all consumed costs one wasted activation; an unready project
 * holding a consumable item is work nobody finds. That asymmetry is why
 * clearing has to prove the inbox empty and why a repair scan is optional
 * rather than load-bearing.
 *
 * CLEARING LOCKS THE READINESS ROW AND CHECKS THE GENERATION THE OWNER SAW.
 * An acceptance raising readiness takes that same row lock, so the two
 * serialize: whichever commits first, an owner that observed the earlier
 * generation is refused rather than erasing a wake-up it never looked at. The
 * emptiness proof alone would not do it — an item accepted after the owner's
 * last look is both consumable and invisible to a check that ran before it.
 */

import type pg from "pg";

import {
  asOperationId,
  type InboxItem,
  type Readiness,
  type ReadinessCleared,
} from "../../interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";

/** One readiness row as PostgreSQL returns it. */
interface ReadinessRow {
  readonly tenant: string;
  readonly project: string;
  readonly generation: string;
}

/** One inbox row as PostgreSQL returns it. */
interface InboxRow {
  readonly ordinal: string;
  readonly operation: string;
}

/** Refuses a bound a caller left open, because an unbounded page is an unbounded read. */
function readinessBounded(limit: number, what: string): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`${what}: ${String(limit)} is not a positive bound`);
  }
  return limit;
}

/** At most `partitionsMax` projects with work waiting, in a deterministic order that is not a priority. */
export async function postgresReadinessReady(
  pool: pg.Pool,
  partitionsMax: number,
): Promise<readonly Readiness[]> {
  const found = await pool.query<ReadinessRow>(
    `SELECT tenant, project, generation FROM project_readiness
      WHERE ready ORDER BY tenant, project LIMIT $1`,
    [readinessBounded(partitionsMax, "ready partitions")],
  );
  return found.rows.map((row) => ({
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    generation: projectRowCounter(row.generation, "readiness generation"),
  }));
}

/** At most `itemsMax` consumable items in ordinal order, which is what an activation verifies. */
export async function postgresReadinessConsumable(
  pool: pg.Pool,
  partition: Partition,
  itemsMax: number,
): Promise<readonly InboxItem[]> {
  const found = await pool.query<InboxRow>(
    `SELECT ordinal, operation FROM inbox_item
      WHERE tenant = $1 AND project = $2 AND consumable
      ORDER BY ordinal LIMIT $3`,
    [
      partition.tenant,
      partition.project,
      readinessBounded(itemsMax, "consumable items"),
    ],
  );
  return found.rows.map((row) => ({
    partition,
    ordinal: projectRowCounter(row.ordinal, "inbox ordinal"),
    operation: asOperationId(row.operation),
  }));
}

/** Whether the partition still holds an item a writer could consume. */
async function readinessWorkRemains(
  client: pg.PoolClient,
  partition: Partition,
): Promise<boolean> {
  const remaining = await client.query(
    `SELECT 1 FROM inbox_item
      WHERE tenant = $1 AND project = $2 AND consumable LIMIT 1`,
    [partition.tenant, partition.project],
  );
  return remaining.rows.length > 0;
}

/** Clears readiness only at the generation the owner observed and only over an empty inbox. */
export async function postgresReadinessClear(
  pool: pg.Pool,
  readiness: Readiness,
): Promise<ReadinessCleared> {
  return postgresTransaction(pool, async (client) => {
    const locked = await client.query<ReadinessRow>(
      `SELECT tenant, project, generation FROM project_readiness
        WHERE tenant = $1 AND project = $2 FOR UPDATE`,
      [readiness.partition.tenant, readiness.partition.project],
    );
    const row = locked.rows[0];
    if (row === undefined) {
      throw new Error(
        `postgres readiness: ${readiness.partition.tenant}/${readiness.partition.project} has never been made ready`,
      );
    }
    const generation = projectRowCounter(
      row.generation,
      "readiness generation",
    );
    if (generation !== readiness.generation) {
      return { cleared: "Superseded", generation };
    }
    if (await readinessWorkRemains(client, readiness.partition)) {
      return { cleared: "WorkRemains" };
    }
    await client.query(
      `UPDATE project_readiness SET ready = false
        WHERE tenant = $1 AND project = $2`,
      [readiness.partition.tenant, readiness.partition.project],
    );
    return { cleared: "Cleared" };
  });
}
