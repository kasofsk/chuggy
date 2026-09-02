/**
 * The lead's refusal ledger against a real server: what a decision appends,
 * what standing is derived from, what a second recording of one decision does,
 * and what reaches the change log.
 *
 * EVERY CASE DRIVES THE DOOR ITS ROLE HOLDS. The write and the selector's
 * standing read run as the selector service; the ledger and the project's
 * standing run as the API. A case that drove either as the migration owner
 * would pass over a grant that was never made.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
} from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { leadRigDecision, leadRigOpen, leadRigProject } from "./leadHarness.ts";
import type { LeadRig } from "./leadHarness.ts";

let rig: LeadRig;
before(async () => {
  rig = await leadRigOpen();
});
after(async () => {
  await rig.close();
});

/** The pages a case takes when it is not about a page. */
const refusalsBoundless = agenticRefusalsAnsweredMax;
const ledgerBoundless = agenticRefusalLedgerAnsweredMax;

test("a decision's refusals become the project's standing refusals", async () => {
  const partition = await leadRigProject(rig, "standing");
  const decision = await leadRigDecision(rig, partition, "standing");

  assert.equal(
    await rig.writes.record({
      partition,
      decision,
      refusals: [
        { ticket: asTicketId(41), ticketVersion: 3, reason: "no capacity" },
        { ticket: asTicketId(42), ticketVersion: 2, reason: "needs a brief" },
      ],
      lifts: [],
    }),
    "Recorded",
  );

  const standing = await rig.selectorStanding.standing(
    partition,
    refusalsBoundless,
  );
  assert.deepEqual(
    standing.map((refusal) => [refusal.ticket, refusal.ticketVersion]),
    [
      [41, 3],
      [42, 2],
    ],
  );
  assert.equal(standing[0]?.reason, "no capacity");
  assert.equal(standing[0]?.decision, decision);

  const read = await rig.apiRefusals.standing(partition, refusalsBoundless);
  assert.deepEqual(
    read.map((refusal) => refusal.ticket),
    [41, 42],
  );
});

test("a lift is a row and the ticket stops standing refused", async () => {
  const partition = await leadRigProject(rig, "lift");
  const refused = await leadRigDecision(rig, partition, "lift-refuse");
  await rig.writes.record({
    partition,
    decision: refused,
    refusals: [
      { ticket: asTicketId(7), ticketVersion: 1, reason: "waiting on review" },
    ],
    lifts: [],
  });
  const lifted = await leadRigDecision(rig, partition, "lift-clear", {
    notificationCursor: 1,
  });
  assert.equal(
    await rig.writes.record({
      partition,
      decision: lifted,
      refusals: [],
      lifts: [{ ticket: asTicketId(7) }],
    }),
    "Recorded",
  );

  assert.deepEqual(
    await rig.selectorStanding.standing(partition, refusalsBoundless),
    [],
    "the latest entry is a lift, so nothing stands refused",
  );
  const ledger = await rig.apiRefusals.ledger(
    partition,
    asTicketId(7),
    ledgerBoundless,
  );
  assert.deepEqual(
    ledger.map((entry) => [entry.event, entry.reason, entry.decision]),
    [
      ["Refused", "waiting on review", refused],
      ["Lifted", "waiting on review", lifted],
    ],
    "the lift carries the refusal it lifted, so a row reads without a join",
  );
});

test("a lift of a ticket with no standing refusal is refused", async () => {
  const partition = await leadRigProject(rig, "lift-nothing");
  const decision = await leadRigDecision(rig, partition, "lift-nothing");
  await assert.rejects(
    rig.writes.record({
      partition,
      decision,
      refusals: [],
      lifts: [{ ticket: asTicketId(9) }],
    }),
    /no standing refusal to lift/u,
  );
  assert.deepEqual(
    await rig.apiRefusals.ledger(partition, asTicketId(9), ledgerBoundless),
    [],
    "the refused transaction left nothing behind",
  );
});

test("a lift of a ticket whose refusal was already lifted is refused", async () => {
  const partition = await leadRigProject(rig, "lift-twice");
  const refused = await leadRigDecision(rig, partition, "lift-twice-refuse");
  await rig.writes.record({
    partition,
    decision: refused,
    refusals: [{ ticket: asTicketId(4), ticketVersion: 1, reason: "later" }],
    lifts: [],
  });
  const first = await leadRigDecision(rig, partition, "lift-twice-first", {
    notificationCursor: 1,
  });
  await rig.writes.record({
    partition,
    decision: first,
    refusals: [],
    lifts: [{ ticket: asTicketId(4) }],
  });
  const second = await leadRigDecision(rig, partition, "lift-twice-second", {
    notificationCursor: 2,
  });
  await assert.rejects(
    rig.writes.record({
      partition,
      decision: second,
      refusals: [],
      lifts: [{ ticket: asTicketId(4) }],
    }),
    /no standing refusal to lift/u,
  );
});

test("a second recording of one decision writes nothing", async () => {
  const partition = await leadRigProject(rig, "idempotent");
  const decision = await leadRigDecision(rig, partition, "idempotent");
  const refusals = [
    { ticket: asTicketId(11), ticketVersion: 1, reason: "first" },
  ];
  assert.equal(
    await rig.writes.record({ partition, decision, refusals, lifts: [] }),
    "Recorded",
  );
  assert.equal(
    await rig.writes.record({
      partition,
      decision,
      refusals: [
        { ticket: asTicketId(12), ticketVersion: 1, reason: "second" },
      ],
      lifts: [],
    }),
    "AlreadyRecorded",
  );
  assert.deepEqual(
    (await rig.selectorStanding.standing(partition, refusalsBoundless)).map(
      (refusal) => refusal.ticket,
    ),
    [11],
    "the retry appended nothing, so the second ticket never stood refused",
  );
});

test("a refusal against a decision the log has no interaction for is refused", async () => {
  const partition = await leadRigProject(rig, "unknown-decision");
  await assert.rejects(
    rig.writes.record({
      partition,
      decision: "selector-decision-never-recorded",
      refusals: [{ ticket: asTicketId(1), ticketVersion: 1, reason: "why" }],
      lifts: [],
    }),
    /no interaction to record a refusal against/u,
  );
});

test("a refusal appends one change row naming its ticket", async () => {
  const partition = await leadRigProject(rig, "change");
  const decision = await leadRigDecision(rig, partition, "change");
  await rig.writes.record({
    partition,
    decision,
    refusals: [{ ticket: asTicketId(21), ticketVersion: 4, reason: "not yet" }],
    lifts: [],
  });
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT kind,resource FROM project_change
        WHERE tenant=$1 AND project=$2 AND kind='AgenticRefusal'
        ORDER BY sequence`,
      [partition.tenant, partition.project],
    ),
    [{ kind: "AgenticRefusal", resource: "21" }],
    "the resource is the ticket, so one more refusal is one re-read",
  );
});

test("a recorded refusal can never be edited or removed", async () => {
  const partition = await leadRigProject(rig, "immutable");
  const decision = await leadRigDecision(rig, partition, "immutable");
  await rig.writes.record({
    partition,
    decision,
    refusals: [
      { ticket: asTicketId(31), ticketVersion: 1, reason: "the reason" },
    ],
    lifts: [],
  });
  await assert.rejects(
    rig.sessions.harness.query(
      `UPDATE selector_agentic_refusal SET reason='rewritten'
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    /written once/u,
  );
  await assert.rejects(
    rig.sessions.harness.query(
      `DELETE FROM selector_agentic_refusal WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    /written once/u,
  );
});

test("a reason longer than the bound is refused by the column", async () => {
  const partition = await leadRigProject(rig, "reason-bound");
  const decision = await leadRigDecision(rig, partition, "reason-bound");
  await assert.rejects(
    rig.writes.record({
      partition,
      decision,
      refusals: [
        {
          ticket: asTicketId(51),
          ticketVersion: 1,
          reason: "r".repeat(agenticRefusalReasonCharsMax + 1),
        },
      ],
      lifts: [],
    }),
    /selector_refusal_reason_is_bounded/u,
  );
});
