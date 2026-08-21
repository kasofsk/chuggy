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
import {
  finalizerClaim,
  finalizerDrain,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerRequestApproval,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessSubmission } from "./harness.ts";

let rig: FinalizerRig;
let store: FinalizerStore;
before(async () => {
  rig = await finalizerRigOpen();
  store = postgresFinalizer(rig.pool);
});
after(async () => {
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
