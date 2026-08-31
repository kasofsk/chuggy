/**
 * The resume point and the accounts, driven onto a real ticket by real
 * decisions and read back off the durable projection and the public read.
 *
 * THE JOURNAL IS THE ORACLE. Every step compares the stored row with the core
 * the same decision left behind, because the projection's whole claim is that
 * it is a read of one post-state — a column right at the end and wrong in the
 * middle is a column a reader believes.
 *
 * THE WALL AND THE RESUME ARE THE TWO STATES WORTH DRIVING TO. `resume_at` is
 * the machine's absent value everywhere else, and the accounts only become
 * interesting once a rework has spent from them, so a fixture that stopped at
 * `Working` would assert the projection carries columns rather than that it
 * carries the machine.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { budgeted } from "../../src/domain/pricing.ts";
import type { Verdict } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import type { TicketResource } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessDrain,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
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

/** One projection row as the columns this suite is about, every counter as text. */
interface ProjectedRow {
  readonly phase: string;
  readonly reason: string;
  readonly resume_at: string | null;
  readonly gas_left: string | null;
  readonly rework_left: string | null;
  readonly finalization_left: string | null;
}

async function projected(partition: Partition): Promise<ProjectedRow> {
  const found = await harness.query(
    `SELECT phase, reason, resume_at, gas_left::text AS gas_left,
            rework_left::text AS rework_left,
            finalization_left::text AS finalization_left
       FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, subject],
  );
  const row = found[0];
  if (row === undefined)
    throw new Error("ticket projection case: the ticket has no row");
  return row as unknown as ProjectedRow;
}

/** The same facts read off the replayed core, which is what the row must equal. */
function carried(memory: ProjectMemory): ProjectedRow {
  const ticket = ticketAt(memory.core, subject);
  return {
    phase: ticket.phase,
    reason: ticket.reason,
    resume_at: ticket.resumeAt,
    gas_left: String(ticket.gasLeft),
    rework_left: String(ticket.reworkLeft),
    finalization_left:
      ticket.finalizationPricing === "DeadlineOnly"
        ? null
        : String(ticket.finalizationLeft),
  };
}

/** The subject as the project table lists it, in the order the case names. */
async function listed(
  partition: Partition,
  order: "Identity" | "RecentActivity",
): Promise<TicketResource> {
  const found = await postgresNativeReads(pool).project(partition, {
    limit: 10,
    order,
  });
  if (found.result !== "Found")
    throw new Error("ticket projection case: the project has no read");
  const row = found.project.tickets.find((each) => each.ticket === subject);
  if (row === undefined)
    throw new Error("ticket projection case: the list omits the ticket");
  return row;
}

/** Reports one task and decides it with everything the commit enqueued behind it. */
async function reported(
  partition: Partition,
  memory: ProjectMemory,
  task: number,
  verdict: Verdict,
): Promise<ProjectMemory> {
  await postgresHarnessCompletion(
    harness,
    partition,
    `operation-projection-${randomUUID()}`,
    taskDoneEvent(subject, asTaskId(task), verdict, plainResult),
  );
  const drained = await postgresHarnessDrain(harness, partition, memory);
  assert.deepEqual(
    drained.decided.filter((each) => each !== "Committed"),
    [],
  );
  assert.deepEqual(await projected(partition), carried(drained.memory));
  return drained.memory;
}

/** The open question a park raises, with the fence an answer to it must name. */
async function openAction(
  partition: Partition,
): Promise<{ action: string; authorizingSeq: number }> {
  const found = await harness.query(
    `SELECT action, authorizing_seq::text AS authorizing_seq
       FROM native_action
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
    [partition.tenant, partition.project, subject],
  );
  const row = found[0];
  if (row === undefined)
    throw new Error("ticket projection case: the park opened no action");
  return {
    action: String(row["action"]),
    authorizingSeq: Number(row["authorizing_seq"]),
  };
}

/**
 * A ticket driven to the rework wall: two cycles, the second of which finds no
 * rework left. The budget wall is checked before the gas wall, so this parks
 * with gas still on the ticket — which is what makes the resume affordable.
 */
async function walled(
  partition: Partition,
  label: string,
): Promise<ProjectMemory> {
  let memory = await postgresHarnessHistory(
    harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  assert.deepEqual(await projected(partition), carried(memory));
  memory = await reported(partition, memory, 1, "Pass");
  memory = await reported(partition, memory, 2, "Fail");
  memory = await reported(partition, memory, 3, "Pass");
  return reported(partition, memory, 4, "Fail");
}

test("the projection carries the wall's resume point and the accounts behind it", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-wall",
  );
  const memory = await walled(partition, "projection-wall");
  assert.deepEqual(await projected(partition), {
    phase: "Escalated",
    reason: "ReworkBudgetExhausted",
    resume_at: "ResumeEvaluating",
    gas_left: "1",
    rework_left: "0",
    finalization_left: "1",
  });
  assert.deepEqual(await projected(partition), carried(memory));
});

test("the public read serves the resume point and the accounts the row holds", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-read",
  );
  await walled(partition, "projection-read");
  const reads = postgresNativeReads(pool);
  const parked = await reads.ticket(partition, subject);
  assert.equal(parked?.phase, "Escalated");
  assert.equal(parked?.resumeAt, "ResumeEvaluating");
  const accounts = {
    gasLeft: 1,
    gasMax: refinementInstance.gas,
    reworkLeft: 0,
    finalizationLeft: 1,
  };
  assert.deepEqual(parked?.accounts, accounts);
  for (const order of ["Identity", "RecentActivity"] as const) {
    const row = await listed(partition, order);
    assert.equal(row.resumeAt, "ResumeEvaluating");
    assert.deepEqual(row.accounts, accounts);
  }
});

test("a resume clears the point it re-entered at and pays for itself", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-resume",
  );
  const memory = await walled(partition, "projection-resume");
  const action = await openAction(partition);
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, "projection-resume-answer"),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: action.action,
      authorizingSeq: action.authorizingSeq,
      resolution: "Resume",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const drained = await postgresHarnessDrain(harness, partition, memory);
  assert.deepEqual(drained.decided, ["Committed"]);
  assert.deepEqual(await projected(partition), {
    phase: "Evaluating",
    reason: "NoReason",
    resume_at: "NoResume",
    gas_left: "0",
    rework_left: "0",
    finalization_left: "1",
  });
  assert.deepEqual(await projected(partition), carried(drained.memory));
  const reads = postgresNativeReads(pool);
  const resumed = await reads.ticket(partition, subject);
  assert.equal(resumed?.resumeAt, undefined);
  assert.equal(resumed?.accounts?.gasLeft, 0);
});

/**
 * A row no decision has moved since the projection grew these columns. It reads
 * as a ticket whose accounts are not known rather than as one whose accounts
 * are empty, which is the whole reason none of them is defaulted.
 */
test("a row written before the accounts existed serves none of them", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-older",
  );
  await harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,$3,'Escalated',1)`,
    [partition.tenant, partition.project, subject],
  );
  const reads = postgresNativeReads(pool);
  const older = await reads.ticket(partition, subject);
  assert.equal(older?.phase, "Escalated");
  assert.equal(older?.resumeAt, undefined);
  assert.equal(older?.accounts, undefined);
});

/**
 * The two things a null `finalization_left` could mean, driven apart. A
 * `Budgeted` account standing at zero is a figure the wire owes its reader, and
 * only the pricing says whether an account was ever budgeted at all.
 */
test("a budgeted account at zero is served, and an unbudgeted one is absent", async () => {
  const reads = postgresNativeReads(pool);
  const spent = await postgresHarnessProject(
    harness.store,
    "projection-budgeted",
  );
  const spentMemory = await postgresHarnessHistory(
    harness,
    spent,
    "projection-budgeted",
    1,
    { ...plainAuthoring, finalizationPricing: budgeted(0) },
  );
  assert.equal((await projected(spent)).finalization_left, "0");
  assert.deepEqual(await projected(spent), carried(spentMemory));
  assert.equal(
    (await reads.ticket(spent, subject))?.accounts?.finalizationLeft,
    0,
  );

  const unpriced = await postgresHarnessProject(
    harness.store,
    "projection-deadline",
  );
  const unpricedMemory = await postgresHarnessHistory(
    harness,
    unpriced,
    "projection-deadline",
    1,
    { ...plainAuthoring, finalizationPricing: "DeadlineOnly" },
  );
  assert.equal((await projected(unpriced)).finalization_left, null);
  assert.deepEqual(await projected(unpriced), carried(unpricedMemory));
  assert.deepEqual((await reads.ticket(unpriced, subject))?.accounts, {
    gasLeft: refinementInstance.gas,
    gasMax: refinementInstance.gas,
    reworkLeft: 1,
  });
});

/**
 * Each constraint migration 054 adds, against a row carrying the defect it
 * names. The header claims the wholeness CHECK is what keeps `gas_left` able to
 * tell the two `finalization_left` absences apart, and a claim about a
 * constraint is worth what the constraint is worth.
 */
test("the projection refuses a resume, a negative account and a half-written pair", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-constraints",
  );
  const columns = (rest: string) =>
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,${rest}`;
  const refused: readonly [string, readonly unknown[], RegExp][] = [
    [
      columns("resume_at) VALUES ($1,$2,$3,'Escalated',1,'ResumeNowhere')"),
      [partition.tenant, partition.project, 1],
      /ticket_projection_resume_is_known/u,
    ],
    [
      columns("gas_left,rework_left) VALUES ($1,$2,$3,'Working',1,-1,0)"),
      [partition.tenant, partition.project, 2],
      /ticket_projection_accounts_are_not_negative/u,
    ],
    [
      columns("rework_left) VALUES ($1,$2,$3,'Working',1,0)"),
      [partition.tenant, partition.project, 3],
      /ticket_projection_accounts_are_whole/u,
    ],
    [
      columns("finalization_left) VALUES ($1,$2,$3,'Working',1,0)"),
      [partition.tenant, partition.project, 4],
      /ticket_projection_accounts_are_whole/u,
    ],
  ];
  for (const [statement, values, refusal] of refused)
    await assert.rejects(harness.query(statement, values), refusal);
  await assert.doesNotReject(
    harness.query(
      columns(
        "resume_at,gas_left,rework_left,finalization_left) VALUES ($1,$2,$3,'Escalated',1,'NoResume',0,0,NULL)",
      ),
      [partition.tenant, partition.project, 5],
    ),
    "the shape a deadline-priced ticket is projected in",
  );
});
