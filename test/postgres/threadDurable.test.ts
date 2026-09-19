/**
 * What migrations 062 and 075 add, driven against a real PostgreSQL by the
 * role each door is granted to.
 *
 * EVERY CASE HERE IS ABOUT A CONTROL AND NOT ABOUT A SHAPE. A grant, a revoke,
 * a check, a trigger and a filter are each a claim about what the server
 * refuses, and the only way to hold one is to attempt the thing it refuses as
 * the identity that would attempt it. So the six thread doors are driven
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
  sessionCloseFunction,
  sessionStoreBatchesReadFunction,
  sessionStoreStreamListFunction,
  ticketServiceRole,
  threadCloseFunction,
  threadHideFunction,
  threadRenameFunction,
  threadMessageEnqueueFunction,
  threadOpenFunction,
  threadStandingReadFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { sessionChangeResourceSchema } from "../../src/contract/sessionEvents.ts";
import {
  agentSessionPromptCharsMax,
  threadTitleCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../../src/contract/http.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthorities } from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  allThreadStandings,
  threadCapabilitiesDefault,
  threadSystemPromptCharsMax,
} from "../../src/interpreter/thread.ts";
import { threadEntry } from "../../src/interpreter/threadRead.ts";
import { postgresHarnessDenial } from "./harness.ts";
import { sessionRigProvision, sessionRigSession } from "./sessionHarness.ts";
import {
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigPrompt,
  threadRigRevoke,
  threadRigSlot,
  threadRigThread,
  type ThreadRig,
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

/** One open draft authored by the member named, which is what the wake join follows. */

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
  const one = threadRigMember(rig, partition, "one");
  const two = threadRigMember(rig, partition, "two");

  const first = await threadRigThread(rig, partition, one);
  const again = await threadRigThread(rig, partition, one, "AlreadyOpen");
  assert.equal(again.session, first.session);
  assert.equal(first.principal, one.principal);
  assert.equal(first.state, "Open");
  assert.equal(first.turns, 0);

  const other = await threadRigThread(rig, partition, two);
  assert.notEqual(other.session, first.session);
});

test("the roster a thread is opened with is the installation's own and no argument's", async () => {
  const partition = await project("roster");
  const member = threadRigMember(rig, partition, "roster");
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
  const member = threadRigMember(rig, partition, "oneopen");
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

/**
 * The close door is the API's, and it is a control in three ways at once: it
 * ends the turns the thread still held, it leaves the thread readable as what
 * it was, and it is terminal — pressing it again is answered as already done,
 * and the member's next thread is a new session rather than this one reopened.
 */

/**
 * The door admits `kind='Thread'` alone, and that is what keeps the API's grant
 * on it from being a grant on `close_agent_session`: a lead named through it is
 * no thread, and so is a session nobody opened.
 */
test("the close door closes a thread and nothing else the project holds", async () => {
  const partition = await project("close-kind");
  const lead = await sessionRigSession(rig.sessions, partition, "close-kind", {
    kind: "Lead",
  });

  assert.deepEqual(await rig.threads.close({ partition, session: lead }), {
    closed: "NoThread",
  });
  assert.deepEqual(
    await rig.threads.close({
      partition,
      session: asSessionId("session-nobody-opened"),
    }),
    { closed: "NoThread" },
  );
  const held = await rig.sessions.harness.query(
    `SELECT state FROM agent_session WHERE tenant=$1 AND project=$2 AND session=$3`,
    [partition.tenant, partition.project, lead],
  );
  assert.equal(
    held[0]?.["state"],
    "Open",
    "the lead was closed through a thread door",
  );
});

/**
 * The door decides the row is a thread in the predicate its lock is taken
 * under, so a close aimed at the lead's session contends with nothing the
 * scheduler or the worker plane holds on the lead's row. The lead's row is held
 * locked by another transaction for the whole of the call, and the door must
 * answer inside a lock timeout rather than wait on it.
 */
test("the close door waits on no row that is not a thread's", async () => {
  const partition = await project("close-lock");
  const lead = await sessionRigSession(rig.sessions, partition, "close-lock", {
    kind: "Lead",
  });
  const held = await rig.sessions.harness.begin();
  const api = await rig.apiPool.connect();
  try {
    await held.query(
      `SELECT 1 FROM agent_session WHERE tenant=$1 AND project=$2 AND session=$3
         FOR UPDATE`,
      [partition.tenant, partition.project, lead],
    );
    await api.query("BEGIN");
    await api.query("SET LOCAL lock_timeout='500ms'");
    const answered = await api.query<{ closed: string }>(
      `SELECT close_member_thread($1,$2,$3)::text AS closed`,
      [partition.tenant, partition.project, lead],
    );
    assert.equal(answered.rows[0]?.closed, "NoThread");
  } finally {
    await api.query("ROLLBACK").catch(() => undefined);
    api.release();
    await held.rollback().catch(() => undefined);
  }
});

/**
 * The listing is one bounded page and a close is terminal, so a listing that
 * answered the oldest threads first would fill with closed ones and drop the
 * live ones off its end. Open threads come first and the rest newest first,
 * which the smallest page shows: it holds the live thread and no closed one.
 */
test("a closed thread displaces no live one from the listing", async () => {
  const partition = await project("listing-order");
  const first = threadRigMember(rig, partition, "listing-first");
  const second = threadRigMember(rig, partition, "listing-second");
  const ended = await threadRigThread(rig, partition, first);
  await rig.threads.close({ partition, session: ended.session });
  const live = await threadRigThread(rig, partition, first);
  const later = await threadRigThread(rig, partition, second);
  await rig.threads.close({ partition, session: later.session });

  const smallest = await rig.threads.threads(partition, 1);
  assert.deepEqual(
    smallest.map((record) => record.session),
    [live.session],
    "the page of one holds a closed thread over the live one",
  );
  const whole = await rig.threads.threads(partition, threadsAnsweredMax);
  assert.deepEqual(
    whole.map((record) => record.session),
    [live.session, later.session, ended.session],
  );
});

/**
 * A close with no turn waiting moves no turn and stores no batch, so without a
 * frame of its own the pages watching the thread would go on drawing it open.
 * The frame is the third shape the wire's schema admits, and it is asserted
 * through that schema so a console reads what the trigger wrote.
 */
test("a close is a Session frame naming the state, even with nothing waiting", async () => {
  const partition = await project("close-frame");
  const member = threadRigMember(rig, partition, "close-frame");
  const thread = await threadRigThread(rig, partition, member);

  await rig.threads.close({ partition, session: thread.session });

  const rows = await rig.sessions.harness.query(
    `SELECT resource FROM project_change
      WHERE tenant=$1 AND project=$2 AND kind='Session' ORDER BY sequence`,
    [partition.tenant, partition.project],
  );
  const parsed = rows.map((row) =>
    sessionChangeResourceSchema.parse(JSON.parse(String(row["resource"]))),
  );
  assert.deepEqual(parsed, [
    { session: thread.session, kind: "Thread", state: "Closed" },
  ]);
});

/**
 * A member's own name for a thread overrides the title derived from its first
 * message, and clearing it gives that derivation back. It is asserted through
 * `threadEntry` rather than off the column, because what is claimed is what a
 * rail is answered.
 */

/**
 * A title of nothing but whitespace trims to nothing, so it clears the
 * override exactly as an empty string does rather than storing a label a rail
 * would draw blank.
 */

/**
 * The column is bounded by the same ceiling the wire is, so a title past it is
 * refused by the server rather than by the schema alone — which is the half a
 * caller reaching the door directly would otherwise get past.
 */
test("a member title past its bound is refused by the column that holds it", async () => {
  const partition = await project("rename-bound");
  const member = threadRigMember(rig, partition, "rename-bound");
  const thread = await threadRigThread(rig, partition, member);

  await assert.rejects(
    rig.threads.rename({
      partition,
      session: thread.session,
      title: "a".repeat(threadTitleCharsMax + 1),
    }),
    /agent_session_member_title_is_bounded/u,
  );
  assert.equal(
    (
      await rig.threads.rename({
        partition,
        session: thread.session,
        title: "a".repeat(threadTitleCharsMax),
      })
    ).renamed,
    "Renamed",
  );
});

/**
 * Hiding says which side of the rail the thread is on, and a second press says
 * the same and writes nothing: the instant it went off the rail is the instant
 * it first did, so a repeated press is not a thread that just moved.
 */
test("hiding a thread toggles and is idempotent on the side it is asked for", async () => {
  const partition = await project("hide");
  const member = threadRigMember(rig, partition, "hide");
  const thread = await threadRigThread(rig, partition, member);
  const hiddenAt = async () =>
    (
      await rig.sessions.harness.query(
        `SELECT hidden_at::text AS at FROM agent_session
          WHERE tenant=$1 AND project=$2 AND session=$3`,
        [partition.tenant, partition.project, thread.session],
      )
    )[0]?.["at"];

  const hid = await rig.threads.hide({
    partition,
    session: thread.session,
    hidden: true,
  });
  assert.equal(hid.hidden, "Hidden");
  assert.equal(hid.hidden === "Hidden" ? hid.thread.hidden : false, true);
  const first = await hiddenAt();
  assert.equal(
    (
      await rig.threads.hide({
        partition,
        session: thread.session,
        hidden: true,
      })
    ).hidden,
    "Hidden",
  );
  assert.equal(await hiddenAt(), first, "a second press moved the instant");

  const shown = await rig.threads.hide({
    partition,
    session: thread.session,
    hidden: false,
  });
  assert.equal(shown.hidden, "Shown");
  assert.equal(shown.hidden === "Shown" ? shown.thread.hidden : true, false);
});

/** Neither door reaches a lead, and neither reaches a session nobody opened. */
test("neither view door admits a session that is not this project's thread", async () => {
  const partition = await project("view-no-thread");
  const lead = await sessionRigSession(rig.sessions, partition, "view", {
    kind: "Lead",
  });

  assert.deepEqual(
    await rig.threads.rename({ partition, session: lead, title: "x" }),
    { renamed: "NoThread" },
  );
  assert.deepEqual(
    await rig.threads.hide({ partition, session: lead, hidden: true }),
    { hidden: "NoThread" },
  );
  assert.deepEqual(
    await rig.threads.hide({
      partition,
      session: asSessionId("session-nobody-opened"),
      hidden: true,
    }),
    { hidden: "NoThread" },
  );
});

/**
 * A rail re-reads its listing on a `Session` frame, and neither door moves the
 * state 075's trigger watches — so without a frame of their own a rename and a
 * hide would be invisible until something else moved.
 */
test("naming and hiding each raise the Session frame a listing re-reads on", async () => {
  const partition = await project("view-frame");
  const member = threadRigMember(rig, partition, "view-frame");
  const thread = await threadRigThread(rig, partition, member);

  await rig.threads.rename({
    partition,
    session: thread.session,
    title: "the footer",
  });
  await rig.threads.hide({
    partition,
    session: thread.session,
    hidden: true,
  });
  await rig.threads.rename({
    partition,
    session: thread.session,
    title: "the footer",
  });

  const rows = await rig.sessions.harness.query(
    `SELECT resource FROM project_change
      WHERE tenant=$1 AND project=$2 AND kind='Session' ORDER BY sequence`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    rows.map((row) =>
      sessionChangeResourceSchema.parse(JSON.parse(String(row["resource"]))),
    ),
    [
      { session: thread.session, kind: "Thread", state: "Open" },
      { session: thread.session, kind: "Thread", state: "Open" },
    ],
    "a write that changed nothing raised a frame, or a write that changed something did not",
  );
});

/**
 * The listing is grouped by activity in the console, so the order it answers is
 * the order a rail draws: a thread somebody spoke in comes before one opened
 * later and left alone, which an order on `opened_at` cannot give.
 */

/** When this project's one thread last moved, as the listing answers it. */
async function threadListedActivity(partition: Partition): Promise<number> {
  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  return Date.parse(String(listed[0]?.lastActivityAt));
}

/** When the row says the thread closed, which the listing's activity must agree with. */
async function threadRowClosedAt(
  partition: Partition,
  session: string,
): Promise<number> {
  const rows = await rig.sessions.harness.query(
    `SELECT closed_at::text AS at FROM agent_session
      WHERE tenant=$1 AND project=$2 AND session=$3`,
    [partition.tenant, partition.project, session],
  );
  return Date.parse(String(rows[0]?.["at"]));
}

/**
 * A closed thread last moved when it closed, and a rail groups it by that. The
 * case reads the two instants off the listing rather than off the row, because
 * what is claimed is what the definer derives.
 */

/**
 * A thread closed with nothing in its mailbox last moved when it closed, which
 * is the arm a thread that also holds an abandoned turn cannot settle: the
 * abandon and the close are one transaction and share an instant.
 */
test("a thread with no turns still last moved when it closed", async () => {
  const partition = await project("view-closed-empty");
  const member = threadRigMember(rig, partition, "closed-empty");
  const thread = await threadRigThread(rig, partition, member);
  const opened = await threadListedActivity(partition);

  await rig.threads.close({ partition, session: thread.session });

  const closed = await threadListedActivity(partition);
  assert.equal(closed, await threadRowClosedAt(partition, thread.session));
  assert.ok(
    closed > opened,
    "a closed thread still says it last moved when it opened",
  );
});

/** Both view doors are the API's, as the close door is, and no other role's. */
test("the two view doors are the API's alone", async () => {
  const partition = await project("view-grants");

  await onlyTheseRolesMay(
    [apiRole],
    threadRenameFunction,
    `SELECT ${threadRenameFunction}('${partition.tenant}','${partition.project}','session-grants','x')`,
  );
  await onlyTheseRolesMay(
    [apiRole],
    threadHideFunction,
    `SELECT ${threadHideFunction}('${partition.tenant}','${partition.project}','session-grants',true)`,
  );
});

/**
 * 075's close door is held beside the door it PERFORMs: a grant on the narrow
 * door that had widened into one on `close_agent_session` would let the API
 * end the project's lead, which is the thing the narrowing is for.
 */
test("the close door is the API's, and the door it performs is no runtime role's", async () => {
  const partition = await project("close-grants");

  await onlyTheseRolesMay(
    [apiRole],
    threadCloseFunction,
    `SELECT ${threadCloseFunction}('${partition.tenant}','${partition.project}','session-grants')`,
  );
  await onlyTheseRolesMay(
    [],
    sessionCloseFunction,
    `SELECT ${sessionCloseFunction}('${partition.tenant}','${partition.project}','session-grants')`,
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
  const member = threadRigMember(rig, partition, "race");
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
  const wide = threadRigMember(rig, partition, "wide");
  const over = threadRigMember(rig, partition, "over");

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

/**
 * A retried turn answers the ordinal it already has and leaves the row alone. A
 * door that refreshed the input would edit a turn a pod may already have
 * claimed, and then the transcript and the mailbox would disagree about what
 * was asked.
 */

/**
 * The twin of "a closed thread is closed before it is orphaned": a member who
 * resends is asking after the turn they already sent, so the standing-turn
 * lookup sits ahead of the backlog count. With the two the other way round a
 * retry into a full mailbox answers `Backlogged` for a turn already queued, and
 * a client that read the retry-after would wait for a turn that had never
 * needed one.
 */

/**
 * The doors ask nothing about access, because no row here holds any. A thread
 * whose owner the project has withdrawn is listed exactly as it was, and it is
 * the route above that refuses them.
 */

test("the three standings a listing can name are the roster's own", async () => {
  const partition = await project("standings");
  const open = threadRigMember(rig, partition, "standing-open");
  const closed = threadRigMember(rig, partition, "standing-closed");
  const orphan = threadRigMember(rig, partition, "standing-orphan");

  await threadRigThread(rig, partition, open);
  const ended = await threadRigThread(rig, partition, closed);
  await rig.sessions.sessions.close(partition, ended.session);
  await threadRigThread(rig, partition, orphan);
  threadRigRevoke(rig, partition, orphan);

  const listed = await rig.threads.threads(partition, threadsAnsweredMax);
  const owners = await memberAuthorities(
    rig.sessions.harness.access,
    partition,
    listed.map((record) => record.principal),
    threadsAnsweredMax,
  );
  assert.deepEqual(
    [
      ...new Set(
        listed.map(
          (record) =>
            threadEntry(
              record,
              asPrincipal("nobody"),
              owners.get(record.principal)?.subject,
            ).state,
        ),
      ),
    ].sort(),
    [...allThreadStandings].sort(),
  );
});

/**
 * Most turns already recorded predate `threadTurnBoundaryHeading` and end on
 * the standing rules' last line instead, and a turn with no seeding block in
 * front of it carries neither marker. Both are the console's own arms, and a
 * title cut before either would name the thread after the block.
 */

test("the standing read admits a thread and refuses every other session", async () => {
  const partition = await project("kindfilter");
  const member = threadRigMember(rig, partition, "kindfilter");
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

/**
 * Where the change log stands now. The cases of a suite share a database, so a
 * wake case that read from zero would be reading whatever an earlier case left
 * behind and would pass or fail on that.
 */

/** One refusal against two tickets, then a lift of one, which is two of the reasons. */

/** One ticket standing in one phase, with the change that says so. */

/**
 * One project, one member and a change for every reason the roster names. Two
 * ticket phases map to `TicketAbandoned` and both are here: a fixture holding
 * one of them agrees with a join deriving that reason from the other alone.
 */

/**
 * A ticket's changes are events, and a later one may not rewrite what an
 * earlier one meant. Every arm of the derivation had that defect, so each has a
 * case (kasofsk/chuggy#542).
 */

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
  const member = threadRigMember(rig, partition, "reconfigure");
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
  const member = threadRigMember(rig, partition, "frozen");
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
  const member = threadRigMember(rig, partition, "grants");
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
  const member = threadRigMember(rig, partition, "provisioned");
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
