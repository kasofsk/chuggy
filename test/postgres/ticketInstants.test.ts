/**
 * The two instants a ticket is dated by, driven onto a real ticket by real
 * decisions and read back against the journal that is the only place either
 * comes from.
 *
 * THE JOURNAL IS THE ORACLE, and it is the whole oracle: neither instant is
 * stored beside the projection, so every case here asks the read for a time and
 * asks `journal_entry` for the time of the entry that time is supposed to be.
 * Comparing the read against a constant would prove the column parses.
 *
 * WHY THREE DECISIONS. A release alone cannot tell the two apart, because at a
 * release they are the same instant. The dispatch is what moves one and leaves
 * the other, and the revoke that follows is what carries the ticket to a
 * terminal phase — where `changedAt` is the completion instant and the reason
 * this contract names no third field.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/ticketCommand.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: ReturnType<typeof postgresPool>;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

/** The ticket every case here drives, which is the only one its project mints. */
const subject = id(1);

/** The most decisions one answer may leave behind it, which no case here reaches. */
const followingDecisionsMax = 8;

/**
 * When the entry at `seq` committed, as the server renders it rather than as a
 * driver reconstructs it, so the comparison is against the stored value.
 */
async function committedAt(partition: Partition, seq: number): Promise<number> {
  const found = await harness.query(
    `SELECT to_char(committed_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM journal_entry WHERE tenant=$1 AND project=$2 AND seq=$3`,
    [partition.tenant, partition.project, seq],
  );
  const at = found[0]?.["at"];
  if (typeof at !== "string")
    throw new Error(
      `ticket instants case: no entry at sequence ${String(seq)}`,
    );
  return Date.parse(at);
}

/** The public read's instant as a moment, so a difference in rendering is not a difference in time. */
function readAt(value: string): number {
  const parsed = Date.parse(value);
  assert.ok(!Number.isNaN(parsed), `the read answered ${value}`);
  return parsed;
}

/** The ticket as its own read serves it, refusing the absence no case here drives to. */
async function ticketRead(partition: Partition) {
  const found = await postgresNativeReads(pool).ticket(partition, subject);
  if (found === undefined)
    throw new Error("ticket instants case: the ticket has no read");
  return found;
}

/**
 * Decides the input the last commit left behind and anything behind that, which
 * is how an answer that opens a continuation reaches the writer owing it.
 */
async function answered(
  partition: Partition,
  memory: ProjectMemory,
): Promise<ProjectMemory> {
  const writer = postgresHarnessWriter(harness);
  let carried = memory;
  for (let decided = 0; decided < followingDecisionsMax; decided++) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) return carried;
    const step = await projectWriterDecide(writer, carried, input);
    assert.equal(step.decided.decided, "Committed");
    carried = step.memory;
  }
  throw new Error("ticket instants case: the answers did not run out");
}

/** Offers the revoke that carries a dispatched ticket off the machine. */
async function revoked(
  partition: Partition,
  label: string,
  memory: ProjectMemory,
): Promise<ProjectMemory> {
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, label),
    command: {
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent({ type: "Revoke", value: subject }),
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  return answered(partition, memory);
}

test("a ticket is dated by its release and by the entry that last moved it", async () => {
  const partition = await postgresHarnessProject(harness.store, "instants-two");
  await postgresHarnessHistory(
    harness,
    partition,
    "instants-two",
    postgresHarnessJournal().length,
  );
  const dispatched = await ticketRead(partition);
  assert.equal(dispatched.phase, "Working");
  assert.ok(dispatched.releasedAt !== undefined);
  assert.equal(readAt(dispatched.releasedAt), await committedAt(partition, 1));
  assert.equal(readAt(dispatched.changedAt), await committedAt(partition, 2));
  assert.equal(dispatched.sequence, 2);
});

test("the page a project is listed by carries the same two instants", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "instants-page",
  );
  await postgresHarnessHistory(
    harness,
    partition,
    "instants-page",
    postgresHarnessJournal().length,
  );
  const listed = await postgresNativeReads(pool).project(partition, {
    limit: 10,
  });
  assert.equal(listed.result, "Found");
  const row = listed.result === "Found" ? listed.project.tickets[0] : undefined;
  const own = await ticketRead(partition);
  assert.equal(row?.releasedAt, own.releasedAt);
  assert.equal(row?.changedAt, own.changedAt);
});

/**
 * The state that makes one of the two optional and the other not. `journal.ts`
 * returns a refusal for a stored row it cannot parse rather than raising, so a
 * journal holding one is a state this authority admits — and the ticket is then
 * served undated by its release rather than not served at all, while the entry
 * its sequence names still dates it because reading that one parses nothing.
 */
test("a journal entry no reader can parse leaves the release undated", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "instants-torn",
  );
  await postgresHarnessHistory(
    harness,
    partition,
    "instants-torn",
    postgresHarnessJournal().length,
  );
  await harness.query(
    `UPDATE journal_entry SET entry='not json'
      WHERE tenant=$1 AND project=$2 AND seq=1`,
    [partition.tenant, partition.project],
  );
  const torn = await ticketRead(partition);
  assert.equal(torn.releasedAt, undefined);
  assert.equal(readAt(torn.changedAt), await committedAt(partition, 2));
});

test("a ticket carried off the machine is dated by the entry that ended it", async () => {
  const partition = await postgresHarnessProject(harness.store, "instants-end");
  const dispatched = await postgresHarnessHistory(
    harness,
    partition,
    "instants-end",
    postgresHarnessJournal().length,
  );
  const released = await ticketRead(partition);
  const memory = await revoked(partition, "instants-end-revoke", dispatched);
  const moved = memory.ticketVersions.get(subject);
  assert.ok(moved !== undefined);
  const ended = await ticketRead(partition);
  assert.equal(ended.phase, "Revoked");
  assert.equal(ended.releasedAt, released.releasedAt);
  assert.notEqual(ended.changedAt, released.changedAt);
  assert.equal(ended.sequence, moved);
  assert.equal(readAt(ended.changedAt), await committedAt(partition, moved));
});

/**
 * A release-shaped entry carrying anything but a number where its ticket goes.
 * No writer can produce one — `encodeEntry` runs off a typed `Entry` — but all
 * three reads key on that value, so an expression casting it would raise on a
 * row the journal is specified to keep, which is why all three are asked and not
 * only the one whose instant goes missing.
 */
test("a release naming no number is a row the journal keeps and the read skips", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "instants-unnumbered",
  );
  await postgresHarnessHistory(
    harness,
    partition,
    "instants-unnumbered",
    postgresHarnessJournal().length,
  );
  await harness.query(
    `UPDATE journal_entry
        SET entry='{"seq":1,"event":{"type":"ReleaseTicket","value":{"ticket":"one"}},"rec":{}}'
      WHERE tenant=$1 AND project=$2 AND seq=1`,
    [partition.tenant, partition.project],
  );
  const unnumbered = await ticketRead(partition);
  assert.equal(unnumbered.releasedAt, undefined);
  assert.equal(readAt(unnumbered.changedAt), await committedAt(partition, 2));
  const reads = postgresNativeReads(pool);
  for (const order of ["Identity", "RecentActivity"] as const) {
    const listed = await reads.project(partition, { limit: 10, order });
    assert.equal(listed.result, "Found", `the page in ${order} order`);
    if (listed.result !== "Found") continue;
    assert.deepEqual(
      listed.project.tickets.map((each) => each.releasedAt),
      [undefined],
      `the page in ${order} order dates no release either`,
    );
  }
});

/**
 * The reads as production runs them, which is as `chuggy_api` rather than as
 * the owner every other case here connects as. That role reaches the journal
 * through one column-level grant and nothing else, so a column this change
 * forgot to grant is every ticket page refused rather than one field missing.
 */
test("the API role reads both instants through the grant the migration makes", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "instants-role",
  );
  await postgresHarnessHistory(
    harness,
    partition,
    "instants-role",
    postgresHarnessJournal().length,
  );
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const reads = postgresNativeReads(asApi);
    const own = await reads.ticket(partition, subject);
    assert.equal(readAt(own?.changedAt ?? ""), await committedAt(partition, 2));
    assert.equal(
      readAt(own?.releasedAt ?? ""),
      await committedAt(partition, 1),
    );
    const listed = await reads.project(partition, { limit: 10 });
    assert.equal(listed.result, "Found");
    const row =
      listed.result === "Found" ? listed.project.tickets[0] : undefined;
    assert.equal(row?.releasedAt, own?.releasedAt);
    assert.equal(row?.changedAt, own?.changedAt);
  } finally {
    await asApi.end();
  }
});
