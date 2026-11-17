/**
 * The wake pass over a real PostgreSQL, driven by the role its three definers
 * are granted to: an escalation of a ticket a member's draft revision
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
 * cursor says how far the pass has read, and the row's `opened_after_sequence`
 * says what the thread was opened after. The case that separates them runs its
 * pass over a window holding a change from each side of the opening.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type pg from "pg";

import { postgresChatHostRegistry } from "../../src/adapters/postgres/chatHost.ts";
import {
  boundaryOwnerRole,
  poolPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerPoolRunners } from "../../src/adapters/postgres/workerPool.ts";
import type { ThreadTicketWakeSetting } from "../../src/contract/threadWake.ts";
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
import {
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ChatHostIdentity } from "../../src/interpreter/workerPoolIdentity.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessBrief,
  postgresHarnessConfiguration,
  postgresHarnessRolePool,
  postgresHarnessStalled,
} from "./harness.ts";
import {
  sessionRigPersonalRunner,
  sessionRigAttempt,
  sessionRigRouted,
  sessionRigRunner,
  sessionRigTurn,
  sessionRigTurnRoutes,
} from "./sessionHarness.ts";
import {
  threadRigKey,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigPrompt,
  threadRigRevoke,
  threadRigSlot,
  threadRigThread,
  threadRigTicketPhase,
  threadRigTicketWakes,
  threadRigTurnId,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";

let rig: ThreadRig;
let poolPlane: pg.Pool;

before(async () => {
  rig = await threadRigOpen();
  poolPlane = postgresHarnessRolePool(poolPlaneRole);
});

after(async () => {
  await poolPlane.end();
  await rig.close();
});

const instant = "2026-09-02T12:00:00.000Z";

function service(wakesPerPassMax: number): ThreadWakeService {
  return {
    store: rig.wakes,
    access: rig.sessions.harness.access,
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

/** One open draft the member authored from the thread named, which is the session the wake join follows. */
async function draft(
  partition: Partition,
  revision: ConfigurationRevisionId,
  member: ThreadRigMember,
  origin: SessionId | undefined,
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
    ...(origin === undefined ? {} : { originSession: origin }),
  });
  if (created.created !== "Created")
    throw new Error(`thread wake: the draft answered ${created.created}`);
  return created.draft.ticket;
}

/** Escalates one of the member's tickets, which is the change a `TicketEscalated` wake is derived from. */
function escalate(partition: Partition, ticket: TicketId): Promise<void> {
  return threadRigTicketPhase(rig, partition, ticket, "Escalated");
}

test("an escalation of a member's own ticket becomes one Wake turn, once", async () => {
  const partition = await threadRigProject(rig, "wakepass");
  const member = threadRigMember(rig, partition, "wakepass");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  const started = await fromTheHead();
  await escalate(partition, ticket);

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
      reason: "TicketEscalated",
      resource: String(ticket),
      principal: member.principal,
      session: thread.session,
      route: "InCluster",
      runner: "Unregistered",
      ticketWakes: { thread: "On" },
    }),
    "the turn the door holds is the identity the pass derives, or a replay is a second turn",
  );
  const document = parseThreadWake(turn.input);
  assert.equal(document.wake, "TicketEscalated");
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

/**
 * The turn identity is derived from the sequence, so two changes on one ticket
 * are two turns however they read. What each of them says is what
 * kasofsk/chuggy#542 was about, and both are in one window here.
 */
test("a ticket that moves twice wakes a thread with what each move was", async () => {
  const partition = await threadRigProject(rig, "wakemoves");
  const member = threadRigMember(rig, partition, "wakemoves");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  await fromTheHead();
  await threadRigTicketPhase(rig, partition, ticket, "Escalated");
  await threadRigTicketPhase(rig, partition, ticket, "Done");

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.equal(report.read, 2);
  assert.equal(report.woken, 2);

  const standing = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(
    standing?.turns.map((turn) => parseThreadWake(turn.input).wake),
    ["TicketEscalated", "TicketCompleted"],
    "both wakes name the move the ticket made last, so a mailbox says one thing twice",
  );
});

test("a pass whose cursor was not moved re-offers the same turn and is told so", async () => {
  const partition = await threadRigProject(rig, "wakereplay");
  const member = threadRigMember(rig, partition, "wakereplay");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  const started = await fromTheHead();
  await escalate(partition, ticket);

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
  const member = threadRigMember(rig, partition, "wakeclosed");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  await rig.sessions.sessions.close(partition, thread.session);
  const started = await fromTheHead();
  await escalate(partition, ticket);

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(
    report,
    { read: 0, woken: 0, skipped: 0, cursor: started },
    "a closed thread is no candidate, so the pass has nothing to move past",
  );
});

/**
 * The door asks nothing about access, because no row here holds any. A member
 * the project has withdrawn is woken by the door and skipped by the pass that
 * asks the authority first, so the fact is stated in one place.
 */
test("the wake door wakes a thread the project no longer admits its owner to", async () => {
  const partition = await threadRigProject(rig, "wakeorphan");
  const member = threadRigMember(rig, partition, "wakeorphan");
  const thread = await threadRigThread(rig, partition, member);
  threadRigRevoke(rig, partition, member);

  assert.deepEqual(
    await rig.wakes.wake({
      partition,
      session: thread.session,
      turn: asSessionTurnId(threadRigTurnId("wakeorphan")),
      input: threadWakeText(
        threadWakeDocument({
          wake: "TicketRefused",
          resource: "1",
          at: instant,
        }),
      ),
      route: "InCluster",
    }),
    { woken: "Woken", ordinal: 1 },
  );
});

/**
 * The window holds BOTH changes on one ticket and the cursor is below both, so
 * what separates them is the log's position the thread was opened after — a
 * pass that read the earlier one would be the rig's finding (kasofsk/chuggy#541)
 * in miniature, a mailbox filled with what happened before its owner had one.
 * A thread is younger than any draft filed through it, so the case gives the
 * draft the origin 086's backfill gives one that stood before its thread.
 */
test("a thread is woken by a change after it opened, and by none the log held before", async () => {
  const partition = await threadRigProject(rig, "wakestart");
  const member = threadRigMember(rig, partition, "wakestart");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, undefined);
  const started = await fromTheHead();
  await escalate(partition, ticket);
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  await rig.sessions.harness.query(
    `UPDATE draft SET origin_session=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, Number(ticket), thread.session],
  );

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

  await threadRigTicketPhase(rig, partition, ticket, "Done");
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
  assert.equal(parseThreadWake(turn.input).wake, "TicketCompleted");
});

/**
 * The negative space that keeps the position a fact about the opening: it is
 * written by the INSERT `open_member_thread` makes and by nothing else, so the
 * roster — read from `pg_roles`, because a list is the roles that existed the
 * day it was written — holds no `UPDATE` on it. The column beside it that one
 * role may move is swept the same way and asserted whole, so a pattern that
 * stopped matching is a red rather than a green over an empty sweep.
 */
test("no role may move the log position a thread was opened after", async () => {
  const roster = (await rig.sessions.harness.query(
    `SELECT r.rolname,
            has_column_privilege(r.rolname,'agent_session','opened_after_sequence','UPDATE') AS moves,
            has_column_privilege(r.rolname,'agent_session','capabilities','UPDATE') AS reconfigures
       FROM pg_roles r WHERE r.rolname LIKE 'chuggy\\_%'
      ORDER BY r.rolname`,
  )) as readonly {
    rolname: string;
    moves: boolean;
    reconfigures: boolean;
  }[];
  assert.deepEqual(
    roster.filter(({ moves }) => moves).map(({ rolname }) => rolname),
    [],
    "a role may rewrite the position a thread was opened after, so what its mailbox is filled from is settled somewhere other than its opening",
  );
  assert.deepEqual(
    roster
      .filter(({ reconfigures }) => reconfigures)
      .map(({ rolname }) => rolname),
    [boundaryOwnerRole],
    "the sweep disagrees with the boundary owner's own grant on the column beside it, so an empty roster would have read as a clean negative space",
  );
});

/**
 * The other half of the column's negative space: a position below the log's own
 * start is not a position, and the constraint says so where the grant cannot —
 * the identity that owns the schema is not bound by a grant.
 */
test("a thread cannot be opened after a sequence the log never held", async () => {
  const partition = await threadRigProject(rig, "wakenegative");
  const member = threadRigMember(rig, partition, "wakenegative");
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

/**
 * Opens a member's thread against another open of theirs that holds the
 * member's lock, and appends one change before that open commits. Waiting for
 * the opening to stall is what puts the append after every read the door makes
 * on its way in.
 */
async function openingAgainstAnOpen(
  partition: Partition,
  member: ThreadRigMember,
): Promise<{ readonly session: string; readonly appended: number }> {
  const holding = await rig.sessions.harness.begin();
  let committed = false;
  try {
    await holding.query(
      "SELECT opened FROM open_member_thread($1,$2,$3,$4,$5,$6,$7,NULL,NULL)",
      [
        partition.tenant,
        partition.project,
        member.principal,
        `thread-holding-${partition.project}`,
        threadRigKey(),
        threadRigSlot,
        threadRigPrompt,
      ],
    );
    let appended = 0;
    const [opened] = await Promise.all([
      threadRigThread(rig, partition, member),
      (async () => {
        await postgresHarnessStalled(rig.sessions.harness.pool, 1);
        appended = Number(
          (
            await holding.query(
              "SELECT append_project_change($1,$2,'Ticket','1')::text AS sequence",
              [partition.tenant, partition.project],
            )
          )[0]?.["sequence"],
        );
        await holding.commit();
        committed = true;
      })(),
    ]);
    return { session: opened.session, appended };
  } finally {
    if (!committed) await holding.rollback();
  }
}

/**
 * The position is the head at the moment the row is WRITTEN, and the member's
 * lock is what makes that a different fact from the head when the door was
 * called: a change appended before another open holding that lock commits is
 * sequenced above anything the opening read on its way in, and still happened
 * before the thread existed. A door drawing the head before it waits would
 * store the earlier one, and kasofsk/chuggy#541 would arrive again through two
 * threads opened at once.
 */
test("a change that commits while the door waits is a change the thread was opened after", async () => {
  const partition = await threadRigProject(rig, "wakerace");
  const member = threadRigMember(rig, partition, "wakerace");
  const called = await fromTheHead();

  const opened = await openingAgainstAnOpen(partition, member);

  assert.ok(
    opened.appended > called,
    "the change landed while the door was waiting, or this case is not the race it names",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      "SELECT opened_after_sequence::text AS opened FROM agent_session WHERE session=$1",
      [opened.session],
    ),
    [{ opened: String(opened.appended) }],
    "the thread was opened after the head the door read before it waited",
  );
});

/**
 * A thread and its project's lead may run apart, and the wake is a thread's
 * turn: the grant is asked of the thread's route and the turn keeps it, so a
 * member the tenant grants no hosted runs is woken on their runner.
 */
test("a wake is admitted on the thread's own route rather than the lead's, and the turn keeps it", async () => {
  const partition = await threadRigProject(rig, "wakeroute");
  const member = threadRigMember(rig, partition, "wakeroute");
  rig.sessions.harness.access.grantTenant({
    tenant: partition.tenant,
    principal: member.principal,
    access: new Set(),
  });
  await sessionRigRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  await fromTheHead();
  await escalate(partition, ticket);

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(report, {
    read: 1,
    woken: 1,
    skipped: 0,
    cursor: report.cursor,
  });
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, thread.session),
    ["Pool"],
  );
});

/** The runner a wake needs is the member's own chat host, so another member's, or their own personal runner, wakes nobody here. */
test("a wake on a thread routed to runners is skipped where its member has registered no chat host", async () => {
  const partition = await threadRigProject(rig, "wakerunnerless");
  const member = threadRigMember(rig, partition, "wakerunnerless");
  const other = threadRigMember(rig, partition, "wakerunnerless-other");
  await sessionRigRunner(rig.sessions, partition, other.principal);
  await sessionRigPersonalRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool");
  const thread = await threadRigThread(rig, partition, member);
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  await fromTheHead();
  await escalate(partition, ticket);
  await threadRigTicketWakes(rig, thread.session, "On");

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.deepEqual(report, {
    read: 1,
    woken: 0,
    skipped: 1,
    cursor: report.cursor,
  });
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, thread.session),
    [],
  );
});

/** The route can move between the candidate read and the wake, and the turn keeps the one the pass admitted. */
test("the wake door stamps the route it is handed rather than the one the thread resolves to", async () => {
  const partition = await threadRigProject(rig, "wakestamp");
  const member = threadRigMember(rig, partition, "wakestamp");
  await sessionRigRouted(rig.sessions, partition, "InCluster");
  const thread = await threadRigThread(rig, partition, member);

  const woken = await rig.wakes.wake({
    partition,
    session: thread.session,
    turn: asSessionTurnId(threadRigTurnId("wakestamp")),
    input: threadWakeText(
      threadWakeDocument({ wake: "TicketRefused", resource: "1", at: instant }),
    ),
    route: "Pool",
  });
  assert.equal(woken.woken, "Woken");
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, thread.session),
    ["Pool"],
  );
});

/**
 * The standing rules a wake restates are the project's own, and they reach the
 * pass on the candidate. The pass cannot read them for itself — a read there
 * would be an await inside it — so what proves the join is a project holding
 * rules of its own and a document that says them.
 */
test("a project's own standing rules reach the wake through the candidate", async () => {
  const partition = await threadRigProject(rig, "wakestanding");
  const member = threadRigMember(rig, partition, "wakestanding");
  const thread = await threadRigThread(rig, partition, member);
  await threadRigTicketWakes(rig, thread.session, "On");
  const revision = await configuration(partition);
  const ticket = await draft(partition, revision, member, thread.session);
  const stated = "- You draft, and nothing else.";
  await rig.sessions.harness.query(
    `SELECT revision FROM update_selector_project_thread_settings(
       $1,$2,0,NULL,$3,NULL,NULL,'User','thread wake suite')`,
    [partition.tenant, partition.project, stated],
  );
  await fromTheHead();
  await escalate(partition, ticket);

  await threadWakePass(service(threadWakesPerPassMax));

  const held = await rig.threads.standing({
    partition,
    session: thread.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  const turn = held?.turns[0];
  assert.ok(turn !== undefined);
  assert.equal(parseThreadWake(turn.input).standing, stated);
});

/** Registers the member's chat host under a principal the case polls it by. */
async function chatHost(
  partition: Partition,
  member: ThreadRigMember,
): Promise<ChatHostIdentity> {
  const host = {
    tenant: partition.tenant,
    owner: member.principal,
    principal: asPrincipal(`https://issuer.invalid#host-${randomUUID()}`),
  };
  const registered = await postgresChatHostRegistry(
    rig.sessions.harness.pool,
  ).register({ ...host, clientId: `chuggy-host-${randomUUID()}` });
  assert.equal(registered.written, "Registered");
  return host;
}

/** One poll of the member's chat host naming `ticketWakes`, or none, written as the pool plane writes it. */
function hostPolled(
  host: ChatHostIdentity,
  ticketWakes: ThreadTicketWakeSetting | undefined,
): Promise<void> {
  return postgresWorkerPoolRunners(poolPlane).named(
    { ...host, kind: "ChatHost" },
    undefined,
    undefined,
    undefined,
    false,
    {},
    undefined,
    ticketWakes,
  );
}

/** A member's thread with one ticket filed from it, and the cursor at the log's head. */
async function threadWithTicket(label: string) {
  const partition = await threadRigProject(rig, label);
  const member = threadRigMember(rig, partition, label);
  const thread = await threadRigThread(rig, partition, member);
  const ticket = await draft(
    partition,
    await configuration(partition),
    member,
    thread.session,
  );
  await fromTheHead();
  return { partition, member, session: thread.session, ticket };
}

/** The wake turns a thread's mailbox holds. */
async function wakesHeld(
  partition: Partition,
  session: SessionId,
): Promise<number> {
  const standing = await rig.threads.standing({
    partition,
    session,
    query: { limit: threadTurnsAnsweredMax },
  });
  return (
    standing?.turns.filter((turn) => turn.inputKind === "Wake").length ?? 0
  );
}

test("with nothing set, a thread's own ticket's change wakes nobody, the cursor moves past it, and turning wakes on delivers none of it", async () => {
  const { partition, session, ticket } = await threadWithTicket("wakeunset");
  const started = await rig.wakes.cursor();
  await escalate(partition, ticket);

  const report = await threadWakePass(service(threadWakesPerPassMax));
  assert.equal(report.read, 1);
  assert.equal(report.woken, 0);
  assert.equal(report.skipped, 1);
  assert.ok(report.cursor > started, "the cursor held at a row nobody woke");
  assert.equal(await wakesHeld(partition, session), 0);

  await threadRigTicketWakes(rig, session, "On");
  const again = await threadWakePass(service(threadWakesPerPassMax));
  assert.equal(again.read, 0, "a row the pass passed over was read again");
  assert.equal(await wakesHeld(partition, session), 0);
});

test("a thread set On is woken and one set Off is not, whatever its chat host last named", async () => {
  for (const [thread, host] of [
    ["On", "Off"],
    ["Off", "On"],
  ] as const) {
    const label = `wakechoice${thread}`;
    const { partition, member, session, ticket } =
      await threadWithTicket(label);
    await hostPolled(await chatHost(partition, member), host);
    await threadRigTicketWakes(rig, session, thread);
    await escalate(partition, ticket);

    const report = await threadWakePass(service(threadWakesPerPassMax));
    assert.equal(report.woken, thread === "On" ? 1 : 0, label);
    assert.equal(
      await wakesHeld(partition, session),
      thread === "On" ? 1 : 0,
      label,
    );
  }
});

test("a thread that made no choice follows its chat host's last poll, and a poll naming none clears the host's setting", async () => {
  const { partition, member, session, ticket } =
    await threadWithTicket("wakehost");
  const host = await chatHost(partition, member);
  for (const [named, woken] of [
    ["On", 1],
    ["Off", 0],
    ["On", 1],
    [undefined, 0],
  ] as const) {
    await hostPolled(host, named);
    await escalate(partition, ticket);
    const report = await threadWakePass(service(threadWakesPerPassMax));
    assert.equal(report.read, 1, String(named));
    assert.equal(report.woken, woken, String(named));
  }
  assert.equal(await wakesHeld(partition, session), 2);
  assert.deepEqual(
    await rig.sessions.harness.query(
      "SELECT ticket_wakes FROM chat_host WHERE tenant=$1 AND owner=$2",
      [host.tenant, host.owner],
    ),
    [{ ticket_wakes: null }],
  );
});

test("a thread's own live attempt alone chooses its ticket wakes, and its facts and the door answer what follows", async () => {
  const partition = await threadRigProject(rig, "wakedoor");
  const member = threadRigMember(rig, partition, "wakedoor");
  const thread = await threadRigThread(rig, partition, member);
  const sibling = await threadRigThread(rig, partition, member);
  await hostPolled(await chatHost(partition, member), "Off");
  await sessionRigTurn(rig.sessions, partition, thread.session, "wakedoor");
  const pod = await sessionRigAttempt(
    rig.sessions,
    partition,
    thread.session,
    "wakedoor",
  );
  const bearer = { secret: pod.secret, generation: pod.attempt.generation };

  assert.deepEqual(await rig.sessions.plane.readTicketWakes(bearer), {
    host: "Off",
  });
  assert.deepEqual(
    await rig.sessions.plane.chooseTicketWakes({ ...bearer, thread: "On" }),
    { chosen: "Recorded", wakes: { thread: "On", host: "Off" } },
  );
  assert.deepEqual(await rig.sessions.plane.readTicketWakes(bearer), {
    thread: "On",
    host: "Off",
  });
  assert.deepEqual(
    await rig.sessions.harness.query(
      "SELECT ticket_wakes FROM agent_session WHERE session=$1",
      [sibling.session],
    ),
    [{ ticket_wakes: null }],
    "one thread's attempt chose for another",
  );
  assert.deepEqual(
    await rig.sessions.plane.chooseTicketWakes({
      secret: pod.secret,
      generation: pod.attempt.generation + 1,
      thread: "Off",
    }),
    { chosen: "Fenced" },
  );
  assert.deepEqual(await rig.sessions.plane.chooseTicketWakes(bearer), {
    chosen: "Recorded",
    wakes: { host: "Off" },
  });
});
