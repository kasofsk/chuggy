/**
 * A closed lead is history, against a real migrated database: the project takes
 * a successor, the successor is what every lead door then means, and the
 * uniqueness that admits one of them is still a uniqueness.
 *
 * THE DOORS ARE DRIVEN ON THE ROLES THEY ARE GRANTED TO. Opening a successor is
 * the selector service's and the page read is the API's, because a case run as
 * the migration owner is green over any grant at all — which is the whole thing
 * 066's `GRANT` is.
 *
 * A CLOSED LEAD IS SET UP BY CLOSING ONE. Every case here starts from the
 * position release 18 measured: a lead that ran and was closed, with its turns
 * still standing, and a project that must decide again.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { leadTurnsAnsweredMax } from "../../src/contract/http.ts";
import {
  apiRole,
  boundaryOwnerRole,
  selectorReviewRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { leadOpenFunction } from "../../src/adapters/postgres/schema/shared.ts";
import {
  asSessionId,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { leadSessionCapabilities } from "../../src/interpreter/leadTools.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";
import { leadRigOpen, leadRigProject, type LeadRig } from "./leadHarness.ts";
import { sessionRigSession } from "./sessionHarness.ts";

let rig: LeadRig;
let apiPool: pg.Pool;

before(async () => {
  rig = await leadRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});

after(async () => {
  await apiPool.end();
  await rig.close();
});

/** What every case opens its successor as, which is a deployment's three facts. */
const successorOpening = {
  principal: "principal-lead-successor",
  credentialSlot: "claude-code",
  systemPrompt: "the successor's objectives",
} as const;

/**
 * One project whose lead ran and was closed, which is where this suite starts.
 * A `reference` is what the predecessor's pod bound on its first answer, written
 * here rather than run because `bind_session_reference` writes this column and
 * nothing else.
 */
async function projectWithAClosedLead(
  label: string,
  reference?: string,
): Promise<{ partition: Partition; closed: string }> {
  const partition = await leadRigProject(rig, label);
  const closed = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  if (reference !== undefined)
    await rig.sessions.harness.query(
      `UPDATE agent_session SET agent_reference=$2 WHERE session=$1`,
      [closed, reference],
    );
  assert.equal(
    await rig.sessions.sessions.close(partition, closed),
    true,
    "the predecessor is closed, which is the position the fix is about",
  );
  return { partition, closed };
}

/** One successor through the door the selector's own role holds. */
function openSuccessor(partition: Partition, session: string) {
  return rig.mailbox.openLead({
    partition,
    session: asSessionId(session),
    ...successorOpening,
  });
}

test("a project whose lead closed takes a successor", async () => {
  const { partition, closed } = await projectWithAClosedLead("successor");
  const opened = await openSuccessor(partition, `lead-successor-${Date.now()}`);
  assert.equal(opened.opened, "Opened");
  assert.notEqual(opened.session, closed);
  const standing = await rig.mailbox.lead(partition);
  assert.deepEqual(
    [standing?.session, standing?.state],
    [opened.session, "Open"],
    "and the lead the selector reads is the successor, not the row it replaced",
  );
});

test("a project that already has an open lead is answered with it", async () => {
  const partition = await leadRigProject(rig, "already");
  const standing = await sessionRigSession(rig.sessions, partition, "already", {
    kind: "Lead",
  });
  const opened = await openSuccessor(partition, `lead-second-${Date.now()}`);
  assert.deepEqual(
    [opened.opened, opened.session],
    ["AlreadyOpen", standing],
    "two selector processes racing one project end with one lead between them",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT count(*)::text AS leads FROM agent_session
        WHERE tenant=$1 AND project=$2 AND kind='Lead'`,
      [partition.tenant, partition.project],
    ),
    [{ leads: "1" }],
    "and the loser wrote no row",
  );
});

test("the successor holds the roster the door writes, and not the caller's", async () => {
  const { partition } = await projectWithAClosedLead("roster");
  const opened = await openSuccessor(partition, `lead-roster-${Date.now()}`);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT kind,principal,credential_slot,system_prompt,capabilities
         FROM agent_session WHERE session=$1`,
      [opened.session],
    ),
    [
      {
        kind: "Lead",
        principal: successorOpening.principal,
        credential_slot: successorOpening.credentialSlot,
        system_prompt: successorOpening.systemPrompt,
        capabilities: [...leadSessionCapabilities],
      },
    ],
    "the roster is the definer's own, so the caller cannot widen what it opens",
  );
});

/** The runtime session one row holds, which is the whole of what makes a turn a resumed one. */
async function referenceOf(session: string) {
  return rig.sessions.harness.query(
    `SELECT agent_reference FROM agent_session WHERE session=$1`,
    [session],
  );
}

test("the successor holds no runtime session, and its predecessor keeps the one it ran", async () => {
  const { partition, closed } = await projectWithAClosedLead(
    "reference",
    "agent-session-predecessor",
  );
  const opened = await openSuccessor(partition, `lead-reference-${Date.now()}`);
  assert.deepEqual(
    await referenceOf(opened.session),
    [{ agent_reference: null }],
    "a successor that carried one would be seeded with nothing and could bind nothing of its own",
  );
  assert.deepEqual(
    await referenceOf(closed),
    [{ agent_reference: "agent-session-predecessor" }],
    "and the transcript the closed lead recorded is still the closed lead's",
  );
});

test("two open leads are refused by the index and not by the body alone", async () => {
  const partition = await leadRigProject(rig, "index");
  const standing = await sessionRigSession(rig.sessions, partition, "index", {
    kind: "Lead",
  });
  await assert.rejects(
    rig.sessions.harness.query(
      `INSERT INTO agent_session
         (tenant,project,session,kind,principal,capabilities,credential_slot,
          account,cluster)
       SELECT tenant,project,'lead-index-second',kind,principal,capabilities,
              credential_slot,account,cluster
         FROM agent_session WHERE session=$1`,
      [standing],
    ),
    /agent_session_one_lead_per_project/u,
    "the partial index is what decides a race, and a body cannot be its own control",
  );
});

test("the provisioning door no longer conflicts on a lead that is closed", async () => {
  const { partition } = await projectWithAClosedLead("provision");
  const replacement = await sessionRigSession(
    rig.sessions,
    partition,
    "provision-successor",
    { kind: "Lead" },
  );
  assert.ok(replacement, "the administrative door opens the first lead too");
  assert.equal(
    await rig.sessions.sessions.open({
      partition,
      session: asSessionId(`lead-provision-third-${Date.now()}`),
      kind: "Lead",
      principal: asPrincipal("principal-provision-third"),
      capabilities: ["RepositoryRead"],
      credentialSlot: "claude-code",
    }),
    "Conflict",
    "and still refuses a second while one is open",
  );
});

test("every lead door means the successor and not the row it replaced", async () => {
  const { partition, closed } = await projectWithAClosedLead("doors");
  const opened = await openSuccessor(partition, `lead-doors-${Date.now()}`);

  const page = await postgresLeadReads(apiPool).standing(
    partition,
    leadTurnsAnsweredMax,
  );
  assert.equal(
    page?.session,
    opened.session,
    "the console page shows the lead that takes turns",
  );

  const offered = await rig.mailbox.offer({
    partition,
    turn: asSessionTurnId(`turn-doors-${Date.now()}`),
    input: "{}",
  });
  assert.equal(
    offered.offered,
    "Enqueued",
    "a turn reaches the successor rather than the closed mailbox",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT session FROM session_turn
        WHERE tenant=$1 AND project=$2 ORDER BY enqueued_at DESC LIMIT 1`,
      [partition.tenant, partition.project],
    ),
    [{ session: opened.session }],
    "and lands in the successor's own mailbox",
  );
  assert.notEqual(opened.session, closed);
});

test("a project between leads shows the last lead there was and takes no turn", async () => {
  const { partition, closed } = await projectWithAClosedLead("between");
  const standing = await rig.mailbox.lead(partition);
  assert.deepEqual(
    [standing?.session, standing?.state],
    [closed, "Closed"],
    "the transcript a member was reading does not vanish with the session",
  );
  const offered = await rig.mailbox.offer({
    partition,
    turn: asSessionTurnId(`turn-between-${Date.now()}`),
    input: "{}",
  });
  assert.equal(
    offered.offered,
    "Closed",
    "and offering says the lead is closed rather than that there is none",
  );
});

test("the objectives door means the open lead, and answers NoLead without one", async () => {
  const { partition } = await projectWithAClosedLead("objectives");
  assert.equal(
    await rig.prompts.setSystemPrompt(partition, "objectives"),
    "NoLead",
    "a project between leads has no session these objectives would reach",
  );
  const opened = await openSuccessor(
    partition,
    `lead-objectives-${Date.now()}`,
  );
  assert.equal(
    await rig.prompts.setSystemPrompt(partition, "moved objectives"),
    "Set",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT session,system_prompt FROM agent_session
        WHERE tenant=$1 AND project=$2 AND kind='Lead' AND state='Open'`,
      [partition.tenant, partition.project],
    ),
    [{ session: opened.session, system_prompt: "moved objectives" }],
    "and it is the successor's objectives that moved",
  );
});

test("the successor door is the selector service's own and no other role's", async () => {
  const roster = (await rig.sessions.harness.query(
    `SELECT r.rolname,
            has_function_privilege(r.rolname,$1,'EXECUTE') AS permitted
       FROM pg_roles r WHERE r.rolname LIKE 'chuggy\\_%'
      ORDER BY r.rolname`,
    [`${leadOpenFunction}(text,text,text,text,text,text)`],
  )) as readonly { rolname: string; permitted: boolean }[];
  assert.ok(
    roster.some(({ rolname }) => rolname === apiRole) &&
      roster.some(({ rolname }) => rolname === selectorReviewRole),
    "the sweep is the schema's own roster, so a role a later migration adds is swept without being named here",
  );
  assert.deepEqual(
    roster.filter(({ permitted }) => permitted).map(({ rolname }) => rolname),
    [boundaryOwnerRole, selectorServiceRole],
    "minting a lead is minting an authority to act as a principal: the definer's owner holds it, one runtime role is granted it, and every other role of the installation — the API's two pools among them — is refused",
  );
  assert.match(
    (await rig.sessions.harness.attemptAs(
      apiRole,
      `SELECT ${leadOpenFunction}('t','p','s','principal','claude-code',NULL)`,
    )) ?? "the API executed the door",
    postgresHarnessDenial(leadOpenFunction),
    "and the refusal is the server's, not a privilege the case only asked about",
  );
});
