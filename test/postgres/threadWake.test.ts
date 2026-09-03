/**
 * The wake pass over a real PostgreSQL, driven by the role its three definers
 * are granted to: a refusal against a ticket a member's draft revision
 * authored, one pass, one `Wake` turn in that member's mailbox, and a second
 * pass that writes nothing.
 *
 * THE CURSOR AND THE CANDIDATE READ ARE INSTALLATION-WIDE, so every case here
 * moves the cursor to the change log's head before it makes its own rows. A
 * case that started from where an earlier suite of the same worker left the
 * cursor would be reading that suite's projects, and would pass or fail on
 * them.
 *
 * WHAT THIS SUITE ADDS TO `threadWake.test.ts` is the one thing a stub cannot
 * answer: whether the pass's derived turn identity is the identity the door
 * treats as already enqueued, and whether the document it composes is a
 * document the column takes and the reader parses back.
 *
 * WHERE A MAILBOX STARTS IS THIS SUITE'S TOO, because the cursor and the
 * session row are two facts only a real candidate read distinguishes: the
 * cursor says how far the pass has read, and 067's `opened_after_sequence` says
 * what the thread was opened after. The case that separates them runs its pass
 * over a window holding a change from each side of the opening.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  threadTurnsAnsweredMax,
  threadWakesPerPassMax,
} from "../../src/contract/http.ts";
import {
  asConfigurationRevisionId,
  type ConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  parseThreadWake,
  threadWakeDocument,
  threadWakeText,
} from "../../src/interpreter/thread.ts";
import {
  threadWakePass,
  threadWakeTurn,
  type ThreadWakeService,
} from "../../src/interpreter/threadWake.ts";
import { asSessionTurnId } from "../../src/interpreter/agentSession.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessBrief,
  postgresHarnessConfiguration,
} from "./harness.ts";
import { leadRigDecision } from "./leadHarness.ts";
import {
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigRevoke,
  threadRigThread,
  threadRigTurnId,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";

let rig: ThreadRig;

before(async () => {
  rig = await threadRigOpen();
});

after(async () => {
  await rig.close();
});

const instant = "2026-09-02T12:00:00.000Z";

function service(wakesPerPassMax: number): ThreadWakeService {
  return {
    store: rig.wakes,
    clock: { nowIso: () => instant },
    wakesPerPassMax,
  };
}

/** Moves the installation's cursor to the log's head, so a case reads its own rows alone. */
async function fromTheHead(): Promise<number> {
  const rows = await rig.sessions.harness.query(
    "SELECT coalesce(max(sequence),0)::text AS head FROM project_change",
  );
  return rig.wakes.advance(Number(rows[0]?.["head"]));
}

async function configuration(
  partition: Partition,
): Promise<ConfigurationRevisionId> {
  const revision = asConfigurationRevisionId(
    `config-wake-${partition.project}`,
  );
  const created = await rig.sessions.harness.authoring.createConfiguration({
    partition,
    authority: {
      kind: asAuthorityKind("System"),
      subject: asAuthoritySubject("thread wake suite"),
    },
    revision,
    canonical: postgresHarnessConfiguration,
  });
  if (created.created !== "Created")
    throw new Error(`thread wake: configuration answered ${created.created}`);
  return revision;
}

/** One open draft the member authored, which is the revision the wake join follows. */
async function draft(
  partition: Partition,
  revision: ConfigurationRevisionId,
  member: ThreadRigMember,
): Promise<TicketId> {
  const { authoring } = rig.sessions.harness;
  const initialized = await authoring.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("thread wake: the draft was not initialized");
  const created = await authoring.createDraft({
    partition,
    authority: member.authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (created.created !== "Created")
    throw new Error(`thread wake: the draft answered ${created.created}`);
  return created.draft.ticket;
}

/** Refuses one of the member's tickets, which is the change a `TicketRefused` wake is derived from. */
async function refuse(
  partition: Partition,
  label: string,
  ticket: TicketId,
): Promise<void> {
  const decision = await leadRigDecision(rig, partition, `${label}-refusal`);
  await rig.writes.record({
    partition,
    decision,
    refusals: [{ ticket, ticketVersion: 1, reason: "not yet" }],
    lifts: [],
  });
}

test("a refusal against a member's own ticket becomes one Wake turn, once", async () => {
  const partition = await threadRigProject(rig, "wakepass");
  const member = await threadRigMember(rig, partition, "wakepass");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member);
  const started = await fromTheHead();
  await refuse(partition, "wakepass", ticket);

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(report, {
    read: 1,
    woken: 1,
    skipped: 0,
    cursor: report.cursor,
  });
  assert.ok(report.cursor > started, "the pass did not move the cursor");

  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(standing?.turns.length, 1);
  const turn = standing?.turns[0];
  assert.ok(turn !== undefined);
  assert.equal(turn.inputKind, "Wake");
  assert.equal(
    turn.turn,
    threadWakeTurn({
      sequence: report.cursor,
      partition,
      reason: "TicketRefused",
      resource: String(ticket),
      principal: member.principal,
      session: thread.session,
    }),
    "the turn the door holds is the identity the pass derives, or a replay is a second turn",
  );
  const document = parseThreadWake(turn.input);
  assert.equal(document.wake, "TicketRefused");
  assert.equal(document.resource, String(ticket));
  assert.equal(document.at, instant);

  const again = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(again, {
    read: 0,
    woken: 0,
    skipped: 0,
    cursor: report.cursor,
  });
  const settled = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(settled?.turns.length, 1, "a second pass wrote a second turn");
});

test("a pass whose cursor was not moved re-offers the same turn and is told so", async () => {
  const partition = await threadRigProject(rig, "wakereplay");
  const member = await threadRigMember(rig, partition, "wakereplay");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member);
  const started = await fromTheHead();
  await refuse(partition, "wakereplay", ticket);

  const raising: ThreadWakeService = {
    ...service(threadWakesPerPassMax),
    store: {
      ...rig.wakes,
      advance: () => {
        throw new Error(
          "the process ended between the enqueue and the advance",
        );
      },
    },
  };
  await assert.rejects(() => threadWakePass(raising));
  assert.equal(
    await rig.wakes.cursor(),
    started,
    "a pass that raised out of the advance moved the cursor anyway",
  );

  const resumed = await threadWakePass(service(threadWakesPerPassMax));
  assert.equal(resumed.read, 1);
  assert.equal(resumed.woken, 1);
  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(
    standing?.turns.length,
    1,
    "the replayed candidate became a second turn, so the identity is not derived",
  );
});

test("a change for a closed thread is read by nobody and moves the cursor by itself", async () => {
  const partition = await threadRigProject(rig, "wakeclosed");
  const member = await threadRigMember(rig, partition, "wakeclosed");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member);
  await rig.sessions.sessions.close(partition, thread.session);
  const started = await fromTheHead();
  await refuse(partition, "wakeclosed", ticket);

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(
    report,
    { read: 0, woken: 0, skipped: 0, cursor: started },
    "a closed thread is no candidate, so the pass has nothing to move past",
  );
});

/**
 * The one arm of the wake door the candidate read can never produce and the
 * adapter must still map. The read requires a membership, so a member whose
 * membership went between the read and the wake is a RACE — and an unmapped
 * verdict is a raise out of the pass, which ends the selector's loop for good.
 */
test("a wake offered a thread whose owner's membership is gone is orphaned, not a raise", async () => {
  const partition = await threadRigProject(rig, "wakeorphan");
  const member = await threadRigMember(rig, partition, "wakeorphan");
  await threadRigThread(rig, partition, member);
  await threadRigRevoke(rig, partition, member);

  assert.deepEqual(
    await rig.wakes.wake({
      partition,
      principal: member.principal,
      turn: asSessionTurnId(threadRigTurnId("wakeorphan")),
      input: threadWakeText(
        threadWakeDocument({
          wake: "TicketRefused",
          resource: "1",
          at: instant,
        }),
      ),
    }),
    { woken: "Orphaned" },
  );
});

/** Lifts the standing refusal on one of the member's tickets, which is a second change on it. */
async function lift(
  partition: Partition,
  label: string,
  ticket: TicketId,
): Promise<void> {
  const decision = await leadRigDecision(rig, partition, `${label}-lift`);
  await rig.writes.record({
    partition,
    decision,
    refusals: [],
    lifts: [{ ticket }],
  });
}

/**
 * The window this case runs over holds BOTH changes on the same ticket, and the
 * cursor is below both: what separates them is the log's position the thread
 * was opened after. A pass that read the earlier one would be the rig's finding
 * (kasofsk/chuggy#541) in miniature — a mailbox filled with what happened
 * before its owner had one.
 */
test("a thread is woken by a change after it opened, and by none the log held before", async () => {
  const partition = await threadRigProject(rig, "wakestart");
  const member = await threadRigMember(rig, partition, "wakestart");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member);
  const started = await fromTheHead();
  await refuse(partition, "wakestart", ticket);
  const thread = await threadRigThread(rig, partition, member);

  const quiet = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(
    quiet,
    { read: 0, woken: 0, skipped: 0, cursor: started },
    "a change from before the thread was opened is a candidate for it",
  );
  const opened = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(
    opened?.turns.length,
    0,
    "the thread's mailbox holds a notice about something that happened before it existed",
  );

  await lift(partition, "wakestart", ticket);
  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.equal(report.read, 1, "the window holds both changes and read both");
  assert.equal(report.woken, 1);
  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(standing?.turns.length, 1);
  const turn = standing?.turns[0];
  assert.ok(turn !== undefined);
  assert.equal(parseThreadWake(turn.input).wake, "RefusalLifted");
});

/**
 * The negative space that keeps the position a fact about the opening. It is
 * written by the INSERT `open_member_thread` makes and by nothing else, so no
 * role holds `UPDATE` on it — the roster a thread holds is the column beside it
 * that one role may move, and it is asked for here so a probe that could not
 * see a privilege at all would be visible.
 */
test("no role may move the log position a thread was opened after", async () => {
  const roles = [
    boundaryOwnerRole,
    apiRole,
    selectorServiceRole,
    schedulerRole,
    workerPlaneRole,
    ticketServiceRole,
    finalizerRole,
    configurationImporterRole,
  ];
  for (const role of roles) {
    const rows = await rig.sessions.harness.query(
      `SELECT has_column_privilege($1,'agent_session','opened_after_sequence','UPDATE') AS moves,
              has_column_privilege($1,'agent_session','capabilities','UPDATE') AS reconfigures`,
      [role],
    );
    assert.equal(
      rows[0]?.["moves"],
      false,
      `${role} may rewrite what a thread is woken by`,
    );
    assert.equal(
      rows[0]?.["reconfigures"],
      role === boundaryOwnerRole,
      `the probe disagrees with 062's own grant for ${role}`,
    );
  }
});

/**
 * The other half of the column's negative space: a position below the log's own
 * start is not a position, and the constraint says so where the grant cannot —
 * the identity that owns the schema is not bound by a grant.
 */
test("a thread cannot be opened after a sequence the log never held", async () => {
  const partition = await threadRigProject(rig, "wakenegative");
  const member = await threadRigMember(rig, partition, "wakenegative");
  const thread = await threadRigThread(rig, partition, member);

  await assert.rejects(
    () =>
      rig.sessions.harness.query(
        "UPDATE agent_session SET opened_after_sequence=-1 WHERE session=$1",
        [thread.session],
      ),
    /agent_session_opens_after_a_sequence/u,
  );
});
