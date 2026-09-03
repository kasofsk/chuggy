/**
 * What migration 063 adds, driven against a real PostgreSQL by the role each
 * door is granted to.
 *
 * EVERY CASE HERE IS ABOUT A CONTROL AND NOT ABOUT A SHAPE. A grant, a revoke,
 * a check, a trigger and a predicate are each a claim about what the server
 * refuses, and the only way to hold one is to attempt the thing it refuses as
 * the identity that would attempt it. So the three doors are driven through the
 * API's role, the three plane reads through the worker plane's, and every other
 * role is asked for each and refused.
 *
 * THE ASYMMETRY IS THE SUBJECT. The fork READS its parent's batches and CANNOT
 * WRITE one, and both directions are driven: a case that only proved the read
 * would pass unchanged if the write had been widened with it, and the lead's
 * own store is compared digest for digest before and after so a write that
 * landed there is visible rather than inferred.
 *
 * THE CEILING NEEDS A LEAD MID-TURN. Assertion 6 is the shape most likely to be
 * got subtly wrong, so its case builds a lead with a settled turn AND an
 * unsettled one whose batches are already standing, and asserts the fork reads
 * only the first set.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  inquiryCloseFunction,
  inquiryStoreRefusalFunction,
  leadInquiriesReadFunction,
  leadInquiryOpenFunction,
  leadInquiryReadFunction,
  schedulerRole,
  selectorServiceRole,
  sessionAttemptReadFunction,
  sessionStoreReadFunction,
  sessionStreamListFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  agentSessionPromptCharsMax,
  inquiriesAnsweredMax,
  inquiriesOpenPerMemberMax,
  sessionStorePageBatchesMax,
  sessionSystemPromptCharsMax,
} from "../../src/contract/http.ts";
import type { SessionId } from "../../src/interpreter/agentSession.ts";
import {
  inquiryCapabilities,
  inquirySystemPrompt,
  inquiryStanding,
  parseInquiry,
} from "../../src/interpreter/inquiry.ts";
import {
  leadInquiryEntry,
  leadInquiryTurnInput,
} from "../../src/interpreter/leadInquiry.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessDenial } from "./harness.ts";
import {
  inquiryRigClaim,
  inquiryRigDigest,
  inquiryRigIdentities,
  inquiryRigLead,
  inquiryRigLeadPrompt,
  inquiryRigMember,
  inquiryRigOpen,
  inquiryRigProject,
  inquiryRigRecord,
  inquiryRigRun,
  inquiryRigSessionRow,
  inquiryRigStoreDigests,
  type InquiryRig,
  type InquiryRigMember,
} from "./inquiryHarness.ts";
import {
  threadRigMemberAlso,
  threadRigRevoke,
  threadRigSiblingProject,
  threadRigThread,
} from "./threadHarness.ts";
import { sessionRigAttempt, sessionRigSession } from "./sessionHarness.ts";

let rig: InquiryRig;

before(async () => {
  rig = await inquiryRigOpen();
});

after(async () => {
  await rig.close();
});

/** The question every case asks where the case is not about the question. */
const asked = "what stopped ticket 14?";

/** One project, its lead that has run, and a member with a membership. */
async function inquirySubject(label: string, batches = 1) {
  const partition = await inquiryRigProject(rig, label);
  const lead = await inquiryRigLead(rig, partition, label, { batches });
  const member = await inquiryRigMember(rig, partition, label);
  return { partition, lead, member };
}

/** Asks one question through the API's own door, minting the two identities. */
async function inquiryAsk(
  partition: Partition,
  member: InquiryRigMember,
  label: string,
) {
  const identities = inquiryRigIdentities(label);
  const opened = await rig.inquiries.open({
    partition,
    principal: member.principal,
    session: identities.session,
    turn: identities.turn,
    question: leadInquiryTurnInput({
      question: asked,
      asker: member.authority.subject,
    }),
  });
  return { ...identities, opened };
}

/** Every inquiry session standing in one project, whatever it answered. */
async function inquiryRows(partition: Partition): Promise<readonly unknown[]> {
  return rig.sessions.harness.query(
    `SELECT session FROM agent_session
      WHERE tenant=$1 AND project=$2 AND kind='Inquiry'`,
    [partition.tenant, partition.project],
  );
}

test("a question forks the lead that stands, not the one it replaced", async () => {
  const { partition, lead, member } = await inquirySubject("succeeded");
  assert.equal(
    await rig.sessions.sessions.close(partition, lead.session),
    true,
  );
  const successor = await inquiryRigLead(rig, partition, "succeeded-next");
  const asking = await inquiryAsk(partition, member, "succeeded");
  assert.equal(asking.opened.opened, "Opened");
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT parent_session FROM agent_session WHERE session=$1`,
      [asking.session],
    ),
    [{ parent_session: successor.session }],
    "a fork of a closed predecessor would resume a transcript nothing is adding to",
  );
});

test("a member's question forks the lead once, and a retry is the same fork", async () => {
  const { partition, lead, member } = await inquirySubject("once");
  const first = await inquiryAsk(partition, member, "once");
  assert.deepEqual(first.opened, {
    opened: "Opened",
    session: first.session,
    ordinal: 1,
  });

  const retried = await rig.inquiries.open({
    partition,
    principal: member.principal,
    session: first.session,
    turn: first.turn,
    question: leadInquiryTurnInput({
      question: "a question the retry never gets to write",
      asker: member.authority.subject,
    }),
  });
  assert.deepEqual(retried, {
    opened: "AlreadyOpen",
    session: first.session,
    ordinal: 1,
  });
  assert.equal((await inquiryRows(partition)).length, 1);

  const held = await rig.inquiries.inquiry(partition, first.session);
  assert.equal(parseInquiry(held?.input ?? "").question, asked);
  assert.equal(held?.state, "Open");
  assert.equal(held?.turnState, "Queued");
  assert.equal(held?.asker, member.authority.subject);
  assert.equal(lead.session.length > 0, true);
});

/**
 * A retry AFTER the lead has closed must still answer the ordinal it already
 * has. The arms are ordered so that `AlreadyOpen` is decided before the lead is
 * resolved at all: a member told `LeadClosed` would believe the question they
 * already asked was refused.
 */
test("a retry is answered its own ordinal even once the lead is closed", async () => {
  const { partition, lead, member } = await inquirySubject("retry-closed");
  const first = await inquiryAsk(partition, member, "retry-closed");
  assert.equal(first.opened.opened, "Opened");

  assert.equal(
    await rig.sessions.sessions.close(partition, lead.session),
    true,
  );

  const retried = await rig.inquiries.open({
    partition,
    principal: member.principal,
    session: first.session,
    turn: first.turn,
    question: leadInquiryTurnInput({
      question: asked,
      asker: member.authority.subject,
    }),
  });
  assert.deepEqual(retried, {
    opened: "AlreadyOpen",
    session: first.session,
    ordinal: 1,
  });
});

test("the four refusals each answer their own condition and write nothing", async () => {
  const leadless = await inquiryRigProject(rig, "no-lead");
  const nobody = await inquiryRigMember(rig, leadless, "no-lead");
  assert.deepEqual(
    await inquiryAsk(leadless, nobody, "no-lead").then((a) => a.opened),
    {
      opened: "NoLead",
    },
  );
  assert.equal((await inquiryRows(leadless)).length, 0);

  const unstarted = await inquiryRigProject(rig, "unstarted");
  const waiting = await inquiryRigMember(rig, unstarted, "unstarted");
  await sessionRigSession(rig.sessions, unstarted, "unstarted", {
    kind: "Lead",
    capabilities: ["ProjectRead"],
    systemPrompt: inquiryRigLeadPrompt,
  });
  assert.deepEqual(
    await inquiryAsk(unstarted, waiting, "unstarted").then((a) => a.opened),
    { opened: "LeadNotStarted" },
  );
  assert.equal((await inquiryRows(unstarted)).length, 0);

  const closing = await inquirySubject("closed");
  assert.equal(
    await rig.sessions.sessions.close(closing.partition, closing.lead.session),
    true,
  );
  assert.deepEqual(
    await inquiryAsk(closing.partition, closing.member, "closed").then(
      (a) => a.opened,
    ),
    { opened: "LeadClosed" },
  );
  assert.equal((await inquiryRows(closing.partition)).length, 0);

  const quota = await inquirySubject("quota");
  for (let spent = 0; spent < inquiriesOpenPerMemberMax; spent += 1) {
    const spending = await inquiryAsk(
      quota.partition,
      quota.member,
      `quota-${String(spent)}`,
    );
    assert.equal(spending.opened.opened, "Opened");
  }
  assert.deepEqual(
    await inquiryAsk(quota.partition, quota.member, "quota-over").then(
      (a) => a.opened,
    ),
    { opened: "InFlight" },
  );
  assert.equal(
    (await inquiryRows(quota.partition)).length,
    inquiriesOpenPerMemberMax,
  );

  const other = await inquiryRigMember(rig, quota.partition, "quota-other");
  assert.equal(
    await inquiryAsk(quota.partition, other, "quota-other").then(
      (a) => a.opened.opened,
    ),
    "Opened",
    "the bound is per member and one member's spend is not another's",
  );
});

/**
 * The bound counts the asker's own OPEN INQUIRIES and nothing else they hold. A
 * member's thread is a session with their principal on it, so a count that did
 * not name the kind would spend their quota on a conversation; and an inquiry
 * that has been answered is closed by 063's own trigger, so a member who read
 * their answers may ask again.
 */
test("the bound counts open inquiries and neither a thread nor a settled one", async () => {
  const { partition, member } = await inquirySubject("counted");
  await threadRigThread(rig, partition, member);

  const first = await inquiryAsk(partition, member, "counted-1");
  assert.equal(
    first.opened.opened,
    "Opened",
    "the asker's own thread was counted against their inquiry quota",
  );

  const attempt = await inquiryAttempt(partition, first.session, "counted");
  await inquiryRigClaim(rig, attempt, first.turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn: first.turn,
      result: "answered",
    }),
    "Answered",
  );

  for (let spent = 0; spent < inquiriesOpenPerMemberMax; spent += 1)
    assert.equal(
      await inquiryAsk(partition, member, `counted-open-${String(spent)}`).then(
        (a) => a.opened.opened,
      ),
      "Opened",
      "an inquiry the member has already been answered was still counted",
    );
  assert.deepEqual(
    await inquiryAsk(partition, member, "counted-over").then((a) => a.opened),
    { opened: "InFlight" },
  );
});

/**
 * The bound is ONE PROJECT'S, because what asking spends is that project's
 * shared account. A principal is tenant-scoped, so a count that named only the
 * tenant would lock a member out of every project they belong to once two
 * inquiries stood in any one of them — and would name a quota they had not
 * spent where they were asking.
 */
test("a member spent out in one project may still ask in another of the tenant", async () => {
  const { partition, member } = await inquirySubject("tenant-quota");
  for (let spent = 0; spent < inquiriesOpenPerMemberMax; spent += 1)
    assert.equal(
      await inquiryAsk(partition, member, `tenant-quota-${String(spent)}`).then(
        (a) => a.opened.opened,
      ),
      "Opened",
    );
  assert.deepEqual(
    await inquiryAsk(partition, member, "tenant-quota-over").then(
      (a) => a.opened,
    ),
    { opened: "InFlight" },
  );

  const sibling = await threadRigSiblingProject(rig, partition, "tenant-quota");
  await threadRigMemberAlso(rig, sibling, member);
  await inquiryRigLead(rig, sibling, "tenant-quota-sibling");
  assert.equal(
    await inquiryAsk(sibling, member, "tenant-quota-sibling").then(
      (a) => a.opened.opened,
    ),
    "Opened",
    "one project's spend refused a member in another project of the tenant",
  );
});

/**
 * The listing is THIS PROJECT'S, once. Its partition predicate and its
 * membership join are both about a tenant that holds more than one project, so
 * a suite whose every fixture mints a fresh tenant decides neither: without the
 * first, any member with `Read` here reads every other project's questions;
 * without the second, one inquiry is listed once per project its asker belongs
 * to, each naming a foreign project's subject.
 */
test("the listing is this project's inquiries, each named once by its own membership", async () => {
  const { partition, member } = await inquirySubject("sibling");
  const sibling = await threadRigSiblingProject(rig, partition, "sibling");
  await threadRigMemberAlso(rig, sibling, member);
  await inquiryRigLead(rig, sibling, "sibling");

  const here = await inquiryAsk(partition, member, "sibling-here");
  const there = await inquiryAsk(sibling, member, "sibling-there");
  assert.equal(here.opened.opened, "Opened");
  assert.equal(there.opened.opened, "Opened");

  assert.deepEqual(
    (await rig.inquiries.inquiries(partition, inquiriesAnsweredMax)).map(
      ({ session, asker }) => ({ session, asker }),
    ),
    [{ session: here.session, asker: member.authority.subject }],
    "the listing answered a sibling project's inquiry, or this one more than once",
  );
  assert.deepEqual(
    (await rig.inquiries.inquiries(sibling, inquiriesAnsweredMax)).map(
      ({ session }) => session,
    ),
    [there.session],
  );
  assert.equal(
    await rig.inquiries.inquiry(partition, there.session),
    undefined,
    "a sibling project's inquiry answered through this project's read",
  );
});

/**
 * A lead with batches and no runtime reference has nothing to fork FROM, even
 * though there is something to read: the batches are put there directly, which
 * is the only way to reach that state, and it is what makes the reference test
 * a control of its own rather than one the head test implies.
 */
test("a lead with a store and no runtime reference is a lead with nothing to fork", async () => {
  const partition = await inquiryRigProject(rig, "referenceless");
  const member = await inquiryRigMember(rig, partition, "referenceless");
  const session = await sessionRigSession(
    rig.sessions,
    partition,
    "referenceless",
    {
      kind: "Lead",
      capabilities: ["ProjectRead"],
      systemPrompt: inquiryRigLeadPrompt,
    },
  );
  const turn = inquiryRigIdentities("referenceless").turn;
  assert.equal(
    (
      await rig.sessions.sessions.enqueue({
        partition,
        session,
        turn,
        inputKind: "Observation",
        input: "observe",
      })
    ).enqueued,
    "Enqueued",
  );
  await rig.sessions.harness.query(
    `INSERT INTO session_store_batch
       (tenant,project,session,stream,batch,digest,bytes,events)
     VALUES ($1,$2,$3,'stream-referenceless',1,$4,1,1)`,
    [partition.tenant, partition.project, session, inquiryRigDigest("direct")],
  );
  await rig.sessions.harness.query(
    `UPDATE session_turn SET state='Answered',result='answered',
            batch_first=1,batch_last=1,ended_at=now() WHERE turn=$1`,
    [turn],
  );

  assert.deepEqual(
    await inquiryAsk(partition, member, "referenceless").then((a) => a.opened),
    { opened: "LeadNotStarted" },
  );
});

/**
 * A lead whose only settled turn flushed no batch has no head to fork from, and
 * `LeadNotStarted` is exactly the condition the store read's ceiling is zero
 * under — which is what makes the door and the store agree by construction.
 */
test("a lead whose settled turn flushed nothing is a lead with no head", async () => {
  const partition = await inquiryRigProject(rig, "no-head");
  const member = await inquiryRigMember(rig, partition, "no-head");
  await inquiryRigLead(rig, partition, "no-head", { batches: 0 });

  assert.deepEqual(
    await inquiryAsk(partition, member, "no-head").then((a) => a.opened),
    { opened: "LeadNotStarted" },
  );
});

test("the fork's row is the asker's, the lead's parent and a roster of reads", async () => {
  const { partition, lead, member } = await inquirySubject("row");
  const opened = await inquiryAsk(partition, member, "row");
  assert.equal(opened.opened.opened, "Opened");

  const held = await inquiryRigSessionRow(rig, opened.session);
  const parent = await inquiryRigSessionRow(rig, lead.session);
  assert.equal(held["kind"], "Inquiry");
  assert.equal(held["principal"], member.principal);
  assert.equal(held["parent_session"], lead.session);
  assert.deepEqual(held["capabilities"], [...inquiryCapabilities]);
  assert.equal(held["credential_slot"], parent["credential_slot"]);
  assert.equal(held["account"], parent["account"]);
  assert.equal(held["cluster"], parent["cluster"]);
  assert.equal(held["state"], "Open");
  assert.equal(
    held["system_prompt"],
    inquirySystemPrompt(inquiryRigLeadPrompt),
    "a fork runs under the lead's own objectives and then what being a fork means",
  );
});

/**
 * The objectives column is generated from `sessionPromptCeilings`, and an
 * inquiry's ceiling is the widest of them — so a fork of a lead whose prompt is
 * at the lead's own ceiling has to fit the column 063 replaced. This is what
 * makes the replacement red-provable rather than decorative.
 */
test("a fork of a lead at its own ceiling fits the column 063 widened", async () => {
  const partition = await inquiryRigProject(rig, "ceiling");
  const member = await inquiryRigMember(rig, partition, "ceiling");
  const widest = "o".repeat(sessionSystemPromptCharsMax);
  assert.equal(
    inquirySystemPrompt(widest).length <= agentSessionPromptCharsMax,
    true,
    "the widest fork's objectives outgrew the column every kind shares",
  );
  await inquiryRigLead(rig, partition, "ceiling", { systemPrompt: widest });

  const opened = await inquiryAsk(partition, member, "ceiling");
  assert.equal(opened.opened.opened, "Opened");
  assert.equal(
    (await inquiryRigSessionRow(rig, opened.session))["system_prompt"],
    inquirySystemPrompt(widest),
  );
});

/** One live attempt on the inquiry, which is what a pod would hold. */
async function inquiryAttempt(
  partition: Partition,
  session: SessionId,
  label: string,
) {
  return sessionRigAttempt(rig.sessions, partition, session, label);
}

test("a fork is told the reference it forks from, and a lead is told none", async () => {
  const { partition, lead, member } = await inquirySubject("fork-from");
  const opened = await inquiryAsk(partition, member, "fork-from");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "fork-from");

  const facts = await rig.sessions.plane.authenticate(attempt.secret);
  assert.equal(facts?.kind, "Inquiry");
  assert.equal(facts?.forkFrom, lead.reference);
  assert.equal(
    facts?.agentReference,
    undefined,
    "a fork has no reference of its own until it has run",
  );

  const parent = await rig.sessions.plane.authenticate(lead.attempt.secret);
  assert.equal(parent?.agentReference, lead.reference);
  assert.equal(
    parent?.forkFrom,
    undefined,
    "a lead forks from nothing, and its own reference is not its parent's",
  );
});

/**
 * A fork that has ALREADY BOUND a reference is still told the parent's. The
 * case above reads the fork before one exists, so a `fork_from` that preferred
 * the session's own would pass it — and an attempt following a lost one would
 * resume a store 063's own trigger keeps empty, answering the member with no
 * context at all.
 */
test("a fork that has run is still told its parent's reference and never its own", async () => {
  const { partition, lead, member } = await inquirySubject("fork-again");
  const opened = await inquiryAsk(partition, member, "fork-again");
  assert.equal(opened.opened.opened, "Opened");
  const first = await inquiryAttempt(partition, opened.session, "fork-again");
  const own = `runtime-fork-of-its-own-${randomUUID()}`;
  assert.equal(
    await rig.sessions.plane.bind({
      secret: first.secret,
      generation: first.attempt.generation,
      reference: own,
    }),
    "Bound",
  );

  const held = await rig.sessions.plane.authenticate(first.secret);
  assert.equal(
    held?.agentReference,
    own,
    "the fork bound no reference of its own",
  );
  assert.equal(
    held?.forkFrom,
    lead.reference,
    "a fork that has run was told to resume itself rather than its parent",
  );

  assert.equal(
    await rig.sessions.plane.lose(
      first.secret,
      first.attempt.generation,
      "LeaseExpired",
    ),
    true,
  );
  const second = await inquiryAttempt(
    partition,
    opened.session,
    "fork-again-2",
  );
  assert.equal(
    (await rig.sessions.plane.authenticate(second.secret))?.forkFrom,
    lead.reference,
    "the attempt following a lost one forked from the fork's own empty store",
  );
});

test("a fork reads its parent's batches and nothing another session wrote", async () => {
  const { partition, lead, member } = await inquirySubject("read", 2);
  const opened = await inquiryAsk(partition, member, "read");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "read");

  const parentBatches = await rig.sessions.plane.batches({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    stream: lead.stream,
    after: 0,
    limit: sessionStorePageBatchesMax,
  });
  assert.deepEqual(
    parentBatches.map(({ batch, digest }) => ({ batch, digest })),
    [1, 2].map((batch) => ({
      batch,
      digest: inquiryRigDigest(`${lead.stream}/${String(batch)}`),
    })),
  );

  const streams = await rig.sessions.plane.streams({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.deepEqual(streams, [{ stream: lead.stream, batches: 2 }]);

  const stranger = await inquiryRigLead(
    rig,
    await inquiryRigProject(rig, "stranger"),
    "stranger",
  );
  assert.deepEqual(
    await rig.sessions.plane.batches({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: stranger.stream,
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [],
    "a fork read another project's lead through its own bearer",
  );

  const sibling = await inquiryRigRun(rig, partition, "sibling", {
    kind: "Thread",
    principal: "principal-sibling",
  });
  assert.deepEqual(
    await rig.sessions.plane.batches({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: sibling.stream,
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [],
    "a fork read a third session in its own project",
  );
});

/**
 * The lead flushes eagerly, so a lead mid-turn has batches standing that end
 * inside an exchange and a fork resumed over those starts from a truncated
 * message — hence a parent read bounded by the last SETTLED turn's own last
 * batch, and a case with two batches settled and a third standing. The
 * unsettled turn's own range is written directly, which no runtime path does
 * today: that is what makes the state filter a control rather than a
 * restatement of `batch_last IS NOT NULL`, because a later door recording the
 * range as it flushed would move the head into an unfinished exchange.
 */
test("the parent read stops at the lead's last settled turn", async () => {
  const { partition, lead, member } = await inquirySubject("mid-turn", 2);
  const midTurn = inquiryRigIdentities("mid-turn").turn;
  assert.equal(
    (
      await rig.sessions.sessions.enqueue({
        partition,
        session: lead.session,
        turn: midTurn,
        inputKind: "Observation",
        input: "observe again",
      })
    ).enqueued,
    "Enqueued",
  );
  await inquiryRigClaim(rig, lead.attempt, midTurn);
  await inquiryRigRecord(rig, lead.attempt, lead.stream, 3);
  await rig.sessions.harness.query(
    `UPDATE session_turn SET batch_first=3,batch_last=3 WHERE turn=$1`,
    [midTurn],
  );

  const opened = await inquiryAsk(partition, member, "mid-turn");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "mid-turn");

  assert.deepEqual(
    (
      await rig.sessions.plane.batches({
        secret: attempt.secret,
        generation: attempt.attempt.generation,
        stream: lead.stream,
        after: 0,
        limit: sessionStorePageBatchesMax,
      })
    ).map(({ batch }) => batch),
    [1, 2],
    "the fork read into an exchange the lead has not finished",
  );

  assert.deepEqual(
    (
      await rig.sessions.plane.batches({
        secret: lead.attempt.secret,
        generation: lead.attempt.attempt.generation,
        stream: lead.stream,
        after: 0,
        limit: sessionStorePageBatchesMax,
      })
    ).map(({ batch }) => batch),
    [1, 2, 3],
    "a session reading its own stream was bounded by its own settled turn",
  );
});

/**
 * TWO WRITES, BECAUSE THERE ARE TWO CONTROLS: the fork's OWN next batch reaches
 * the insert and the trigger raises, which is the wall the pod is not what
 * enforces. A batch numbered as the LEAD'S next reaches the ordering guard
 * instead and is refused as out of order, and the lead's store is compared
 * digest for digest either side — a write widened to the parent would have
 * stored that one, so the comparison refuses the widening rather than a reading
 * of the arm.
 */
test("a fork cannot write a batch at all, and the lead's store does not move", async () => {
  const { partition, lead, member } = await inquirySubject("write");
  const opened = await inquiryAsk(partition, member, "write");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "write");
  const held = await inquiryRigStoreDigests(rig, lead.session);

  await assert.rejects(
    rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: lead.stream,
      batch: 1,
      digest: inquiryRigDigest("the fork's own bytes"),
      bytes: 1,
      events: 1,
    }),
    /is an inquiry, and an inquiry answers aside/,
    "a fork wrote its own first batch",
  );
  assert.deepEqual(await inquiryRigStoreDigests(rig, opened.session), []);

  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: lead.stream,
      batch: lead.settledBatch + 1,
      digest: inquiryRigDigest("the lead's next bytes"),
      bytes: 1,
      events: 1,
    }),
    "OutOfOrder",
    "the write reached the parent's own sequence rather than the fork's",
  );
  assert.deepEqual(
    await inquiryRigStoreDigests(rig, lead.session),
    held,
    "a fork's write landed on its parent's store",
  );
});

test("a direct insert for an inquiry raises and the same one for a lead stands", async () => {
  const { partition, lead, member } = await inquirySubject("insert");
  const opened = await inquiryAsk(partition, member, "insert");
  assert.equal(opened.opened.opened, "Opened");

  const insert = (session: SessionId, batch: number) =>
    rig.sessions.harness.query(
      `INSERT INTO session_store_batch
         (tenant,project,session,stream,batch,digest,bytes,events)
       VALUES ($1,$2,$3,$4,$5,$6,1,1)`,
      [
        partition.tenant,
        partition.project,
        session,
        lead.stream,
        batch,
        inquiryRigDigest(`direct/${String(batch)}`),
      ],
    );

  await assert.rejects(
    insert(opened.session, 1),
    /is an inquiry, and an inquiry answers aside/,
  );
  await insert(lead.session, lead.settledBatch + 1);
  assert.equal(
    (await inquiryRigStoreDigests(rig, lead.session)).length,
    lead.settledBatch + 1,
  );
  assert.deepEqual(await inquiryRigStoreDigests(rig, opened.session), []);
});

test("a turn that ends closes its inquiry, and one that is lost does not", async () => {
  const { partition, lead, member } = await inquirySubject("close");
  const answering = await inquiryAsk(partition, member, "close-answered");
  assert.equal(answering.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, answering.session, "close");
  await inquiryRigClaim(rig, attempt, answering.turn);

  assert.equal(
    (await inquiryRigSessionRow(rig, answering.session))["state"],
    "Open",
    "a claimed turn is not an ended one",
  );
  assert.equal(
    await rig.sessions.plane.lose(
      attempt.secret,
      attempt.attempt.generation,
      "LeaseExpired",
    ),
    true,
  );
  assert.equal(
    (await inquiryRigSessionRow(rig, answering.session))["state"],
    "Open",
    "an attempt lost mid-turn turned a lost pod into a lost answer",
  );

  const second = await inquiryAttempt(partition, answering.session, "close-2");
  await inquiryRigClaim(rig, second, answering.turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: second.secret,
      generation: second.attempt.generation,
      turn: answering.turn,
      result: "its brief names no branch",
    }),
    "Answered",
  );
  const closed = await inquiryRigSessionRow(rig, answering.session);
  assert.equal(closed["state"], "Closed");
  assert.equal(closed["open"], false);

  assert.equal(
    (await inquiryRigSessionRow(rig, lead.session))["state"],
    "Open",
    "a lead's own turn answering closed the lead",
  );
});

test("a failed turn closes its inquiry as an answered one does", async () => {
  const { partition, member } = await inquirySubject("failed");
  const opened = await inquiryAsk(partition, member, "failed");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "failed");
  await inquiryRigClaim(rig, attempt, opened.turn);
  assert.equal(
    await rig.sessions.plane.fail({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn: opened.turn,
      failure: "AgentFailed",
    }),
    "Failed",
  );
  assert.equal(
    (await inquiryRigSessionRow(rig, opened.session))["state"],
    "Closed",
  );
});

test("the listing is newest first, whole, and names who asked", async () => {
  const { partition, member } = await inquirySubject("listing");
  const other = await inquiryRigMember(rig, partition, "listing-other");
  const first = await inquiryAsk(partition, member, "listing-1");
  const second = await inquiryAsk(partition, other, "listing-2");
  assert.equal(first.opened.opened, "Opened");
  assert.equal(second.opened.opened, "Opened");

  const listed = await rig.inquiries.inquiries(partition, inquiriesAnsweredMax);
  assert.deepEqual(
    listed.map(({ session }) => session),
    [second.session, first.session],
  );
  assert.deepEqual(
    listed.map(({ asker }) => asker),
    [other.authority.subject, member.authority.subject],
  );

  const entries = listed.map((record) =>
    leadInquiryEntry(record, member.principal),
  );
  assert.deepEqual(
    entries.map(({ mine }) => mine),
    [false, true],
  );
  assert.deepEqual(
    entries.map(({ question }) => question),
    [asked, asked],
  );
  assert.equal(
    entries.every(({ ordinal }) => ordinal === 1),
    true,
  );

  assert.equal(
    (await rig.inquiries.inquiries(partition, 1)).length,
    1,
    "the listing answered more than it was asked for",
  );
});

test("the listing carries the answer and what the turn cost", async () => {
  const { partition, member } = await inquirySubject("answered");
  const opened = await inquiryAsk(partition, member, "answered");
  assert.equal(opened.opened.opened, "Opened");
  const attempt = await inquiryAttempt(partition, opened.session, "answered");
  await inquiryRigClaim(rig, attempt, opened.turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn: opened.turn,
      result: "its brief names no branch",
      measured: {
        model: "claude-opus-5",
        tokens: 41_234,
        costMicros: 182_000,
        durationMs: 74_210,
        tools: ["chuggy__project_ticket"],
      },
    }),
    "Answered",
  );

  const held = await rig.inquiries.inquiry(partition, opened.session);
  const entry = leadInquiryEntry(
    held ?? assert.fail("the inquiry was not read back"),
    member.principal,
  );
  assert.equal(entry.answer, "its brief names no branch");
  assert.equal(entry.turnState, "Answered");
  assert.equal(entry.state, "Closed");
  assert.equal(entry.model, "claude-opus-5");
  assert.equal(entry.costMicros, 182_000);
  assert.equal(entry.askedAt.length > 0, true);
});

test("an inquiry whose asker's membership is gone is listed with no asker", async () => {
  const { partition, member } = await inquirySubject("orphaned");
  const opened = await inquiryAsk(partition, member, "orphaned");
  assert.equal(opened.opened.opened, "Opened");
  await threadRigRevoke(rig, partition, member);

  const listed = await rig.inquiries.inquiries(partition, inquiriesAnsweredMax);
  assert.deepEqual(
    listed.map(({ session }) => session),
    [opened.session],
  );
  assert.equal(listed[0]?.asker, undefined);
  assert.equal(
    leadInquiryEntry(
      listed[0] ?? assert.fail("the inquiry was not listed"),
      member.principal,
    ).asker,
    undefined,
  );
});

test("the one-inquiry read admits an inquiry of this project's lead alone", async () => {
  const { partition, lead, member } = await inquirySubject("admits");
  const opened = await inquiryAsk(partition, member, "admits");
  assert.equal(opened.opened.opened, "Opened");

  assert.notEqual(
    await rig.inquiries.inquiry(partition, opened.session),
    undefined,
  );
  assert.equal(
    await rig.inquiries.inquiry(partition, lead.session),
    undefined,
    "the lead's own mailbox was readable through the inquiry route",
  );

  const elsewhere = await inquirySubject("admits-other");
  const theirs = await inquiryAsk(
    elsewhere.partition,
    elsewhere.member,
    "admits-other",
  );
  assert.equal(theirs.opened.opened, "Opened");
  assert.equal(
    await rig.inquiries.inquiry(partition, theirs.session),
    undefined,
    "another project's inquiry answered through this project's read",
  );
  assert.deepEqual(
    (await rig.inquiries.inquiries(partition, inquiriesAnsweredMax)).map(
      ({ session }) => session,
    ),
    [opened.session],
  );
});

/**
 * An inquiry is a fork of the project's LEAD, and the provisioning root can open
 * one against any session at all. So both reads join the parent and admit
 * `kind='Lead'` alone: a fork of a thread is not something a lead's page is
 * about, and listing it would say the lead had been asked something it had not.
 */
test("an inquiry forked from something that is not the lead is not the lead's", async () => {
  const { partition, member } = await inquirySubject("not-the-lead");
  const thread = await threadRigThread(rig, partition, member);
  const identities = inquiryRigIdentities("not-the-lead");
  assert.equal(
    await rig.sessions.sessions.open({
      partition,
      session: identities.session,
      kind: "Inquiry",
      principal: member.principal,
      parent: thread.session,
      capabilities: [...inquiryCapabilities],
      credentialSlot: "claude-code",
    }),
    "Opened",
  );
  assert.equal(
    (
      await rig.sessions.sessions.enqueue({
        partition,
        session: identities.session,
        turn: identities.turn,
        inputKind: "Inquiry",
        input: leadInquiryTurnInput({
          question: asked,
          asker: member.authority.subject,
        }),
      })
    ).enqueued,
    "Enqueued",
  );

  assert.deepEqual(
    await rig.inquiries.inquiries(partition, inquiriesAnsweredMax),
    [],
    "a fork of a thread was listed as one of the lead's",
  );
  assert.equal(
    await rig.inquiries.inquiry(partition, identities.session),
    undefined,
  );
});

test("the turn an inquiry takes carries the standing rule the fork is bound by", async () => {
  const { partition, member } = await inquirySubject("standing");
  const opened = await inquiryAsk(partition, member, "standing");
  assert.equal(opened.opened.opened, "Opened");
  const held = await rig.inquiries.inquiry(partition, opened.session);
  const document = parseInquiry(held?.input ?? "");
  assert.equal(document.standing, inquiryStanding);
  assert.equal(document.asker, member.authority.subject);

  const kind = await rig.sessions.harness.query(
    `SELECT input_kind FROM session_turn WHERE turn=$1`,
    [opened.turn],
  );
  assert.equal(kind[0]?.["input_kind"], "Inquiry");
});

/**
 * A session identity is UNIQUE WITHIN ITS PROJECT by 058's primary key and
 * GLOBALLY by `agent_session_identity_is_never_reused`, so a session id another
 * principal already minted RAISES rather than being answered: the `AlreadyOpen`
 * pre-check matches the principal, so it does not swallow the collision, and
 * the insert is what refuses it. Each constraint is named by the case it is the
 * one that fires for, because a case matching either would pass with the other
 * deleted.
 */
test("a session identity another member holds raises rather than being answered", async () => {
  const { partition, member } = await inquirySubject("collide");
  const mine = await inquiryAsk(partition, member, "collide");
  assert.equal(mine.opened.opened, "Opened");
  const other = await inquiryRigMember(rig, partition, "collide-other");

  await assert.rejects(
    rig.inquiries.open({
      partition,
      principal: other.principal,
      session: mine.session,
      turn: inquiryRigIdentities("collide-other").turn,
      question: leadInquiryTurnInput({
        question: asked,
        asker: other.authority.subject,
      }),
    }),
    /duplicate key value violates unique constraint "agent_session_pkey"/,
  );

  await assert.rejects(
    rig.inquiries.open({
      partition,
      principal: other.principal,
      session: mine.session,
      turn: mine.turn,
      question: leadInquiryTurnInput({
        question: asked,
        asker: other.authority.subject,
      }),
    }),
    /duplicate key value violates unique constraint "agent_session_pkey"/,
    "another member was told the question they never asked was already open",
  );

  const elsewhere = await inquirySubject("collide-elsewhere");
  await assert.rejects(
    rig.inquiries.open({
      partition: elsewhere.partition,
      principal: elsewhere.member.principal,
      session: mine.session,
      turn: inquiryRigIdentities("collide-elsewhere").turn,
      question: leadInquiryTurnInput({
        question: asked,
        asker: elsewhere.member.authority.subject,
      }),
    }),
    /agent_session_identity_is_never_reused/,
    "a session id another project already holds was opened again",
  );
});

/**
 * A session the caller already holds with a DIFFERENT turn is the same
 * collision: this slice has no door that puts a second turn on an inquiry, so
 * the identity is refused rather than reused.
 */
test("a second turn on a fork the caller already opened is refused", async () => {
  const { partition, member } = await inquirySubject("second-turn");
  const mine = await inquiryAsk(partition, member, "second-turn");
  assert.equal(mine.opened.opened, "Opened");

  await assert.rejects(
    rig.inquiries.open({
      partition,
      principal: member.principal,
      session: mine.session,
      turn: inquiryRigIdentities("second-turn-again").turn,
      question: leadInquiryTurnInput({
        question: asked,
        asker: member.authority.subject,
      }),
    }),
    /duplicate key value violates unique constraint "agent_session_pkey"/,
  );
  assert.equal((await inquiryRows(partition)).length, 1);
});

/** Every role but the one a door is granted to, asked for it and refused. */
const otherRoles = [
  schedulerRole,
  workerPlaneRole,
  finalizerRole,
  ticketServiceRole,
  selectorServiceRole,
  configurationImporterRole,
] as const;

/** Every door 063 declares, beside the arguments it is called with and its role. */
const doors: readonly (readonly [string, string, string])[] = [
  [leadInquiryOpenFunction, "'t','p','k','s','u',''", apiRole],
  [leadInquiriesReadFunction, "'t','p',1", apiRole],
  [leadInquiryReadFunction, "'t','p','s'", apiRole],
  [sessionAttemptReadFunction, "''", workerPlaneRole],
  [sessionStoreReadFunction, "'',1,'s',0,1", workerPlaneRole],
  [sessionStreamListFunction, "'',1,1", workerPlaneRole],
];

test("each door 063 declares is reachable by one role and revoked from the rest", async () => {
  for (const [name, arguments_, granted] of doors) {
    const call = `SELECT * FROM ${name}(${arguments_})`;
    assert.equal(
      await rig.sessions.harness.attemptAs(granted, call),
      undefined,
      `${name} refused the role it is granted to`,
    );
    for (const role of otherRoles.filter((other) => other !== granted)) {
      const refused = await rig.sessions.harness.attemptAs(role, call);
      assert.match(
        refused ?? `${name} answered ${role}`,
        postgresHarnessDenial(name),
        `${name} answered ${role}`,
      );
    }
  }
});

/**
 * Ownership is what a `SECURITY DEFINER` function EXECUTES AS, so it is the
 * whole of what the two-role split means: a door owned by the applier rather
 * than by the boundary owner runs as whoever migrated, and the grants below it
 * describe a separation the server is not making. It has no failing input on a
 * server where the applier already owns everything, which is why it is asked of
 * the catalog — the same way `:1059` asks it of the two trigger functions.
 */
test("each door 063 declares runs as the identity that owns the boundary", async () => {
  const owners = await rig.sessions.harness.query(
    `SELECT p.proname AS door,pg_get_userbyid(p.proowner) AS owner
       FROM pg_proc p WHERE p.proname = ANY($1::text[])
      ORDER BY p.proname`,
    [doors.map(([name]) => name)],
  );
  assert.deepEqual(
    owners,
    [...doors]
      .map(([door]) => ({ door, owner: boundaryOwnerRole }))
      .sort((one, other) => one.door.localeCompare(other.door)),
    "a door 063 declares runs as somebody other than the boundary's own identity",
  );
});

test("neither trigger function is anybody's to call, and both are the owner's", async () => {
  for (const name of [inquiryStoreRefusalFunction, inquiryCloseFunction]) {
    const held = await rig.sessions.harness.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege('public',p.oid,'EXECUTE') AS public
         FROM pg_proc p WHERE p.proname=$1`,
      [name],
    );
    assert.equal(held[0]?.["owner"], boundaryOwnerRole, `${name} is unowned`);
    assert.equal(held[0]?.["public"], false, `${name} is PUBLIC's to call`);
  }
});

test("the roster a fork is opened with is the contract's own and not a literal", async () => {
  const { partition, member } = await inquirySubject("roster");
  const opened = await inquiryAsk(partition, member, "roster");
  assert.equal(opened.opened.opened, "Opened");
  const generated = await rig.sessions.harness.query(
    `SELECT prosrc FROM pg_proc WHERE proname=$1`,
    [leadInquiryOpenFunction],
  );
  const body = String(generated[0]?.["prosrc"]);
  for (const capability of inquiryCapabilities)
    assert.ok(
      body.includes(`'${capability}'`),
      `the door writes no ${capability}`,
    );
  assert.deepEqual(
    (await inquiryRigSessionRow(rig, opened.session))["capabilities"],
    [...inquiryCapabilities],
  );
});

test("the door takes no roster, no account and no credential slot", async () => {
  const held = await rig.sessions.harness.query(
    `SELECT pg_get_function_arguments(p.oid) AS taken
       FROM pg_proc p WHERE p.proname=$1`,
    [leadInquiryOpenFunction],
  );
  const taken = String(held[0]?.["taken"]);
  assert.equal(
    taken,
    "in_tenant text, in_project text, in_principal text, in_session text, in_turn text, in_question text",
  );
  for (const chosen of ["capabilities", "account", "cluster", "credential"])
    assert.ok(
      !taken.includes(chosen),
      `the door lets its caller choose the fork's ${chosen}`,
    );
});

test("a principal with no membership at all still cannot spend another's quota", async () => {
  const { partition } = await inquirySubject("stranger-principal");
  const opened = await rig.inquiries.open({
    partition,
    principal: asPrincipal("principal-nobody-holds"),
    session: inquiryRigIdentities("nobody").session,
    turn: inquiryRigIdentities("nobody").turn,
    question: leadInquiryTurnInput({ question: asked, asker: "nobody" }),
  });
  assert.equal(
    opened.opened,
    "Opened",
    "the door authorizes nothing and the route above it is what does",
  );
  assert.deepEqual(
    (await rig.inquiries.inquiries(partition, inquiriesAnsweredMax)).map(
      ({ asker }) => asker,
    ),
    [undefined],
    "a principal with no membership was joined to one",
  );
});
