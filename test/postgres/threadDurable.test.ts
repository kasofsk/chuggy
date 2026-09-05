/**
 * What migration 062 adds, driven against a real PostgreSQL by the role each
 * door is granted to.
 *
 * EVERY CASE HERE IS ABOUT A CONTROL AND NOT ABOUT A SHAPE. A grant, a revoke,
 * a check, a trigger and a filter are each a claim about what the server
 * refuses, and the only way to hold one is to attempt the thing it refuses as
 * the identity that would attempt it. So the five thread doors are driven
 * through the API's role, the three wake doors through the selector's, the
 * roster door through the identity that owns the boundary, and every other role
 * is asked for each and refused.
 *
 * THE TWO OMISSIONS ARE THE CONTROLS. `open_member_thread` takes no capability
 * roster and `enqueue_thread_message` takes no session, so the cases that
 * matter most are the catalog ones: a suite that only ever passed the right
 * arguments would be green over a door that had grown a wrong one.
 *
 * THE WAKE REASONS ARE ASSERTED AS A SET AGAINST THE ROSTER, not one by one, so
 * a reason added to `allThreadWakeReasons` without an arm in the derivation is
 * a red rather than a member nothing produces.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  configurationImporterRole,
  finalizerRole,
  projectThreadsReadFunction,
  schedulerRole,
  selectorServiceRole,
  sessionStoreBatchesReadFunction,
  sessionStoreStreamListFunction,
  ticketServiceRole,
  threadMessageEnqueueFunction,
  threadOpenFunction,
  threadStandingReadFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { sessionChangeResourceSchema } from "../../src/contract/events.ts";
import {
  agentSessionPromptCharsMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  threadBacklogMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
  threadWakesPerPassMax,
} from "../../src/contract/http.ts";
import {
  asConfigurationRevisionId,
  type ConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  allThreadStandings,
  allThreadWakeReasons,
  threadCapabilitiesDefault,
  threadStanding,
  threadSystemPromptCharsMax,
  threadWakeDocument,
  threadWakeText,
  type ThreadWakeReason,
} from "../../src/interpreter/thread.ts";
import { threadEntry } from "../../src/interpreter/threadRead.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessBrief,
  postgresHarnessConfiguration,
  postgresHarnessDenial,
} from "./harness.ts";
import { leadRigDecision } from "./leadHarness.ts";
import { sessionRigProvision, sessionRigSession } from "./sessionHarness.ts";
import {
  threadRigMember,
  threadRigMemberAlso,
  threadRigOpen,
  threadRigProject,
  threadRigPrompt,
  threadRigRevoke,
  threadRigSiblingProject,
  threadRigSlot,
  threadRigThread,
  threadRigTicketPhase,
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

function project(label: string): Promise<Partition> {
  return threadRigProject(rig, label);
}

/** One configuration a draft may be authored against, on the owner's own pool. */
async function threadConfiguration(
  partition: Partition,
): Promise<ConfigurationRevisionId> {
  const revision = asConfigurationRevisionId(
    `config-thread-${partition.project}`,
  );
  const created = await rig.sessions.harness.authoring.createConfiguration({
    partition,
    authority: {
      kind: asAuthorityKind("System"),
      subject: asAuthoritySubject("thread durable suite"),
    },
    revision,
    canonical: postgresHarnessConfiguration,
  });
  if (created.created !== "Created")
    throw new Error(
      `thread durable: configuration answered ${created.created}`,
    );
  return revision;
}

/** One open draft authored by the member named, which is what the wake join follows. */
async function threadDraft(
  partition: Partition,
  revision: ConfigurationRevisionId,
  member: ThreadRigMember,
): Promise<TicketId> {
  const { authoring } = rig.sessions.harness;
  const initialized = await authoring.initializeDraft(partition, revision, 100);
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("thread durable: the draft was not initialized");
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
    throw new Error(`thread durable: the draft answered ${created.created}`);
  return created.draft.ticket;
}

/** Every role a deployment holds, so a case can ask each for a door it is not granted. */
const everyRuntimeRole = [
  apiRole,
  selectorServiceRole,
  schedulerRole,
  workerPlaneRole,
  ticketServiceRole,
  finalizerRole,
  configurationImporterRole,
];

/** Asks every role but the ones named for one statement, and refuses a role that may run it. */
async function onlyTheseRolesMay(
  granted: readonly string[],
  what: string,
  statement: string,
): Promise<void> {
  for (const role of everyRuntimeRole) {
    const refusal = await rig.sessions.harness.attemptAs(role, statement);
    if (granted.includes(role)) continue;
    assert.match(
      refusal ?? "",
      postgresHarnessDenial(what),
      `${role} may reach ${what}, and the narrowing is the whole control`,
    );
  }
}

/**
 * Waits until some statement on this server is waiting on a lock, which is what
 * the losing open does while the winner's transaction is open. A case that
 * slept a fixed time instead would be asserting about the machine it ran on.
 */
async function waitForABlockedStatement(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await rig.sessions.harness.query(
      `SELECT count(*)::text AS waiting FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND state='active'`,
    );
    if (Number(rows[0]?.["waiting"]) > 0) return;
    await new Promise((resume) => setTimeout(resume, 25));
  }
  throw new Error("thread durable: nothing ever blocked on the thread index");
}

test("a member's thread opens once and answers the session it already has", async () => {
  const partition = await project("open");
  const one = await threadRigMember(rig, partition, "one");
  const two = await threadRigMember(rig, partition, "two");

  const first = await threadRigThread(rig, partition, one);
  const again = await threadRigThread(rig, partition, one, "AlreadyOpen");
  assert.equal(again.session, first.session);
  assert.equal(first.owner, one.authority.subject);
  assert.equal(first.state, "Open");
  assert.equal(first.turns, 0);

  const other = await threadRigThread(rig, partition, two);
  assert.notEqual(other.session, first.session);
});

test("the roster a thread is opened with is the installation's own and no argument's", async () => {
  const partition = await project("roster");
  const member = await threadRigMember(rig, partition, "roster");
  const thread = await threadRigThread(rig, partition, member);

  const rows = await rig.sessions.harness.query(
    `SELECT capabilities,credential_slot,system_prompt,kind,principal
       FROM agent_session WHERE session=$1`,
    [thread.session],
  );
  assert.deepEqual(rows[0]?.["capabilities"], [...threadCapabilitiesDefault]);
  assert.equal(rows[0]?.["credential_slot"], threadRigSlot);
  assert.equal(rows[0]?.["system_prompt"], threadRigPrompt);
  assert.equal(rows[0]?.["kind"], "Thread");
  assert.equal(rows[0]?.["principal"], member.principal);

  const arguments_ = await rig.sessions.harness.query(
    `SELECT pg_get_function_arguments(p.oid) AS declared
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1`,
    [threadOpenFunction],
  );
  assert.equal(arguments_.length, 1);
  assert.doesNotMatch(
    String(arguments_[0]?.["declared"]),
    /text\[\]/u,
    "a door that took a roster could be talked into a wider thread",
  );
});

/**
 * The index the open door leans on, named where the door names it. 058 declares
 * it and 062's arms are written against it, so a case in 062's own suite is what
 * says the two agree: the pre-check and the `unique_violation` arm both answer
 * `AlreadyOpen`, and with the index gone neither is a control at all and a member
 * ends with two open threads.
 */
test("one member has one open thread, and the index is what says so", async () => {
  const partition = await project("oneopen");
  const member = await threadRigMember(rig, partition, "oneopen");
  const thread = await threadRigThread(rig, partition, member);

  const held = await rig.sessions.harness.query(
    `SELECT tenant,project,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt
       FROM agent_session WHERE session=$1`,
    [thread.session],
  );
  const row = held[0];
  assert.ok(row !== undefined);
  await assert.rejects(
    () =>
      rig.sessions.harness.query(
        `INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row["tenant"],
          row["project"],
          `${thread.session}-second`,
          row["kind"],
          row["principal"],
          row["capabilities"],
          row["credential_slot"],
          row["account"],
          row["cluster"],
          row["system_prompt"],
        ],
      ),
    /agent_session_one_thread_per_member/u,
    "a second open thread for one member is refused by the index, not by a body",
  );
});

test("a closed thread does not block a new one", async () => {
  const partition = await project("reopen");
  const member = await threadRigMember(rig, partition, "reopen");
  const first = await threadRigThread(rig, partition, member);

  assert.equal(
    await rig.sessions.sessions.close(partition, first.session),
    true,
  );
  const second = await threadRigThread(rig, partition, member);
  assert.notEqual(second.session, first.session);

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.deepEqual(
    listed.map((record) => [record.session, record.state]).sort(),
    [
      [first.session, "Closed"],
      [second.session, "Open"],
    ].sort(),
  );

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: second.session,
      turn: asSessionTurnId(threadRigTurnId("reopened")),
      input: "into the one that is open",
    }),
    { enqueued: "Enqueued", session: second.session, ordinal: 1 },
    "a member with an open thread and a closed one is heard by the open one",
  );
});

/**
 * Why 062 does NOT replace the prompt check 061 generated. A thread's widest
 * objectives are shorter than a lead's, so the column already holds them; the
 * dominance is asserted here rather than assumed, because a thread prompt that
 * outgrew the column would refuse every open on the project that caused it.
 */
/**
 * The exception arm of `open_member_thread`. The pre-check is the fast path and
 * the partial unique index 058 declared is what actually decides which open
 * wins; this drives the case where the pre-check finds nothing and the index
 * refuses anyway, which is the only path that reaches the arm and the only one
 * where the API would otherwise be handed an error to interpret.
 */
test("an open that loses the race to the index answers the session that won it", async () => {
  const partition = await project("race");
  const member = await threadRigMember(rig, partition, "race");
  const winner = `thread-race-winner-${partition.project}`;
  const loser = `thread-race-loser-${partition.project}`;
  const values = (session: string) => [
    partition.tenant,
    partition.project,
    member.principal,
    session,
    threadRigSlot,
    threadRigPrompt,
  ];

  const held = await rig.sessions.harness.begin();
  try {
    await held.query(
      `SELECT opened,session FROM open_member_thread($1,$2,$3,$4,$5,$6)`,
      values(winner),
    );
    const racing = rig.apiPool.query<{ opened: string; session: string }>(
      `SELECT opened,session FROM open_member_thread($1,$2,$3,$4,$5,$6)`,
      values(loser),
    );
    await waitForABlockedStatement();
    await held.commit();
    const answered = await racing;
    assert.equal(answered.rows[0]?.opened, "AlreadyOpen");
    assert.equal(answered.rows[0]?.session, winner);
  } finally {
    await held.rollback().catch(() => undefined);
  }

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.deepEqual(
    listed.map((record) => record.session),
    [winner],
    "the loser wrote no second thread for the member",
  );
});

test("the widest objectives a thread composes are objectives the column takes", async () => {
  const partition = await project("prompt");
  const wide = await threadRigMember(rig, partition, "wide");
  const over = await threadRigMember(rig, partition, "over");

  assert.ok(threadSystemPromptCharsMax <= agentSessionPromptCharsMax);
  const opened = await rig.threads.open({
    partition,
    principal: wide.principal,
    session: rig.minting.session(),
    systemPrompt: "p".repeat(threadSystemPromptCharsMax),
    credentialSlot: threadRigSlot,
  });
  assert.equal(opened.opened, "Opened");

  await assert.rejects(
    () =>
      rig.threads.open({
        partition,
        principal: over.principal,
        session: rig.minting.session(),
        systemPrompt: "p".repeat(agentSessionPromptCharsMax + 1),
        credentialSlot: threadRigSlot,
      }),
    /agent_session_prompt_is_bounded/u,
  );
});

test("a principal with no thread of its own is told there is none", async () => {
  const partition = await project("nothread");
  const member = await threadRigMember(rig, partition, "nothread");

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: rig.minting.session(),
      turn: asSessionTurnId(threadRigTurnId("nothread")),
      input: "anyone there",
    }),
    { enqueued: "NoThread" },
  );
});

test("the same turn twice is the same ordinal, and one past the backlog is refused", async () => {
  const partition = await project("backlog");
  const member = await threadRigMember(rig, partition, "backlog");
  const thread = await threadRigThread(rig, partition, member);

  const message = (turn: string, input: string) =>
    rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(turn),
      input,
    });

  const repeated = threadRigTurnId("repeat");
  const first = await message(repeated, "the first thing");
  assert.deepEqual(first, {
    enqueued: "Enqueued",
    session: thread.session,
    ordinal: 1,
  });
  assert.deepEqual(await message(repeated, "the first thing"), {
    enqueued: "AlreadyEnqueued",
    session: thread.session,
    ordinal: 1,
  });

  for (let queued = 2; queued <= threadBacklogMax; queued += 1) {
    const enqueued = await message(
      threadRigTurnId(`fill-${String(queued)}`),
      `thing ${String(queued)}`,
    );
    assert.equal(enqueued.enqueued, "Enqueued");
  }
  assert.deepEqual(await message(threadRigTurnId("over"), "one too many"), {
    enqueued: "Backlogged",
  });

  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(standing?.turns.length, threadBacklogMax);
  assert.equal(standing?.thread.turns, threadBacklogMax);
});

/**
 * The durable half of "a thread is its owner's alone to write": the door
 * resolves the mailbox from the principal and refuses the session the caller
 * named where the two differ, so the route's comparison is the second check and
 * not the only one.
 *
 * THE STALE-LISTING CASE IS THE SAME REFUSAL: a member who read a listing
 * before their thread was closed and reopened names a session that is no longer
 * theirs, and gets `NotYourThread` rather than a first turn with no seeding.
 */
test("a message naming a session the caller does not own is refused by the door", async () => {
  const partition = await project("named");
  const mine = await threadRigMember(rig, partition, "named-mine");
  const other = await threadRigMember(rig, partition, "named-other");
  const ours = await threadRigThread(rig, partition, mine);
  const theirs = await threadRigThread(rig, partition, other);

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: mine.principal,
      session: theirs.session,
      turn: asSessionTurnId(threadRigTurnId("named-other")),
      input: "into someone else's",
    }),
    { enqueued: "NotYourThread" },
  );

  await rig.sessions.sessions.close(partition, ours.session);
  const reopened = await threadRigThread(rig, partition, mine);
  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: mine.principal,
      session: ours.session,
      turn: asSessionTurnId(threadRigTurnId("named-stale")),
      input: "into the one I read about",
    }),
    { enqueued: "NotYourThread" },
    "a stale listing must not enqueue a first turn into a thread that was reopened",
  );

  const standing = await rig.threads.standing({
    partition,
    session: reopened.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(standing?.turns, []);
});

/**
 * A retried turn answers the ordinal it already has and leaves the row alone. A
 * door that refreshed the input would edit a turn a pod may already have
 * claimed, and then the transcript and the mailbox would disagree about what
 * was asked.
 */
test("a retried turn keeps the input it was enqueued with", async () => {
  const partition = await project("retried");
  const member = await threadRigMember(rig, partition, "retried");
  const thread = await threadRigThread(rig, partition, member);
  const turn = asSessionTurnId(threadRigTurnId("retried"));
  const message = (input: string) =>
    rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn,
      input,
    });

  assert.equal((await message("what I asked")).enqueued, "Enqueued");
  assert.equal((await message("what I meant")).enqueued, "AlreadyEnqueued");
  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(
    standing?.turns.map((each) => each.input),
    ["what I asked"],
  );
});

/**
 * The twin of "a closed thread is closed before it is orphaned": a member who
 * resends is asking after the turn they already sent, so the standing-turn
 * lookup sits ahead of the backlog count. With the two the other way round a
 * retry into a full mailbox answers `Backlogged` for a turn already queued, and
 * a client that read the retry-after would wait for a turn that had never
 * needed one.
 */
test("a retried turn is already enqueued before it is backlogged", async () => {
  const partition = await project("retryfull");
  const member = await threadRigMember(rig, partition, "retryfull");
  const thread = await threadRigThread(rig, partition, member);
  const message = (turn: string) =>
    rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(turn),
      input: "the first thing",
    });

  const repeated = threadRigTurnId("retryfull-first");
  assert.equal((await message(repeated)).enqueued, "Enqueued");
  for (let queued = 2; queued <= threadBacklogMax; queued += 1)
    assert.equal(
      (await message(threadRigTurnId(`retryfull-${String(queued)}`))).enqueued,
      "Enqueued",
    );
  assert.equal(
    (await message(threadRigTurnId("retryfull-over"))).enqueued,
    "Backlogged",
  );

  assert.deepEqual(await message(repeated), {
    enqueued: "AlreadyEnqueued",
    session: thread.session,
    ordinal: 1,
  });
});

/**
 * The partition predicate in the standing read's membership join. Every other
 * project here sits in a tenant of its own, so this is the one fixture where
 * `m.project=s.project` decides anything: without it the join matches both
 * memberships, the page answers each turn once per project, and a member whose
 * access to THIS project was withdrawn still reads as an owner.
 */
test("one member of two projects in one tenant is one owner and one page", async () => {
  const partition = await project("sibling");
  const sibling = await threadRigSiblingProject(rig, partition, "sibling");
  const member = await threadRigMember(rig, partition, "sibling");
  await threadRigMemberAlso(rig, sibling, member);
  const thread = await threadRigThread(rig, partition, member);
  await rig.threads.enqueueMessage({
    partition,
    principal: member.principal,
    session: thread.session,
    turn: asSessionTurnId(threadRigTurnId("sibling")),
    input: "one turn, once",
  });

  const held = () =>
    rig.threads.standing({
      partition,
      session: thread.session,
      query: { limit: threadTurnsAnsweredMax },
    });
  const standing = await held();
  assert.equal(standing?.turns.length, 1, "the page answers the turn once");
  assert.equal(standing?.thread.turns, 1);
  assert.equal(standing?.thread.owner, member.authority.subject);
  assert.equal(threadStanding(standing?.thread ?? { state: "Closed" }), "Open");

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.deepEqual(
    listed.map((record) => [record.session, record.owner]),
    [[thread.session, member.authority.subject]],
    "and the listing names the same owner once",
  );

  await threadRigRevoke(rig, partition, member);
  const orphaned = await held();
  assert.equal(
    orphaned?.thread.owner,
    undefined,
    "the membership in the sibling project is not this project's owner",
  );
  assert.equal(
    threadStanding(orphaned?.thread ?? { state: "Closed" }),
    "Orphaned",
  );
  assert.equal(orphaned?.turns.length, 1);
});

test("a closed thread takes no message", async () => {
  const partition = await project("closed");
  const member = await threadRigMember(rig, partition, "closed");
  const thread = await threadRigThread(rig, partition, member);
  await rig.sessions.sessions.close(partition, thread.session);

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(threadRigTurnId("closed")),
      input: "still there",
    }),
    { enqueued: "Closed" },
  );
});

/**
 * The order of the two arms, which is the only thing that tells them apart: a
 * closed thread whose owner's membership is ALSO gone answers `Closed`, because
 * a closed session is the fact its owner can act on and `enqueue_session_turn`
 * behind the door would answer the same thing about a different question.
 */
test("a closed thread is closed before it is orphaned", async () => {
  const partition = await project("closedorphan");
  const member = await threadRigMember(rig, partition, "closedorphan");
  const thread = await threadRigThread(rig, partition, member);
  await rig.sessions.sessions.close(partition, thread.session);
  await threadRigRevoke(rig, partition, member);

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(threadRigTurnId("closedorphan")),
      input: "which is it",
    }),
    { enqueued: "Closed" },
  );
});

test("a thread whose owner's membership is gone is orphaned, listed and mute", async () => {
  const partition = await project("orphan");
  const member = await threadRigMember(rig, partition, "orphan");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigRevoke(rig, partition, member);

  assert.deepEqual(
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(threadRigTurnId("orphan")),
      input: "am I still here",
    }),
    { enqueued: "Orphaned" },
  );

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.equal(listed.length, 1);
  const only = listed[0];
  assert.ok(only !== undefined);
  assert.equal(only.owner, undefined);
  assert.equal(threadStanding(only), "Orphaned");
});

test("the three standings a listing can name are the roster's own", async () => {
  const partition = await project("standings");
  const open = await threadRigMember(rig, partition, "standing-open");
  const closed = await threadRigMember(rig, partition, "standing-closed");
  const orphan = await threadRigMember(rig, partition, "standing-orphan");

  await threadRigThread(rig, partition, open);
  const ended = await threadRigThread(rig, partition, closed);
  await rig.sessions.sessions.close(partition, ended.session);
  await threadRigThread(rig, partition, orphan);
  await threadRigRevoke(rig, partition, orphan);

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.deepEqual(
    [
      ...new Set(
        listed.map(
          (record) => threadEntry(record, asPrincipal("nobody")).state,
        ),
      ),
    ].sort(),
    [...allThreadStandings].sort(),
  );
});

test("the two mailbox doors write the two input kinds and no other", async () => {
  const partition = await project("kinds");
  const member = await threadRigMember(rig, partition, "kinds");
  const thread = await threadRigThread(rig, partition, member);

  await rig.threads.enqueueMessage({
    partition,
    principal: member.principal,
    session: thread.session,
    turn: asSessionTurnId(threadRigTurnId("typed")),
    input: "typed by a member",
  });
  const woken = await rig.wakes.wake({
    partition,
    principal: member.principal,
    turn: asSessionTurnId(threadRigTurnId("woken")),
    input: threadWakeText(
      threadWakeDocument({
        wake: "TicketRefused",
        resource: "1",
        at: "2026-09-02T12:00:00.000Z",
      }),
    ),
  });
  assert.deepEqual(woken, { woken: "Woken", ordinal: 2 });

  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(
    standing?.turns.map((turn) => turn.inputKind),
    ["UserMessage", "Wake"],
  );
});

test("a wake offered twice is the same ordinal and no second turn", async () => {
  const partition = await project("rewake");
  const member = await threadRigMember(rig, partition, "rewake");
  const thread = await threadRigThread(rig, partition, member);
  const turn = asSessionTurnId(threadRigTurnId("rewake"));
  const document = threadWakeText(
    threadWakeDocument({
      wake: "TicketCompleted",
      resource: "7",
      at: "2026-09-02T12:00:00.000Z",
    }),
  );

  const offering = () =>
    rig.wakes.wake({
      partition,
      principal: member.principal,
      turn,
      input: document,
    });
  assert.deepEqual(await offering(), { woken: "Woken", ordinal: 1 });
  assert.deepEqual(await offering(), { woken: "AlreadyWoken", ordinal: 1 });

  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(standing?.turns.length, 1);
});

test("a thread turn's change frame names the session the console must re-read", async () => {
  const partition = await project("frame");
  const member = await threadRigMember(rig, partition, "frame");
  const thread = await threadRigThread(rig, partition, member);
  const turn = threadRigTurnId("frame");
  await rig.threads.enqueueMessage({
    partition,
    principal: member.principal,
    session: thread.session,
    turn: asSessionTurnId(turn),
    input: "watch this land",
  });

  const rows = await rig.sessions.harness.query(
    `SELECT resource FROM project_change
      WHERE tenant=$1 AND project=$2 AND kind='Session' ORDER BY sequence`,
    [partition.tenant, partition.project],
  );
  const parsed = rows.map((row) =>
    sessionChangeResourceSchema.parse(JSON.parse(String(row["resource"]))),
  );
  assert.deepEqual(parsed, [{ session: thread.session, kind: "Thread", turn }]);
});

test("the mailbox is paged backwards and answers the cursor of the older page", async () => {
  const partition = await project("page");
  const member = await threadRigMember(rig, partition, "page");
  const thread = await threadRigThread(rig, partition, member);
  for (const each of ["one", "two", "three"])
    await rig.threads.enqueueMessage({
      partition,
      principal: member.principal,
      session: thread.session,
      turn: asSessionTurnId(threadRigTurnId(each)),
      input: each,
    });

  const newest = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: 2 },
  });
  assert.deepEqual(
    newest?.turns.map((turn) => turn.ordinal),
    [2, 3],
  );
  assert.equal(newest?.nextBefore, 2);
  assert.equal(newest?.thread.turns, 3);

  const older = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { before: 2, limit: 2 },
  });
  assert.deepEqual(
    older?.turns.map((turn) => turn.ordinal),
    [1],
  );
  assert.equal(older?.nextBefore, undefined);
});

test("a thread that has taken no turn still reads, and a turn carries what was said", async () => {
  const partition = await project("empty");
  const member = await threadRigMember(rig, partition, "empty");
  const thread = await threadRigThread(rig, partition, member);

  const empty = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(empty?.turns, []);
  assert.deepEqual(empty?.streams, []);
  assert.equal(empty?.nextBefore, undefined);
  assert.equal(empty?.thread.session, thread.session);

  await rig.threads.enqueueMessage({
    partition,
    principal: member.principal,
    session: thread.session,
    turn: asSessionTurnId(threadRigTurnId("said")),
    input: "what a member typed",
  });
  const said = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.equal(said?.turns[0]?.input, "what a member typed");
  assert.equal(said?.turns[0]?.state, "Queued");
  assert.equal(said?.turns[0]?.result, undefined);
});

test("the standing read admits a thread and refuses every other session", async () => {
  const partition = await project("kindfilter");
  const member = await threadRigMember(rig, partition, "kindfilter");
  const thread = await threadRigThread(rig, partition, member);
  const lead = await sessionRigSession(rig.sessions, partition, "kindfilter", {
    kind: "Lead",
  });
  const elsewhere = await project("kindfilter-other");

  assert.equal(
    await rig.threads.standing({
      partition,
      session: lead,
      query: { limit: threadTurnsAnsweredMax },
    }),
    undefined,
    "a lead's mailbox is not readable through a thread route",
  );
  assert.equal(
    await rig.threads.standing({
      partition: elsewhere,
      session: thread.session,
      query: { limit: threadTurnsAnsweredMax },
    }),
    undefined,
    "another project's thread is not this project's to read",
  );
  assert.notEqual(
    await rig.threads.standing({
      partition,
      session: thread.session,
      query: { limit: threadTurnsAnsweredMax },
    }),
    undefined,
  );
});

test("the store reads answer the session they were asked about and no sibling", async () => {
  const partition = await project("store");
  const member = await threadRigMember(rig, partition, "store");
  const thread = await threadRigThread(rig, partition, member);
  const lead = await sessionRigSession(rig.sessions, partition, "store", {
    kind: "Lead",
  });
  for (const [session, stream] of [
    [thread.session, "thread-stream"],
    [lead, "lead-stream"],
  ] as const)
    await rig.sessions.harness.query(
      `INSERT INTO session_store_batch
         (tenant,project,session,stream,batch,digest,bytes,events)
       VALUES ($1,$2,$3,$4,1,$5,12,3)`,
      [partition.tenant, partition.project, session, stream, "c".repeat(64)],
    );

  assert.deepEqual(
    await rig.apiLead.streams(
      partition,
      thread.session,
      sessionStoreStreamsAnswered,
    ),
    [{ stream: "thread-stream", batches: 1 }],
  );
  assert.deepEqual(
    await rig.apiLead.batches({
      partition,
      session: thread.session,
      stream: asSessionStoreStream("thread-stream"),
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [{ batch: 1, digest: "c".repeat(64), bytes: 12 }],
  );
  assert.deepEqual(
    await rig.apiLead.batches({
      partition,
      session: thread.session,
      stream: asSessionStoreStream("lead-stream"),
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [],
  );

  const retired = await rig.sessions.harness.query(
    `SELECT to_regprocedure('read_lead_store(text,text,text,bigint,bigint)') IS NULL AS batches_gone,
            to_regprocedure('list_lead_store_streams(text,text,bigint)') IS NULL AS streams_gone`,
  );
  assert.equal(retired[0]?.["batches_gone"], true);
  assert.equal(retired[0]?.["streams_gone"], true);
});

/**
 * Where the change log stands now. Every suite of one worker shares a database,
 * so a wake case that read from zero would be reading whatever an earlier case
 * left behind and would pass or fail on that.
 */
async function changeLogHead(): Promise<number> {
  const rows = await rig.sessions.harness.query(
    "SELECT coalesce(max(sequence),0)::text AS head FROM project_change",
  );
  return Number(rows[0]?.["head"]);
}

/** One refusal against two tickets, then a lift of one, which is two of the reasons. */
async function wakeRefusals(
  partition: Partition,
  label: string,
  refused: TicketId,
  lifted: TicketId,
): Promise<void> {
  const decision = await leadRigDecision(rig, partition, `${label}-refused`);
  await rig.writes.record({
    partition,
    decision,
    refusals: [
      { ticket: refused, ticketVersion: 1, reason: "not yet" },
      { ticket: lifted, ticketVersion: 1, reason: "not yet either" },
    ],
    lifts: [],
  });
  const lifting = await leadRigDecision(rig, partition, `${label}-lifted`);
  await rig.writes.record({
    partition,
    decision: lifting,
    refusals: [],
    lifts: [{ ticket: lifted }],
  });
}

/** One ticket standing in one phase, with the change that says so. */
function wakeTicketPhase(
  partition: Partition,
  ticket: TicketId,
  phase: string,
): Promise<void> {
  return threadRigTicketPhase(rig, partition, ticket, phase);
}

/**
 * One project, one member and a change for every reason the roster names. Two
 * ticket phases map to `TicketAbandoned` and both are here: a fixture holding
 * one of them agrees with a join deriving that reason from the other alone.
 */
async function wakeFixture(label: string): Promise<{
  readonly partition: Partition;
  readonly member: ThreadRigMember;
  readonly thread: string;
  readonly reasons: readonly (readonly [ThreadWakeReason, TicketId])[];
  /** The change-log high-water before the fixture, so a case reads its own rows alone. */
  readonly after: number;
}> {
  const partition = await project(label);
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, label);
  const thread = await threadRigThread(rig, partition, member);
  await sessionRigSession(rig.sessions, partition, `wake-${label}`, {
    kind: "Lead",
    principal: member.principal,
  });
  const revision = await threadConfiguration(partition);

  const refused = await threadDraft(partition, revision, member);
  const lifted = await threadDraft(partition, revision, member);
  const deleted = await threadDraft(partition, revision, member);
  const escalated = await threadDraft(partition, revision, member);
  const done = await threadDraft(partition, revision, member);
  const abandoned = await threadDraft(partition, revision, member);
  const revoked = await threadDraft(partition, revision, member);

  await wakeRefusals(partition, label, refused, lifted);
  const gone = await rig.sessions.harness.authoring.deleteDraft({
    partition,
    authority: member.authority,
    ticket: deleted,
    expectedVersion: 1,
  });
  if (gone.deleted !== "Deleted")
    throw new Error(`thread durable: the draft answered ${gone.deleted}`);
  for (const [ticket, phase] of [
    [escalated, "Escalated"],
    [done, "Done"],
    [abandoned, "Abandoned"],
    [revoked, "Revoked"],
  ] as const)
    await wakeTicketPhase(partition, ticket, phase);

  return {
    partition,
    member,
    thread: thread.session,
    after,
    reasons: [
      ["TicketRefused", refused],
      ["RefusalLifted", lifted],
      ["DraftDeleted", deleted],
      ["TicketEscalated", escalated],
      ["TicketCompleted", done],
      ["TicketAbandoned", abandoned],
      ["TicketAbandoned", revoked],
    ],
  };
}

test("every reason the roster names is a reason the join derives", async () => {
  const fixture = await wakeFixture("reasons");
  const candidates = await rig.wakes.candidates(
    fixture.after,
    threadWakesPerPassMax,
  );
  const mine = candidates.filter(
    (candidate) => candidate.partition.project === fixture.partition.project,
  );

  assert.deepEqual(
    [...new Set(mine.map((candidate) => candidate.reason))].sort(),
    [...allThreadWakeReasons].sort(),
  );
  assert.deepEqual(
    [...new Set(mine.map((candidate) => candidate.session))],
    [fixture.thread],
    "a lead in the same project under the same principal is not a thread to wake",
  );
  for (const [reason, ticket] of fixture.reasons)
    assert.ok(
      mine.some(
        (candidate) =>
          candidate.reason === reason && candidate.resource === String(ticket),
      ),
      `${reason} names ticket ${String(ticket)}, which is a ticket it is about`,
    );
});

/**
 * A ticket's changes are events, and a later one may not rewrite what an
 * earlier one meant. Every arm of the derivation had that defect, so each has a
 * case (kasofsk/chuggy#542).
 */
test("a ticket's earlier moves keep their own reasons after it is revoked", async () => {
  const partition = await project("ticketreasons");
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, "ticketreasons");
  await threadRigThread(rig, partition, member);
  const revision = await threadConfiguration(partition);
  const ticket = await threadDraft(partition, revision, member);

  for (const phase of ["Escalated", "Done", "Revoked"])
    await wakeTicketPhase(partition, ticket, phase);

  const mine = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(
    mine.map((candidate) => candidate.reason),
    ["TicketEscalated", "TicketCompleted", "TicketAbandoned"],
    "a revoked ticket's whole history reads as the revoke, so the reason is still the projection's",
  );
});

test("a deleted draft's earlier changes are not deletions", async () => {
  const partition = await project("draftreasons");
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, "draftreasons");
  await threadRigThread(rig, partition, member);
  const revision = await threadConfiguration(partition);
  const ticket = await threadDraft(partition, revision, member);

  const revised = await rig.sessions.harness.authoring.reviseDraft({
    partition,
    authority: member.authority,
    ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (revised.revised !== "Revised")
    throw new Error(`thread durable: revising answered ${revised.revised}`);
  const gone = await rig.sessions.harness.authoring.deleteDraft({
    partition,
    authority: member.authority,
    ticket,
    expectedVersion: 2,
  });
  if (gone.deleted !== "Deleted")
    throw new Error(`thread durable: the draft answered ${gone.deleted}`);

  const mine = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(
    mine.map((candidate) => candidate.reason),
    ["DraftDeleted"],
    "the changes that authored the draft read as its deletion",
  );
});

test("a lift does not turn the refusal before it into a second lift", async () => {
  const partition = await project("refusalreasons");
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, "refusalreasons");
  await threadRigThread(rig, partition, member);
  const revision = await threadConfiguration(partition);
  const ticket = await threadDraft(partition, revision, member);

  await rig.writes.record({
    partition,
    decision: await leadRigDecision(rig, partition, "refusalreasons-refused"),
    refusals: [{ ticket, ticketVersion: 1, reason: "not yet" }],
    lifts: [],
  });
  await rig.writes.record({
    partition,
    decision: await leadRigDecision(rig, partition, "refusalreasons-lifted"),
    refusals: [],
    lifts: [{ ticket }],
  });

  const mine = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(
    mine.map((candidate) => candidate.reason),
    ["TicketRefused", "RefusalLifted"],
    "the refusal reads as the lift that came after it",
  );
});

test("a wake follows whoever wrote the ticket, once, and nobody else", async () => {
  const partition = await project("authorship");
  const after = await changeLogHead();
  const author = await threadRigMember(rig, partition, "author");
  const bystander = await threadRigMember(rig, partition, "bystander");
  const authorThread = await threadRigThread(rig, partition, author);
  await threadRigThread(rig, partition, bystander);
  const revision = await threadConfiguration(partition);
  const ticket = await threadDraft(partition, revision, author);
  await threadDraft(partition, revision, bystander);

  const revised = await rig.sessions.harness.authoring.reviseDraft({
    partition,
    authority: author.authority,
    ticket,
    expectedVersion: 1,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (revised.revised !== "Revised")
    throw new Error(`thread durable: revising answered ${revised.revised}`);

  await wakeTicketPhase(partition, ticket, "Done");

  const mine = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(
    mine.map((candidate) => [candidate.session, candidate.reason]),
    [[authorThread.session, "TicketCompleted"]],
    "two revisions by one member wake that member once, and a member who authored some other ticket none",
  );
});

test("a closed thread is a thread nothing wakes", async () => {
  const partition = await project("closedwake");
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, "closedwake");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await threadConfiguration(partition);
  const ticket = await threadDraft(partition, revision, member);
  await wakeTicketPhase(partition, ticket, "Done");

  const before = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(
    before.map((candidate) => candidate.session),
    [thread.session],
  );

  await rig.sessions.sessions.close(partition, thread.session);
  const closed = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(closed, []);
});

test("a change whose resource is not a ticket number is no candidate and no error", async () => {
  const partition = await project("nonnumeric");
  const after = await changeLogHead();
  const member = await threadRigMember(rig, partition, "nonnumeric");
  await threadRigThread(rig, partition, member);
  const revision = await threadConfiguration(partition);
  await threadDraft(partition, revision, member);

  await rig.sessions.harness.query(
    `SELECT append_project_change($1,$2,'Draft','not-a-ticket')`,
    [partition.tenant, partition.project],
  );
  const mine = (
    await rig.wakes.candidates(after, threadWakesPerPassMax)
  ).filter((candidate) => candidate.partition.project === partition.project);
  assert.deepEqual(mine, []);
});

test("a candidate page is the page it was asked for, from the cursor it was given", async () => {
  const fixture = await wakeFixture("paged");
  const all = (
    await rig.wakes.candidates(fixture.after, threadWakesPerPassMax)
  ).filter(
    (candidate) => candidate.partition.project === fixture.partition.project,
  );
  assert.ok(all.length >= 2);

  const first = all[0];
  assert.ok(first !== undefined);
  const page = await rig.wakes.candidates(fixture.after, 1);
  assert.equal(page.length, 1);

  const past = await rig.wakes.candidates(
    first.sequence,
    threadWakesPerPassMax,
  );
  assert.ok(
    past.every((candidate) => candidate.sequence > first.sequence),
    "a cursor is exclusive, or a pass re-offers what it has already offered",
  );
});

test("the wake cursor moves forward and never backwards", async () => {
  const started = await rig.wakes.cursor();
  const ahead = started + 10;
  assert.equal(await rig.wakes.advance(ahead), ahead);
  assert.equal(await rig.wakes.advance(started), ahead);
  assert.equal(await rig.wakes.cursor(), ahead);
});

test("the wake cursor is one row and never a negative one", async () => {
  await assert.rejects(
    () =>
      rig.sessions.harness.query(
        "INSERT INTO thread_wake_cursor (singleton) VALUES (true)",
      ),
    /thread_wake_cursor_pkey/u,
  );
  await assert.rejects(
    () =>
      rig.sessions.harness.query(
        "INSERT INTO thread_wake_cursor (singleton) VALUES (false)",
      ),
    /thread_wake_cursor_is_one_row/u,
  );
  await assert.rejects(
    () =>
      rig.sessions.harness.query(
        "UPDATE thread_wake_cursor SET sequence=-1 WHERE singleton",
      ),
    /thread_wake_cursor_is_not_negative/u,
  );
});

test("a session's roster is reconfigured by the boundary's own identity alone", async () => {
  const partition = await project("reconfigure");
  const member = await threadRigMember(rig, partition, "reconfigure");
  const thread = await threadRigThread(rig, partition, member);
  const narrowed = ["ProjectRead"] as const;

  assert.equal(
    await rig.sessions.sessions.setCapabilities(
      partition,
      thread.session,
      narrowed,
    ),
    "Set",
  );
  assert.equal(
    await rig.sessions.sessions.setCapabilities(
      partition,
      thread.session,
      narrowed,
    ),
    "Unchanged",
  );
  const rows = await rig.sessions.harness.query(
    "SELECT capabilities FROM agent_session WHERE session=$1",
    [thread.session],
  );
  assert.deepEqual(rows[0]?.["capabilities"], [...narrowed]);

  assert.equal(
    await rig.sessions.sessions.setCapabilities(
      partition,
      asSessionId(`absent-${thread.session}`),
      narrowed,
    ),
    "NoSession",
  );
  await assert.rejects(
    () =>
      rig.sessions.sessions.setCapabilities(partition, thread.session, [
        "Nowhere" as never,
      ]),
    /agent_session_capabilities_are_known/u,
  );
});

test("what a session was opened as is still what it is", async () => {
  const partition = await project("frozen");
  const member = await threadRigMember(rig, partition, "frozen");
  const thread = await threadRigThread(rig, partition, member);

  for (const [column, value] of [
    ["principal", "someone-else"],
    ["kind", "Lead"],
    ["credential_slot", "another-slot"],
  ] as const)
    await assert.rejects(
      () =>
        rig.sessions.harness.query(
          `UPDATE agent_session SET ${column}=$2 WHERE session=$1`,
          [thread.session, value],
        ),
      /would change what it was opened as/u,
      `${column} is what the session IS`,
    );
});

test("each door 062 declares is the role's it was granted to and no other's", async () => {
  const partition = await project("grants");
  const member = await threadRigMember(rig, partition, "grants");
  await threadRigThread(rig, partition, member);
  const named = [partition.tenant, partition.project, member.principal]
    .map((value) => `'${value}'`)
    .join(",");

  await onlyTheseRolesMay(
    [apiRole],
    threadOpenFunction,
    `SELECT ${threadOpenFunction}(${named},'session-grants','slot','prompt')`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    threadMessageEnqueueFunction,
    `SELECT ${threadMessageEnqueueFunction}(${named},'session-grants','turn-grants','hello')`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    projectThreadsReadFunction,
    `SELECT ${projectThreadsReadFunction}('${partition.tenant}','${partition.project}',1)`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    threadStandingReadFunction,
    `SELECT ${threadStandingReadFunction}('${partition.tenant}','${partition.project}','session-grants',NULL,1)`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    sessionStoreBatchesReadFunction,
    `SELECT ${sessionStoreBatchesReadFunction}('${partition.tenant}','${partition.project}','session-grants','stream',0,1)`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    sessionStoreStreamListFunction,
    `SELECT ${sessionStoreStreamListFunction}('${partition.tenant}','${partition.project}','session-grants',1)`,
  );
  await onlyTheseRolesMay(
    [selectorServiceRole],
    threadWakeFunction,
    `SELECT ${threadWakeFunction}(${named},'turn-wake-grants','{}')`,
  );
  await onlyTheseRolesMay(
    [selectorServiceRole],
    threadWakeCandidatesFunction,
    `SELECT ${threadWakeCandidatesFunction}(0,1)`,
  );
  await onlyTheseRolesMay(
    [selectorServiceRole],
    threadWakeCursorAdvanceFunction,
    `SELECT ${threadWakeCursorAdvanceFunction}(0)`,
  );
  await onlyTheseRolesMay(
    [],
    "set_session_capabilities",
    `SELECT set_session_capabilities('${partition.tenant}','${partition.project}','session-grants',ARRAY['ProjectRead']::text[])`,
  );
  await onlyTheseRolesMay(
    [selectorServiceRole],
    "thread_wake_cursor",
    "SELECT sequence FROM thread_wake_cursor",
  );
  await onlyTheseRolesMay(
    [],
    "agent_session",
    "UPDATE agent_session SET capabilities=ARRAY['ProjectRead']::text[] WHERE false",
  );
});

test("a thread's roster is reconfigured by the provisioning command and no route", async () => {
  const partition = await project("provisioned");
  const member = await threadRigMember(rig, partition, "provisioned");
  const thread = await threadRigThread(rig, partition, member);

  const set = await sessionRigProvision({
    CHUG_PROVISION_SESSION_ACTION: "capabilities",
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: thread.session,
    CHUG_PROVISION_SESSION_CAPABILITIES: "ProjectRead,RepositoryRead",
  });
  assert.equal(set.code, 0, set.output);
  assert.match(set.output, /^Set: /u);
  assert.deepEqual(
    await rig.sessions.harness.query(
      "SELECT capabilities FROM agent_session WHERE session=$1",
      [thread.session],
    ),
    [{ capabilities: ["ProjectRead", "RepositoryRead"] }],
  );

  const again = await sessionRigProvision({
    CHUG_PROVISION_SESSION_ACTION: "capabilities",
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: thread.session,
    CHUG_PROVISION_SESSION_CAPABILITIES: "ProjectRead,RepositoryRead",
  });
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /^Unchanged: /u);

  const absent = await sessionRigProvision({
    CHUG_PROVISION_SESSION_ACTION: "capabilities",
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: `absent-${thread.session}`,
    CHUG_PROVISION_SESSION_CAPABILITIES: "ProjectRead",
  });
  assert.equal(absent.code, 1);
  assert.match(absent.output, /NoSession/u);
});
