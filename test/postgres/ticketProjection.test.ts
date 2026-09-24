/**
 * The escalation, driven onto a real ticket by real decisions and read back
 * off the durable projection, the public read and the change row the same
 * decision appended.
 *
 * THE JOURNAL IS THE ORACLE. Every step compares the stored row with the graph
 * the same decision left behind, because the projection's whole claim is that
 * it is a read of one post-state — a column right at the end and wrong in the
 * middle is a column a reader believes.
 *
 * THE WALL IS THE STATE WORTH DRIVING TO. The escalation is the machine's
 * absent value everywhere else, so a fixture that stopped at `Work` would
 * assert the projection carries a column rather than that it carries the
 * machine.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import type {
  TaskIdentity,
  TaskTerminalReport,
} from "../../src/domain/generated/modelTypes.ts";
import type { TicketResource } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { escalationTags } from "../../src/domain/generated/modelTypes.ts";
import { id, stoppedReport } from "../domain/fixtures.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessDrain,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReport,
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
  readonly escalation: string;
}

async function projected(partition: Partition): Promise<ProjectedRow> {
  const found = await harness.query(
    `SELECT phase, escalation
       FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, subject],
  );
  const row = found[0];
  if (row === undefined)
    throw new Error("ticket projection case: the ticket has no row");
  return row as unknown as ProjectedRow;
}

/** The same facts read off the replayed graph, which is what the row must equal. */
function carried(memory: ProjectMemory): ProjectedRow {
  const ticket = ticketAt(memory.graph, subject);
  return { phase: ticket.phase, escalation: ticket.escalation };
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
  task: TaskIdentity,
  verdict: "Pass" | "Fail",
): Promise<ProjectMemory> {
  return reportedWith(
    partition,
    memory,
    postgresHarnessReport(memory.graph, task, verdict),
  );
}

/** The same, under a report the verdict pairing has no name for. */
async function reportedWith(
  partition: Partition,
  memory: ProjectMemory,
  report: TaskTerminalReport,
): Promise<ProjectMemory> {
  await postgresHarnessCompletion(
    harness,
    partition,
    `operation-projection-${randomUUID()}`,
    reportTaskTerminalCommand(report),
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
  for (const cycle of [1, 2]) {
    memory = await reported(partition, memory, workTaskOf(1, cycle), "Pass");
    memory = await reported(
      partition,
      memory,
      evaluationTaskOf(1, cycle, 1, 1, 1),
      "Fail",
    );
  }
  memory = await reported(partition, memory, workTaskOf(1, 3), "Pass");
  return reported(partition, memory, evaluationTaskOf(1, 3, 1, 1, 1), "Fail");
}

test("the projection carries the wall's escalation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-wall",
  );
  const memory = await walled(partition, "projection-wall");
  assert.deepEqual(await projected(partition), {
    phase: "Escalated",
    escalation: "EvaluationFailureEscalated",
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

test("the public read serves the escalation the row holds", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-read",
  );
  await walled(partition, "projection-read");
  const reads = postgresNativeReads(pool);
  const parked = await reads.ticket(partition, subject);
  assert.equal(parked?.phase, "Escalated");
  assert.deepEqual(parked?.escalation, {
    kind: "EvaluationFailureEscalated",
    resumeAt: "ResumeRework",
  });
  for (const order of ["Identity", "RecentActivity"] as const) {
    assert.deepEqual((await listed(partition, order)).escalation, {
      kind: "EvaluationFailureEscalated",
      resumeAt: "ResumeRework",
    });
  }
});

/** Answers the ticket's open action with a resume and drains the one decision it earns. */
async function resumed(
  partition: Partition,
  memory: Parameters<typeof postgresHarnessDrain>[2],
  submission: string,
): Promise<Awaited<ReturnType<typeof postgresHarnessDrain>>> {
  const action = await openAction(partition);
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, submission),
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
  return drained;
}

test("a resume clears the escalation it re-entered at", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-resume",
  );
  const memory = await walled(partition, "projection-resume");
  const drained = await resumed(partition, memory, "projection-resume-answer");
  assert.deepEqual(await projected(partition), {
    phase: "Work",
    escalation: "NoEscalation",
  });
  assert.deepEqual(await projected(partition), carried(drained.memory));
  const reads = postgresNativeReads(pool);
  assert.equal((await reads.ticket(partition, subject))?.escalation, undefined);
});

/**
 * A stopped evaluator is an absence of an answer rather than a judgement, so
 * the stage parks the ticket instead of concluding it and the resume comes
 * back for that evaluator alone, at the next generation and a fresh number.
 */
test("a stopped evaluator parks the ticket and its resume re-asks that evaluator", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-stopped",
  );
  let memory = await postgresHarnessHistory(
    harness,
    partition,
    "projection-stopped",
    postgresHarnessJournal().length,
  );
  memory = await reported(partition, memory, workTaskOf(1, 1), "Pass");
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  memory = await reportedWith(
    partition,
    memory,
    stoppedReport(judge, "ProcessFailure"),
  );
  assert.deepEqual(await projected(partition), {
    phase: "Escalated",
    escalation: "EvaluationBlockedEscalated",
  });
  await resumed(partition, memory, "projection-stopped-answer");
  assert.deepEqual(await projected(partition), {
    phase: "Evaluation",
    escalation: "NoEscalation",
  });
  assert.deepEqual(
    await harness.query(
      `SELECT task::text AS task, generation::text AS generation,
              evaluator::text AS evaluator
         FROM execution_request_task
        WHERE tenant=$1 AND project=$2 AND kind='Evaluation'
        ORDER BY task`,
      [partition.tenant, partition.project],
    ),
    [
      { task: "2", generation: "1", evaluator: "1" },
      { task: "3", generation: "2", evaluator: "1" },
    ],
  );
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
     VALUES ($1,$2,$3,jsonb_build_object('seq',$3::bigint,'event',
               jsonb_build_object('type','TicketRevoked','value',1))::text,
             $4,'genesis','owner',1,$5,'Operation',$6)`,
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
 * A row naming no escalation, which the column's default is and the phase
 * contradicts. The read answers the escalation it holds rather than deriving
 * one from the phase, so such a row serves none.
 */
test("a row that names no escalation serves none", async () => {
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
  assert.equal(older?.escalation, undefined);
});

/**
 * The two escalation constraints migration 008 added, against rows carrying
 * the defects they name and against every escalation the machine stamps — a
 * claim about a constraint is worth what the constraint is worth.
 */
test("the projection refuses an escalation the machine never stamps", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "projection-constraints",
  );
  const columns = (rest: string) =>
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,${rest}`;
  await assert.rejects(
    harness.query(
      columns("escalation) VALUES ($1,$2,$3,'Escalated',1,'Nowhere')"),
      [partition.tenant, partition.project, 1],
    ),
    /ticket_projection_escalation_is_known/u,
  );
  await assert.rejects(
    harness.query(
      columns(
        "escalation,escalation_evidence) VALUES ($1,$2,$3,'Work',1,'NoEscalation','RuntimeVersionUnsupported')",
      ),
      [partition.tenant, partition.project, 2],
    ),
    /ticket_projection_evidence_needs_an_escalation/u,
  );
  for (const tag of escalationTags)
    await assert.doesNotReject(
      harness.query(
        columns(`escalation) VALUES ($1,$2,$3,'Escalated',1,'${tag}')`),
        [partition.tenant, partition.project, escalationTags.indexOf(tag) + 3],
      ),
      `the check admits ${tag}, which is an escalation the machine stamps`,
    );
});
