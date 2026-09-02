/**
 * The lifecycle of one agent session against a real server: what may be opened,
 * what a mailbox does with the turns it is given, and what closing one does to
 * the turns it never finished.
 *
 * THE UNIQUENESS RULES ARE THE SERVER'S. One lead per project and one open
 * thread per member are partial indexes, so every case here drives the boundary
 * rather than an adapter's opinion of it, and a rule that regressed to a
 * convention would show up as an opened session rather than as a conflict.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { sessionTurnBacklogMax } from "../../src/contract/http.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnId,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
before(async () => {
  rig = await sessionRigOpen();
});
after(async () => {
  await rig.close();
});

test("a session opens once, and offering the same one again is already open", async () => {
  const partition = await sessionRigProject(rig, "reopen");
  const session = await sessionRigSession(rig, partition, "reopen");
  assert.equal(
    await rig.sessions.open({
      partition,
      session,
      kind: "Lead",
      principal: asPrincipal("principal-reopen"),
      capabilities: ["RepositoryRead"],
      credentialSlot: "claude-code",
    }),
    "AlreadyOpen",
  );
  const stored = await rig.sessions.session(partition, session);
  assert.equal(stored?.kind, "Lead");
  assert.equal(stored?.state, "Open");
  assert.deepEqual(stored?.capabilities, ["RepositoryRead"]);
});

test("the same identity offered different facts is a conflict and changes nothing", async () => {
  const partition = await sessionRigProject(rig, "differs");
  const session = await sessionRigSession(rig, partition, "differs");
  assert.equal(
    await rig.sessions.open({
      partition,
      session,
      kind: "Lead",
      principal: asPrincipal("someone-else"),
      capabilities: ["RepositoryRead"],
      credentialSlot: "claude-code",
    }),
    "Conflict",
  );
  assert.equal(
    (await rig.sessions.session(partition, session))?.principal,
    "principal-differs",
  );
});

test("a project holds one lead, and a member holds one open thread", async () => {
  const partition = await sessionRigProject(rig, "one-of-each");
  await sessionRigSession(rig, partition, "lead");
  assert.equal(
    await rig.sessions.open({
      partition,
      session: asSessionId("session-second-lead"),
      kind: "Lead",
      principal: asPrincipal("principal-other"),
      capabilities: [],
      credentialSlot: "claude-code",
    }),
    "Conflict",
  );
  const thread = await sessionRigSession(rig, partition, "thread", {
    kind: "Thread",
    principal: "member",
  });
  assert.equal(
    await rig.sessions.open({
      partition,
      session: asSessionId("session-second-thread"),
      kind: "Thread",
      principal: asPrincipal("member"),
      capabilities: [],
      credentialSlot: "claude-code",
    }),
    "Conflict",
  );
  assert.equal(await rig.sessions.close(partition, thread), true);
  assert.equal(
    await rig.sessions.open({
      partition,
      session: asSessionId(`session-third-thread-${partition.project}`),
      kind: "Thread",
      principal: asPrincipal("member"),
      capabilities: [],
      credentialSlot: "claude-code",
    }),
    "Opened",
  );
});

test("an inquiry names a session of its own project to have forked from", async () => {
  const partition = await sessionRigProject(rig, "inquiry");
  const lead = await sessionRigSession(rig, partition, "inquiry-lead");
  const elsewhere = await sessionRigProject(rig, "inquiry-elsewhere");
  assert.equal(
    await rig.sessions.open({
      partition: elsewhere,
      session: asSessionId(`session-foreign-${elsewhere.project}`),
      kind: "Inquiry",
      principal: asPrincipal("principal-inquiry"),
      parent: lead,
      capabilities: [],
      credentialSlot: "claude-code",
    }),
    "Conflict",
  );
  const inquiry = await sessionRigSession(rig, partition, "inquiry-fork", {
    kind: "Inquiry",
    parent: lead,
  });
  assert.equal((await rig.sessions.session(partition, inquiry))?.parent, lead);
});

test("ordinals are contiguous from one and a re-offered turn keeps its own", async () => {
  const partition = await sessionRigProject(rig, "ordinals");
  const session = await sessionRigSession(rig, partition, "ordinals");
  const first = await sessionRigTurn(rig, partition, session, "first");
  await sessionRigTurn(rig, partition, session, "second");
  const third = await sessionRigTurn(rig, partition, session, "third");
  assert.deepEqual(
    (await rig.sessions.turns(partition, session, 10)).map(
      (turn) => turn.ordinal,
    ),
    [1, 2, 3],
  );
  assert.deepEqual(
    await rig.sessions.enqueue({
      partition,
      session,
      turn: first,
      inputKind: "Wake",
      input: "offered again",
    }),
    { enqueued: "AlreadyEnqueued", ordinal: 1 },
  );
  assert.equal(
    (await rig.sessions.turns(partition, session, 10)).find(
      (turn) => turn.turn === third,
    )?.ordinal,
    3,
  );
});

test("a mailbox refuses a turn above its backlog ceiling and takes one below it", async () => {
  const partition = await sessionRigProject(rig, "backlog");
  const session = await sessionRigSession(rig, partition, "backlog");
  for (let queued = 0; queued < sessionTurnBacklogMax; queued++) {
    const enqueued = await rig.sessions.enqueue({
      partition,
      session,
      turn: sessionRigTurnId(`backlog-${String(queued)}`),
      inputKind: "Observation",
      input: "queued",
    });
    assert.equal(enqueued.enqueued, "Enqueued");
  }
  assert.deepEqual(
    await rig.sessions.enqueue({
      partition,
      session,
      turn: sessionRigTurnId("over"),
      inputKind: "Observation",
      input: "one too many",
    }),
    { enqueued: "Backlogged" },
  );
});

test("closing a session abandons every turn it never finished and takes no more", async () => {
  const partition = await sessionRigProject(rig, "closing");
  const session = await sessionRigSession(rig, partition, "closing");
  await sessionRigTurn(rig, partition, session, "abandoned");
  assert.equal(await rig.sessions.close(partition, session), true);
  const turns = await rig.sessions.turns(partition, session, 10);
  assert.deepEqual(
    turns.map((turn) => [turn.state, turn.failure]),
    [["Abandoned", "SessionClosed"]],
  );
  assert.equal(
    (await rig.sessions.session(partition, session))?.state,
    "Closed",
  );
  assert.equal(await rig.sessions.close(partition, session), false);
  assert.deepEqual(
    await rig.sessions.enqueue({
      partition,
      session,
      turn: sessionRigTurnId("after-closing"),
      inputKind: "Wake",
      input: "too late",
    }),
    { enqueued: "Closed" },
  );
});

test("enqueuing for a session that was never opened is refused rather than absorbed", async () => {
  const partition = await sessionRigProject(rig, "unknown");
  await assert.rejects(
    rig.sessions.enqueue({
      partition,
      session: asSessionId("session-never-opened"),
      turn: sessionRigTurnId("orphan"),
      inputKind: "Wake",
      input: "nobody",
    }),
    /there is no session/u,
  );
});

test("the server itself admits one lead per project and one open thread per member", async () => {
  const partition = await sessionRigProject(rig, "indexed");
  const lead = await sessionRigSession(rig, partition, "indexed-lead");
  const thread = await sessionRigSession(rig, partition, "indexed-thread", {
    kind: "Thread",
    principal: "member-indexed",
  });
  await assert.rejects(
    rig.harness.query(
      `INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster)
       SELECT tenant,project,session||'-again',kind,principal||'-again',
              capabilities,credential_slot,account,cluster
         FROM agent_session WHERE session=$1`,
      [lead],
    ),
    /agent_session_one_lead_per_project/u,
  );
  await assert.rejects(
    rig.harness.query(
      `INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster)
       SELECT tenant,project,session||'-again',kind,principal,
              capabilities,credential_slot,account,cluster
         FROM agent_session WHERE session=$1`,
      [thread],
    ),
    /agent_session_one_thread_per_member/u,
  );
});

test("the trigger refuses each change a session row may never take back", async () => {
  const partition = await sessionRigProject(rig, "written-once");
  const session = await sessionRigSession(rig, partition, "written-once");
  const refuse = async (set: string, refusal: RegExp) => {
    await assert.rejects(
      rig.harness.query(`UPDATE agent_session SET ${set} WHERE session=$1`, [
        session,
      ]),
      refusal,
    );
  };
  await refuse(
    "principal=principal||'-else'",
    /would change what it was opened as/u,
  );
  await refuse(
    "turn_next=turn_next-1",
    /would reuse an ordinal or an attempt number/u,
  );
  await rig.harness.query(
    `UPDATE agent_session SET agent_reference='runtime-first' WHERE session=$1`,
    [session],
  );
  await refuse(
    "agent_reference='runtime-second'",
    /already runs under a runtime session/u,
  );
  await rig.sessions.close(partition, session);
  await refuse(
    "state='Open',closed_at=NULL",
    /is closed, and a closed session takes no more turns/u,
  );
});
