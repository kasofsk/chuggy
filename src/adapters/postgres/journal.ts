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
 *
 * A ROW CARRIES THE MACHINE THAT DECIDED IT. `decision_semantics_version` names
 * the deciders the entry's record came from, and the load hands it back beside
 * the entry so a history spanning a semantics change is replayed row by row
 * under its own. The load refuses a version this image cannot replay, because a
 * row decided by a machine it does not have is a row it cannot re-derive.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { Entry, StoredEntry } from "../../actor/journal.ts";
import { storedJournalLegalOn } from "../../actor/journal.ts";
import {
  decisionSemanticsVersionCurrent,
  isDecisionSemanticsVersion,
} from "../../actor/decisionSemantics.ts";
import type { Config } from "../../domain/config.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  ConfigurationPin,
  DecisionCause,
} from "../../interpreter/projectDecision.ts";
import {
  asProjectId,
  asTenantId,
  type Lease,
  type Partition,
  type ProjectStanding,
} from "../../interpreter/projectStore.ts";
import type { RuntimeStoredJournalSource } from "../../interpreter/serviceRuntime.ts";
import type { DispatchContractPin } from "../../interpreter/dispatchView.ts";
import {
  encodeEntry,
  parseJournal,
  type Parsed,
} from "../../interpreter/wire.ts";
import {
  configurationRevisionDigest,
  journalChainDigest,
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
  readonly configuration_revision: string | null;
  readonly configuration_digest: string | null;
  readonly configuration_canonical: string | null;
  readonly event_schema_version: number;
  readonly decision_semantics_version: number;
}

function storedJournalRowVerified(
  row: StoredJournalRow,
  partition: Partition,
  previous: string,
  entry: Entry,
): boolean {
  if (row.prev_digest !== previous) return false;
  if (row.integrity_version === 1) {
    return journalChainDigest(partition, previous, entry) === row.entry_digest;
  }
  if (row.integrity_version !== 2) return false;
  if (row.event_schema_version !== 1) return false;
  const cause: DecisionCause | undefined =
    row.cause_kind === "Operation"
      ? { kind: "Operation", id: asOperationId(row.cause_id) }
      : row.cause_kind === "Continuation"
        ? { kind: "Continuation", id: row.cause_id }
        : undefined;
  const configuration =
    row.configuration_revision !== null && row.configuration_digest !== null
      ? {
          configurationRevision: row.configuration_revision,
          configurationDigest: row.configuration_digest,
        }
      : undefined;
  return (
    cause !== undefined &&
    configuration !== undefined &&
    row.configuration_canonical !== null &&
    configurationRevisionDigest(row.configuration_canonical) ===
      configuration.configurationDigest &&
    journalEnvelopeDigest(partition, previous, {
      entry,
      cause,
      configuration,
      eventSchemaVersion: row.event_schema_version,
      decisionSemanticsVersion: row.decision_semantics_version,
    }) === row.entry_digest
  );
}

async function storedJournalRows(
  client: pg.PoolClient,
  partition: Partition,
): Promise<readonly StoredJournalRow[]> {
  const { tenant, project } = partition;
  return (
    await client.query<StoredJournalRow>(
      sql`SELECT j.entry,j.entry_digest,j.prev_digest,j.integrity_version,j.cause_kind,j.cause_id,
       j.configuration_revision,j.configuration_digest,c.canonical AS configuration_canonical,
       j.event_schema_version,j.decision_semantics_version
       FROM journal_entry j LEFT JOIN configuration_revision c
         ON c.tenant=j.tenant AND c.project=j.project
        AND c.revision=j.configuration_revision AND c.digest=j.configuration_digest
       WHERE j.tenant = ${tenant} AND j.project = ${project} ORDER BY j.seq`,
    )
  ).rows;
}

export async function postgresJournalDispatchContracts(
  pool: pg.Pool,
  lease: Lease,
): Promise<ReadonlyMap<number, DispatchContractPin>> {
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    if (!(await postgresOwnershipHonours(client, row, lease)))
      throw new Error(
        "postgres journal: dispatch contracts requested under a fenced lease",
      );
    const found = await client.query<{
      entry: string;
      configuration_revision: string;
      configuration_digest: string;
      configuration_canonical: string;
    }>(
      sql`SELECT j.entry,j.configuration_revision,j.configuration_digest,
              c.canonical AS configuration_canonical
         FROM journal_entry j JOIN configuration_revision c
           ON c.tenant=j.tenant AND c.project=j.project
          AND c.revision=j.configuration_revision AND c.digest=j.configuration_digest
        WHERE j.tenant=${lease.partition.tenant} AND j.project=${lease.partition.project} AND j.configuration_revision IS NOT NULL
        ORDER BY j.seq`,
    );
    const contracts = new Map<number, DispatchContractPin>();
    for (const stored of found.rows) {
      const parsed = parseJournal([JSON.parse(stored.entry) as unknown]);
      if (parsed.parsed === "Refused")
        throw new Error(
          `postgres journal: dispatch contract entry is unreadable — ${parsed.why}`,
        );
      const event = parsed.value[0]?.event;
      if (event?.type === "ReleaseTicket") {
        contracts.set(event.value.ticket, {
          configurationRevision: stored.configuration_revision,
          configurationDigest: stored.configuration_digest,
          configurationCanonical: stored.configuration_canonical,
        });
      }
    }
    return contracts;
  });
}

/** The digest the next entry chains onto: the head entry's, or the partition's genesis at an empty journal. */
async function postgresJournalPrevious(
  client: pg.PoolClient,
  partition: Partition,
  head: number,
): Promise<string> {
  if (head === 0) return journalChainGenesis(partition);
  const found = await client.query<{ entry_digest: string }>(
    sql`SELECT entry_digest FROM journal_entry WHERE tenant = ${partition.tenant} AND project = ${partition.project} AND seq = ${head}`,
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
  configuration: ConfigurationPin,
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
  const envelope: JournalIntegrityEnvelope = {
    entry,
    cause,
    configuration,
    eventSchemaVersion: 1,
    decisionSemanticsVersion: decisionSemanticsVersionCurrent,
  };
  await client.query(
    sql`INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
        recovery_epoch, cause_kind, cause_id, configuration_revision,
        configuration_digest, event_schema_version, decision_semantics_version,
        integrity_version)
     VALUES (${lease.partition.tenant}, ${lease.partition.project}, ${entry.seq},
             ${encodeEntry(entry)},
             ${journalEnvelopeDigest(lease.partition, previous, envelope)},
             ${previous}, ${lease.owner}, ${lease.fencingEpoch},
             ${lease.recoveryEpoch}, ${cause.kind}, ${cause.id},
             ${configuration.configurationRevision},
             ${configuration.configurationDigest},
             ${envelope.eventSchemaVersion},
             ${envelope.decisionSemanticsVersion}, 2)`,
  );
  await client.query(
    sql`UPDATE project SET head = ${entry.seq} WHERE tenant = ${lease.partition.tenant} AND project = ${lease.partition.project}`,
  );
}

/** Stored rows decoded in sequence order, each paired with the semantics its own row declares. */
function postgresJournalStored(
  partition: Partition,
  rows: readonly StoredJournalRow[],
): Parsed<readonly StoredEntry[]> {
  const stored: StoredEntry[] = [];
  let previous = journalChainGenesis(partition);
  for (const row of rows) {
    let parsed: Parsed<readonly Entry[]>;
    try {
      parsed = parseJournal([JSON.parse(row.entry) as unknown]);
    } catch {
      return {
        parsed: "Refused",
        why: `a stored row is not JSON: ${row.entry}`,
      };
    }
    if (parsed.parsed === "Refused") return parsed;
    const entry = parsed.value[0];
    if (entry === undefined)
      return { parsed: "Refused", why: "a parsed journal row is absent" };
    if (
      !isDecisionSemanticsVersion(row.decision_semantics_version) ||
      !storedJournalRowVerified(row, partition, previous, entry)
    ) {
      return {
        parsed: "Refused",
        why: "a stored journal envelope failed integrity verification",
      };
    }
    stored.push({ entry, semantics: row.decision_semantics_version });
    previous = row.entry_digest;
  }
  return { parsed: "Ok", value: stored };
}

/** Every stored entry in sequence order with the semantics its row declares, asserted to reach the head the locked row claims. */
async function postgresJournalEntries(
  client: pg.PoolClient,
  standing: ProjectStanding,
): Promise<Parsed<readonly StoredEntry[]>> {
  const { tenant, project } = standing.partition;
  const rows = await storedJournalRows(client, standing.partition);
  if (rows.length !== standing.head) {
    throw new Error(
      `postgres journal: ${tenant}/${project} claims head ${String(standing.head)} over ${String(rows.length)} stored entries`,
    );
  }
  return postgresJournalStored(standing.partition, rows);
}

/** Replays the partition under the lease the decision will present, refusing one the row no longer honours. */
export async function postgresJournalLoad(
  pool: pg.Pool,
  lease: Lease,
): Promise<Parsed<readonly StoredEntry[]>> {
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

/** How many journaled partitions one legality scan reads before it reports that it could not finish. */
const journalLegalityPartitionsMax = 1024;

/** The partitions holding a journal, bounded, so the scan over them is too. */
async function postgresJournalPartitions(
  pool: pg.Pool,
): Promise<readonly Partition[]> {
  const found = await pool.query<{ tenant: string; project: string }>(
    sql`SELECT DISTINCT tenant,project FROM journal_entry
        ORDER BY tenant,project LIMIT ${journalLegalityPartitionsMax}`,
  );
  if (found.rows.length === journalLegalityPartitionsMax)
    throw new Error(
      "postgres journal: more journaled partitions than one legality scan reads",
    );
  return found.rows.map((row) => ({
    tenant: asTenantId(row.tenant),
    project: asProjectId(row.project),
  }));
}

/**
 * Every journaled partition replayed under the semantics each of its rows
 * declares, naming the ones this image could not have decided. A scan that
 * cannot reach every partition throws rather than report a clean prefix.
 */
export function postgresJournalLegality(
  pool: pg.Pool,
  config: Config,
): RuntimeStoredJournalSource {
  return {
    illegalPartitions: async (signal) => {
      const illegal: string[] = [];
      for (const partition of await postgresJournalPartitions(pool)) {
        signal.throwIfAborted();
        const stored = await postgresTransaction(pool, (client) =>
          storedJournalRows(client, partition).then((rows) =>
            postgresJournalStored(partition, rows),
          ),
        );
        if (
          stored.parsed === "Refused" ||
          !storedJournalLegalOn(config, stored.value)
        )
          illegal.push(`${partition.tenant}/${partition.project}`);
      }
      return illegal;
    },
  };
}
