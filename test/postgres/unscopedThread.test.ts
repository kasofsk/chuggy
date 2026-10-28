/**
 * A member's own thread against a real PostgreSQL: opened in their reserved
 * partition by the API's door, held there to its scope by the schema, routed
 * to runners whatever the installation routes, and listed beside their
 * project threads across the tenant.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { threadsOpenDefault } from "../../src/contract/http.ts";
import {
  asSessionTurnId,
  memberScopePartition,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ThreadOpened } from "../../src/interpreter/threadRead.ts";
import {
  threadRigKey,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigPrompt,
  threadRigSlot,
  threadRigThread,
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

/** `member`'s own partition in the tenant of `partition`. */
function ownOf(partition: Partition, member: ThreadRigMember): Partition {
  return memberScopePartition(partition.tenant, member.principal);
}

/** Opens one of `member`'s own threads under `key`, answering what the door said. */
function unscoped(
  partition: Partition,
  member: ThreadRigMember,
  key = threadRigKey(),
): Promise<ThreadOpened> {
  return rig.threads.openUnscoped({
    partition: ownOf(partition, member),
    principal: member.principal,
    session: rig.minting.session(),
    key,
    systemPrompt: threadRigPrompt,
    credentialSlot: threadRigSlot,
  });
}

/** The session an open named, refusing any other answer. */
function openedSession(opened: ThreadOpened): SessionId {
  if (opened.opened === "ThreadLimitReached")
    throw new Error("unscoped thread: the open reached the limit");
  return opened.thread.session;
}

/** The columns of one session row a case is about. */
async function sessionRow(
  session: SessionId,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await rig.sessions.harness.query(
    `SELECT scope,project,project_ref,kind,capabilities,account,cluster
       FROM agent_session WHERE session=$1`,
    [session],
  );
  return row;
}

test("a member's own thread opens in their reserved partition holding MemberRead alone and drawing nothing, answers its key again, and stops at their limit", async () => {
  const partition = await threadRigProject(rig, "unscoped-open");
  const member = threadRigMember(rig, partition, "unscoped-open");
  const key = threadRigKey();
  const first = openedSession(await unscoped(partition, member, key));
  const again = await unscoped(partition, member, key);
  assert.equal(again.opened, "AlreadyOpen");
  assert.equal(openedSession(again), first);
  assert.deepEqual(await sessionRow(first), {
    scope: "Member",
    project: ownOf(partition, member).project,
    project_ref: null,
    kind: "Thread",
    capabilities: ["MemberRead"],
    account: null,
    cluster: null,
  });
  assert.match(ownOf(partition, member).project, /^@member-[0-9a-f]{64}$/u);

  await threadRigThread(rig, partition, member);
  for (let opened = 1; opened < threadsOpenDefault; opened += 1)
    openedSession(await unscoped(partition, member));
  assert.deepEqual(await unscoped(partition, member), {
    opened: "ThreadLimitReached",
    threadsMax: threadsOpenDefault,
  });
});

test("no project takes a reserved identity, and a session holds to its scope however it is written", async () => {
  const partition = await threadRigProject(rig, "unscoped-held");
  const member = threadRigMember(rig, partition, "unscoped-held");
  const own = openedSession(await unscoped(partition, member));
  const projects = openedSession(
    await rig.threads.open({
      partition,
      principal: member.principal,
      session: rig.minting.session(),
      key: threadRigKey(),
      systemPrompt: threadRigPrompt,
      credentialSlot: threadRigSlot,
    }),
  );
  const refused = async (statement: string, rule: RegExp): Promise<void> => {
    await assert.rejects(rig.sessions.harness.query(statement), rule);
  };
  await refused(
    `INSERT INTO project(tenant,project,lifecycle)
     VALUES('${partition.tenant}','@member-taken','Active')`,
    /project_identity_is_not_reserved/u,
  );
  await refused(
    `UPDATE agent_session SET capabilities=ARRAY['MemberRead','ProjectRead']
      WHERE session='${own}'`,
    /agent_session_member_read_is_member_scoped/u,
  );
  await refused(
    `UPDATE agent_session SET capabilities=ARRAY['ProjectRead','MemberRead']
      WHERE session='${projects}'`,
    /agent_session_member_read_is_member_scoped/u,
  );
  await refused(
    `UPDATE agent_session SET scope='Project' WHERE session='${own}'`,
    /would change what it was opened as|agent_session_/u,
  );
  const inserted = (
    project: string,
    kind: string,
    scope: string,
    drawn: string,
  ) =>
    `INSERT INTO agent_session
       (tenant,project,session,kind,principal,capabilities,credential_slot,
        account,cluster,scope,parent_session)
     SELECT '${partition.tenant}','${project}','session-${randomUUID()}',
            '${kind}','${member.principal}','{}','${threadRigSlot}',
            ${drawn},'${scope}',NULL
       FROM agent_session s WHERE s.session='${projects}'`;
  const reserved = ownOf(partition, member).project;
  await refused(
    inserted(reserved, "Thread", "Member", "s.account,s.cluster"),
    /agent_session_member_scope_draws_nothing/u,
  );
  await refused(
    inserted(reserved, "Lead", "Member", "NULL,NULL"),
    /agent_session_member_scope_is_a_thread/u,
  );
  await refused(
    inserted("@member-someone-else", "Thread", "Member", "NULL,NULL"),
    /agent_session_member_scope_is_its_owners/u,
  );
  await refused(
    inserted(reserved, "Thread", "Project", "s.account,s.cluster"),
    /agent_session_member_scope_is_its_owners|agent_session_belongs_to_project/u,
  );
});

test("a member's own turn is routed to runners whatever the installation routes, and refused any other route", async () => {
  const partition = await threadRigProject(rig, "unscoped-route");
  const member = threadRigMember(rig, partition, "unscoped-route");
  const own = ownOf(partition, member);
  const session = openedSession(await unscoped(partition, member));
  const routing = await rig.sessions.harness.begin();
  try {
    await routing.query(
      `INSERT INTO session_routing(singleton,thread_route,lead_route,project_routes)
       VALUES(1,'InCluster','InCluster',jsonb_build_object($1::text,
         jsonb_build_object($2::text,jsonb_build_object('Thread','InCluster'))))
       ON CONFLICT (singleton) DO UPDATE
         SET thread_route=excluded.thread_route,
             project_routes=excluded.project_routes`,
      [own.tenant, own.project],
    );
    assert.deepEqual(
      await routing.query(
        `SELECT route,source FROM session_route($1,$2,'Thread')`,
        [own.tenant, own.project],
      ),
      [{ route: "Pool", source: "Default" }],
    );
  } finally {
    await routing.rollback();
  }
  const message = (route: "InCluster" | "Pool") =>
    rig.threads.enqueueMessage({
      partition: own,
      principal: member.principal,
      session,
      turn: asSessionTurnId(`turn-${randomUUID()}`),
      input: "what projects may I see?",
      route,
    });
  await assert.rejects(message("InCluster"), /chat host alone/u);
  assert.equal((await message("Pool")).enqueued, "Enqueued");
});

test("a member's threads are listed across the tenant, their own beside each project's, and no other member's", async () => {
  const partition = await threadRigProject(rig, "unscoped-listing");
  const member = threadRigMember(rig, partition, "unscoped-listing");
  const other = threadRigMember(rig, partition, "unscoped-listing-other");
  const own = openedSession(await unscoped(partition, member));
  const projects = (await threadRigThread(rig, partition, member)).session;
  openedSession(await unscoped(partition, other));
  await threadRigThread(rig, partition, other);

  const listed = await rig.threads.memberThreads({
    tenant: partition.tenant,
    principal: member.principal,
    limit: 8,
  });
  assert.deepEqual(
    new Set(
      listed.map(({ session, project, scope, principal }) =>
        JSON.stringify([session, project, scope, principal]),
      ),
    ),
    new Set([
      JSON.stringify([
        own,
        ownOf(partition, member).project,
        "Member",
        member.principal,
      ]),
      JSON.stringify([
        projects,
        partition.project,
        "Project",
        member.principal,
      ]),
    ]),
  );
});
