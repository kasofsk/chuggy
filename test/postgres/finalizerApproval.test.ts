/**
 * The answer a person gives to a finalization approval: the two the server
 * offers, the pairing it holds every offered answer to, the settlement that
 * journals nothing, and the standing the finalizer then reads.
 *
 * THE ANSWER IS PROVED BY THE JOURNAL AND NOT BY THE CALL. Approval is
 * operational protocol rather than `Core` state, so the cases about answering
 * count `journal_entry` and read the ticket projection either side of it; an
 * answer that was recorded and journaled anyway would satisfy any weaker
 * assertion.
 *
 * THE ANSWER GOES IN THE WAY A PERSON OFFERS IT. It reaches the mailbox through
 * the acceptance door as an ordinary `ResolveNativeAction` and is decided by the
 * real project writer, so what a case proves is the path rather than the row it
 * would have liked the path to write.
 *
 * WHAT REACHES THE STREAM IS PROVED BY THE LOG AND NOT BY A CALL. Neither door
 * publishes: a trigger on `native_action` appends inside the boundary function
 * that opens the ask and inside the transaction that answers it, so the case
 * reads `project_change` either side of each rather than asserting something
 * was invoked.
 *
 * AN UNANSWERED ASK IS PROVED DEAD BY THE ROW THAT FOLLOWS IT. `native_action`
 * admits one open row per ticket, so the case about a ticket leaving the phase
 * drives the writer on to the escalation the same ticket then needs: a
 * withdrawal that did not happen is a unique violation inside the deciding
 * transaction, which no assertion about the approval row alone would reach.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import type {
  ApprovalStanding,
  FinalizationClaim,
  FinalizerStore,
} from "../../src/interpreter/finalizer.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  finalizerAccept,
  finalizerClaim,
  finalizerDrain,
  finalizerExpireClaim,
  finalizerIdentity,
  finalizerPassOnce,
  finalizerPhase,
  finalizerPrepare,
  finalizerProject,
  finalizerRemotePort,
  finalizerRequestApproval,
  finalizerRigOpen,
  finalizerSubject,
  finalizerTaskDone,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import type pg from "pg";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import type { NativeReadStore } from "../../src/interpreter/nativeWeb.ts";
import { postgresHarnessSubmission, postgresHarnessUrl } from "./harness.ts";

let rig: FinalizerRig;
let store: FinalizerStore;
let readPool: pg.Pool;
let reads: NativeReadStore;
before(async () => {
  rig = await finalizerRigOpen();
  store = postgresFinalizer(rig.pool);
  readPool = postgresPool(postgresHarnessUrl());
  reads = postgresNativeReads(readPool);
});
after(async () => {
  await readPool.end();
  await rig.close();
});

/** One project holding a claimed request, one prepared attempt, and the ask that was opened on it. */
interface ApprovalCase {
  readonly project: FinalizerProject;
  readonly claim: FinalizationClaim;
  readonly attempt: string;
  readonly action: string;
}

/** A project whose prepared candidate is waiting on a person, asked for through the door. */
async function asked(label: string): Promise<ApprovalCase> {
  const project = await finalizerProject(rig, label);
  const claim = await finalizerClaim(
    rig,
    project,
    finalizerIdentity(`owner-${label}`),
  );
  const attempt = await finalizerPrepare(rig, project, label, {
    approvalRequired: true,
  });
  const action = finalizerIdentity(`action-${label}`);
  assert.equal(
    (await finalizerRequestApproval(rig, project, attempt, action))["result"],
    "Requested",
  );
  return { project, claim, attempt, action };
}

/** How many entries this project's journal holds, which an answer may not move. */
async function entries(project: FinalizerProject): Promise<number> {
  const counted = await rig.harness.query(
    `SELECT count(*)::text AS held FROM journal_entry
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  return Number((counted[0] ?? { held: "-1" })["held"]);
}

/** What the ticket projection says, which an answer may not move either. */
async function projected(
  project: FinalizerProject,
): Promise<Record<string, unknown>> {
  const found = await rig.harness.query(
    `SELECT phase, seq::text AS seq FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  return found[0] ?? { phase: "no row" };
}

/** What one action row currently says about itself and the answer it carries. */
async function actionRow(
  subject: ApprovalCase,
): Promise<Record<string, unknown>> {
  const found = await rig.harness.query(
    `SELECT state, resolution FROM native_action
      WHERE tenant=$1 AND project=$2 AND action=$3`,
    [
      subject.project.partition.tenant,
      subject.project.partition.project,
      subject.action,
    ],
  );
  return found[0] ?? { state: "no row" };
}

/** Offers one answer the way a person holding the capability does, and reports what acceptance said. */
async function answer(
  subject: ApprovalCase,
  resolution: NativeActionResolution,
  label: string,
): Promise<string> {
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(subject.project.partition, label),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: subject.action,
      authorizingSeq: subject.project.authorizingSeq,
      resolution,
    },
  });
  return accepted.accepted;
}

/** Where the finalizer holding this request's claim reads the approval as standing. */
async function standing(
  subject: ApprovalCase,
): Promise<ApprovalStanding | undefined> {
  return (await store.durableView(subject.claim))?.approval;
}

test("the door offers exactly the two answers an approval admits", async () => {
  const subject = await asked("offer");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT resolution FROM native_action_resolution
        WHERE tenant=$1 AND project=$2 AND action=$3 ORDER BY resolution`,
      [
        subject.project.partition.tenant,
        subject.project.partition.project,
        subject.action,
      ],
    ),
    [{ resolution: "Approve" }, { resolution: "Decline" }],
  );
  assert.deepEqual(await actionRow(subject), {
    state: "Open",
    resolution: null,
  });
});

test("the public read publishes the ask, its fence, and its two answers", async () => {
  const subject = await asked("published");
  const ticket = asTicketId(subject.project.ticket);
  assert.deepEqual(
    await reads.ticketNativeActions(subject.project.partition, ticket),
    [
      {
        action: subject.action,
        kind: "FinalizationApproval",
        authorizingSequence: subject.project.authorizingSeq,
        admits: ["Approve", "Decline"],
      },
    ],
  );
  assert.equal(await answer(subject, "Approve", "published"), "Accepted");
  await finalizerDrain(
    rig.harness,
    subject.project.partition,
    subject.project.memory,
  );
  assert.deepEqual(
    await reads.ticketNativeActions(subject.project.partition, ticket),
    [],
  );
});

/** Every change this project has appended, oldest first, as kind and resource. */
async function changes(project: FinalizerProject): Promise<readonly string[]> {
  const found = await rig.harness.query(
    `SELECT kind, resource FROM project_change
      WHERE tenant=$1 AND project=$2 ORDER BY sequence`,
    [project.partition.tenant, project.partition.project],
  );
  return found.map(
    (row) => `${String(row["kind"])} ${String(row["resource"])}`,
  );
}

test("opening an approval and answering it each append a change naming the ticket", async () => {
  const label = "streamed";
  const project = await finalizerProject(rig, label);
  const claim = await finalizerClaim(
    rig,
    project,
    finalizerIdentity(`owner-${label}`),
  );
  const attempt = await finalizerPrepare(rig, project, label, {
    approvalRequired: true,
  });
  const named = `NativeAction ${String(project.ticket)}`;
  const before = await changes(project);
  const action = finalizerIdentity(`action-${label}`);
  assert.equal(
    (await finalizerRequestApproval(rig, project, attempt, action))["result"],
    "Requested",
  );
  const opened = await changes(project);
  assert.deepEqual(opened.slice(before.length), [named]);

  const subject = { project, claim, attempt, action };
  assert.equal(await answer(subject, "Decline", label), "Accepted");
  await finalizerDrain(rig.harness, project.partition, project.memory);
  const settled = (await changes(project)).slice(opened.length);
  assert.deepEqual(
    settled.filter((change) => change.startsWith("NativeAction ")),
    [named],
  );
});

test("an answer settles its operation and leaves the journal and the ticket alone", async () => {
  const subject = await asked("grant");
  const before = await entries(subject.project);
  const phase = await projected(subject.project);
  assert.equal(await answer(subject, "Approve", "grant"), "Accepted");
  const drained = await finalizerDrain(
    rig.harness,
    subject.project.partition,
    subject.project.memory,
  );
  assert.deepEqual(drained.decided, ["Answered"]);
  assert.equal(await entries(subject.project), before);
  assert.deepEqual(await projected(subject.project), phase);
  assert.deepEqual(await actionRow(subject), {
    state: "Resolved",
    resolution: "Approve",
  });
  assert.equal(await standing(subject), "Granted");
});

test("a declined candidate is the same settlement carrying the other answer", async () => {
  const subject = await asked("decline");
  const before = await entries(subject.project);
  assert.equal(await answer(subject, "Decline", "decline"), "Accepted");
  const drained = await finalizerDrain(
    rig.harness,
    subject.project.partition,
    subject.project.memory,
  );
  assert.deepEqual(drained.decided, ["Answered"]);
  assert.equal(await entries(subject.project), before);
  assert.deepEqual(await actionRow(subject), {
    state: "Resolved",
    resolution: "Decline",
  });
  assert.equal(await standing(subject), "Declined");
});

test("an answered operation is terminal, and the same action is not answered twice", async () => {
  const subject = await asked("once");
  assert.equal(await answer(subject, "Approve", "once"), "Accepted");
  await finalizerDrain(
    rig.harness,
    subject.project.partition,
    subject.project.memory,
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT d.state, d.decided_seq FROM decision_input d
         JOIN operation o ON o.tenant=d.tenant AND o.project=d.project
              AND o.operation=d.input_id
        WHERE d.tenant=$1 AND d.project=$2 AND o.command_tag='ResolveNativeAction'`,
      [subject.project.partition.tenant, subject.project.partition.project],
    ),
    [{ state: "Answered", decided_seq: null }],
  );
  assert.equal(await answer(subject, "Decline", "once-more"), "InvalidCommand");
});

test("an escalation's answer and an approval's answer are not interchangeable", async () => {
  const subject = await asked("pairing");
  const escalation = finalizerIdentity("escalation-pairing");
  await rig.harness.query(
    `INSERT INTO native_action
       (tenant, project, action, authorizing_seq, effect_position, ticket,
        action_version, kind, reason, required_capability, state)
     VALUES ($1,$2,$3,$4,9,$5,$4,'TicketEscalation','WorkFailed','ResolveTicket','Withdrawn')`,
    [
      subject.project.partition.tenant,
      subject.project.partition.project,
      escalation,
      subject.project.authorizingSeq,
      subject.project.ticket,
    ],
  );
  const offer = async (action: string, resolution: string): Promise<string> =>
    rig.ownerRefusal(
      `INSERT INTO native_action_resolution (tenant, project, action, resolution)
       VALUES ($1,$2,$3,$4)`,
      [
        subject.project.partition.tenant,
        subject.project.partition.project,
        action,
        resolution,
      ],
    );
  assert.match(
    await offer(subject.action, "Resume"),
    /Resume is not an answer a FinalizationApproval asks for/u,
  );
  assert.match(
    await offer(escalation, "Approve"),
    /Approve is not an answer a TicketEscalation asks for/u,
  );
});

test("an action records only an answer it offered, and records one exactly when resolved", async () => {
  const subject = await asked("whole");
  const set = async (
    state: string,
    resolution: string | null,
  ): Promise<string> =>
    rig.ownerRefusal(
      `UPDATE native_action SET state=$2, resolution=$3
        WHERE tenant=$4 AND project=$5 AND action=$1`,
      [
        subject.action,
        state,
        resolution,
        subject.project.partition.tenant,
        subject.project.partition.project,
      ],
    );
  assert.match(await set("Resolved", null), /native_action_answer_is_whole/u);
  assert.match(await set("Open", "Approve"), /native_action_answer_is_whole/u);
  assert.match(
    await set("Resolved", "Resume"),
    /native_action_answers_with_one_it_offered/u,
  );
});

/** Every action this project's ticket has ever carried, and what became of each. */
async function actionsOf(
  project: FinalizerProject,
): Promise<readonly Record<string, unknown>[]> {
  return rig.harness.query(
    `SELECT kind, state FROM native_action
      WHERE tenant=$1 AND project=$2 AND ticket=$3 ORDER BY kind`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
}

/** The one task the rework spawned, which is the one a case then fails. */
function outstandingTaskOf(
  project: FinalizerProject,
  memory: Awaited<ReturnType<typeof finalizerDrain>>["memory"],
): number {
  const tasks = [
    ...ticketAt(memory.core, asTicketId(project.ticket)).tasks,
  ].filter((task) => task.state === "Outstanding");
  const task = tasks[0];
  if (tasks.length !== 1 || task === undefined) {
    throw new Error("finalizer approval: the rework spawned no single task");
  }
  return task.id;
}

test("an ask the phase outlived is withdrawn, and the next desk task can be opened", async () => {
  const label = "outlived";
  const { project } = await finalizerSubject(rig, label, [
    { path: "one.txt", content: "one\n" },
  ]);
  await finalizerClaim(rig, project, finalizerIdentity(`owner-${label}`));
  const attempt = await finalizerPrepare(rig, project, label, {
    approvalRequired: true,
  });
  const action = finalizerIdentity(`action-${label}`);
  assert.equal(
    (await finalizerRequestApproval(rig, project, attempt, action))["result"],
    "Requested",
  );

  await finalizerPrepare(rig, project, `${label}-refenced`, {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  await finalizerExpireClaim(rig, project);
  assert.equal(
    (
      await finalizerPassOnce(
        rig,
        project,
        finalizerRemotePort(rig),
        `${label}-end`,
      )
    ).conclusions,
    1,
  );

  const reworked = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(reworked.decided, ["Committed"]);
  assert.equal(await finalizerPhase(rig, project.partition), "Working");
  assert.deepEqual(await actionsOf(project), [
    { kind: "FinalizationApproval", state: "Withdrawn" },
  ]);

  assert.equal(
    await finalizerAccept(
      rig.harness,
      project.partition,
      `${label}-failed`,
      finalizerTaskDone(outstandingTaskOf(project, reworked.memory), "Fail"),
    ),
    "Accepted",
  );
  const escalated = await finalizerDrain(
    rig.harness,
    project.partition,
    reworked.memory,
  );
  assert.deepEqual(escalated.decided, ["Committed", "Committed"]);
  assert.equal(await finalizerPhase(rig, project.partition), "Escalated");
  assert.deepEqual(await actionsOf(project), [
    { kind: "FinalizationApproval", state: "Withdrawn" },
    { kind: "TicketEscalation", state: "Open" },
  ]);
});
