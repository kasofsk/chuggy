/**
 * The resume point, driven onto a real ticket by real decisions and read back
 * off the durable projection, the public read and the change row the same
 * decision appended.
 *
 * THE JOURNAL IS THE ORACLE. Every step compares the stored row with the core
 * the same decision left behind, because the projection's whole claim is that
 * it is a read of one post-state — a column right at the end and wrong in the
 * middle is a column a reader believes.
 *
 * THE WALL AND THE RESUME ARE THE TWO STATES WORTH DRIVING TO. `resume_at` is
 * the machine's absent value everywhere else, so a fixture that stopped at
 * `Working` would assert the projection carries a column rather than that it
 * carries the machine.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { Verdict } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import type { TicketResource } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { plainResult } from "../actor/harness.ts";
import { resumePoints } from "../../src/contract/rosters.ts";
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

/** One projection row as the columns this suite is about. */
interface ProjectedRow {
  readonly phase: string;
  readonly reason: string;
  readonly resume_at: string | null;
}

async function projected(partition: Partition): Promise<ProjectedRow> {
  const found = await harness.query(
    `SELECT phase, reason, resume_at
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
 * A ticket driven to the rework wall: the writer's configured cap allows two
 * reworks, so the third failed evaluation is the one that parks it.
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
  memory = await reported(partition, memory, 4, "Fail");
  memory = await reported(partition, memory, 5, "Pass");
  return reported(partition, memory, 6, "Fail");
}

test("the projection carries the wall's resume point", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-wall",
  );
  const memory = await walled(partition, "projection-wall");
  assert.deepEqual(await projected(partition), {
    phase: "Escalated",
    reason: "ReworkBudgetExhausted",
    resume_at: "ResumeReworking",
  });
  assert.deepEqual(await projected(partition), carried(memory));
});

/**
 * The change row the SAME decision appended, which is a third reader of the
 * post-state. `append_project_change` reads `ticket_projection` to name a
 * publication's reason, so what a thread is told rests on `decisionProject`
 * running before `notifyDecision` in `src/adapters/postgres/decision.ts` — a
 * call order across two modules that no other case here would notice moving
 * (kasofsk/chuggy#542).
 */
test("the change row a decision appends records the phase that decision produced", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-change",
  );
  await walled(partition, "projection-change");
  const rows = (await harness.query(
    `SELECT wake_reason FROM project_change
      WHERE tenant=$1 AND project=$2 AND kind='Ticket' AND resource=$3
      ORDER BY sequence`,
    [partition.tenant, partition.project, String(subject)],
  )) as readonly { wake_reason: string | null }[];
  assert.deepEqual(
    rows.map((row) => row.wake_reason).filter((reason) => reason !== null),
    ["TicketEscalated"],
    "the wall's own change row is not the row that records the wall",
  );
  assert.equal(
    rows[rows.length - 1]?.wake_reason,
    "TicketEscalated",
    "the escalating decision published before it projected, so its row names the phase it left",
  );
});

test("the public read serves the resume point the row holds", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-read",
  );
  await walled(partition, "projection-read");
  const reads = postgresNativeReads(pool);
  const parked = await reads.ticket(partition, subject);
  assert.equal(parked?.phase, "Escalated");
  assert.equal(parked?.resumeAt, "ResumeReworking");
  for (const order of ["Identity", "RecentActivity"] as const) {
    assert.equal((await listed(partition, order)).resumeAt, "ResumeReworking");
  }
});

test("a resume clears the point it re-entered at", async () => {
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
    phase: "Working",
    reason: "NoReason",
    resume_at: "NoResume",
  });
  assert.deepEqual(await projected(partition), carried(drained.memory));
  const reads = postgresNativeReads(pool);
  assert.equal((await reads.ticket(partition, subject))?.resumeAt, undefined);
});

/**
 * One journal entry, so a hand-written projection row stands where the writer
 * would have left it: the row and the entry its sequence names are written in
 * one transaction, and the ticket read dates the row from that entry.
 */
async function seedEntryAt(partition: Partition, seq: number): Promise<void> {
  const submission = postgresHarnessSubmission(
    partition,
    `projection-${String(seq)}`,
  );
  await harness.inbox.accept(submission);
  const found = await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  );
  const epoch = found[0]?.["epoch"];
  if (typeof epoch !== "string")
    throw new Error("ticket projection case: the harness established no epoch");
  const seeding = await harness.begin();
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=$3, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$4`,
    [partition.tenant, partition.project, seq, submission.operation],
  );
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES ($1,$2,$3,'{}',$4,'genesis','owner',1,$5,'Operation',$6)`,
    [
      partition.tenant,
      partition.project,
      seq,
      `digest-projection-${String(seq)}`,
      epoch,
      submission.operation,
    ],
  );
  await seeding.commit();
}

/**
 * A row no decision has moved since the projection grew the column. It reads as
 * a ticket whose resume point is not known rather than as one parked at the
 * machine's absent value, which is why the column is not defaulted.
 */
test("a row written before the resume point existed serves none", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-older",
  );
  await seedEntryAt(partition, 1);
  await harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,$3,'Escalated',1)`,
    [partition.tenant, partition.project, subject],
  );
  const reads = postgresNativeReads(pool);
  const older = await reads.ticket(partition, subject);
  assert.equal(older?.phase, "Escalated");
  assert.equal(older?.resumeAt, undefined);
});

/**
 * The resume constraint migration 054 added, against a row carrying the defect
 * it names and against every point the machine stamps — a claim about a
 * constraint is worth what the constraint is worth.
 */
test("the projection refuses a resume point the machine never stamps", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-constraints",
  );
  const columns = (rest: string) =>
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,${rest}`;
  await assert.rejects(
    harness.query(
      columns("resume_at) VALUES ($1,$2,$3,'Escalated',1,'ResumeNowhere')"),
      [partition.tenant, partition.project, 1],
    ),
    /ticket_projection_resume_is_known/u,
  );
  for (const point of resumePoints)
    await assert.doesNotReject(
      harness.query(
        columns(`resume_at) VALUES ($1,$2,$3,'Escalated',1,'${point}')`),
        [partition.tenant, partition.project, resumePoints.indexOf(point) + 2],
      ),
      `the check admits ${point}, which is a point the machine stamps`,
    );
});
