import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { z } from "zod";

import { chuggyToolHandler } from "./chuggyTools.mjs";
import {
  agenticRefusalReasonCharsMax,
  leadDecisionStaging,
  leadDispatchesMax,
  leadRefusalsPerDecisionMax,
  leadTurnDocumentVersion,
  selectorHandoffNoteBytesMax,
} from "./leadDecision.mjs";

function observationOf(overrides = {}) {
  return JSON.stringify({
    version: 1,
    decision: "decision-1",
    partition: { tenant: "vteng", project: "chuggy" },
    changes: [],
    candidates: [
      { ticket: 4, ticketVersion: 2 },
      { ticket: 5, ticketVersion: 1 },
    ],
    token: {},
    operationalContext: {},
    handoffNote: { carried: "note" },
    refusals: [{ ticket: 5, ticketVersion: 1, reason: "later" }],
    ...overrides,
  });
}

function stagingOn(input = observationOf()) {
  const staging = leadDecisionStaging();
  staging.reset(input);
  const held = new Map(
    staging.definitions.map((definition) => [
      definition.name,
      chuggyToolHandler(definition, z),
    ]),
  );
  return {
    staging,
    call: (name, args) => held.get(name)(args),
    reset: (next) => staging.reset(next),
  };
}

const errored = (answer) => answer.isError === true;
const textOf = (answer) => answer.content[0].text;

test("a turn that called no decision tool composes no document", () => {
  const { staging } = stagingOn();

  assert.equal(staging.staged(), false);
  assert.equal(staging.document(), undefined);
});

test("a staged decision is the document version 1 the runtime reads", async () => {
  const { staging, call } = stagingOn();

  await call("dispatch", { ticket: 4, expectedTicketVersion: 2 });
  await call("refuse", { ticket: 5, ticketVersion: 1, reason: "blocked" });
  await call("set_attention", { attention: "Attention" });
  await call("set_planning_intent", { intent: { next: "ticket 6" } });

  assert.deepEqual(staging.document(), {
    version: leadTurnDocumentVersion,
    dispatches: [{ ticket: 4, expectedTicketVersion: 2 }],
    refusals: [{ ticket: 5, ticketVersion: 1, reason: "blocked" }],
    lifts: [],
    attention: "Attention",
    handoffNote: { carried: "note" },
    planningIntent: { next: "ticket 6" },
  });
});

test("a turn that says nothing about the note keeps the note it was shown", async () => {
  const { staging, call } = stagingOn();

  await call("set_attention", { attention: "Monitoring" });

  assert.deepEqual(staging.document().handoffNote, { carried: "note" });
});

test("a turn that sets the note replaces it, and the last call wins", async () => {
  const { staging, call } = stagingOn();

  await call("set_handoff_note", { note: { a: 1 } });
  await call("set_handoff_note", { note: { b: 2 } });
  await call("set_attention", { attention: "Stopped" });
  await call("set_attention", { attention: "Monitoring" });

  assert.deepEqual(staging.document().handoffNote, { b: 2 });
  assert.equal(staging.document().attention, "Monitoring");
});

test("a decision that names no attention is monitoring", async () => {
  const { staging, call } = stagingOn();

  await call("dispatch", { ticket: 4, expectedTicketVersion: 2 });

  assert.equal(staging.document().attention, "Monitoring");
});

test("a second dispatch is an error the model sees, not a silent drop", async () => {
  const { staging, call } = stagingOn();

  await call("dispatch", { ticket: 4, expectedTicketVersion: 2 });
  const second = await call("dispatch", {
    ticket: 5,
    expectedTicketVersion: 1,
  });

  assert.ok(errored(second));
  assert.match(textOf(second), new RegExp(String(leadDispatchesMax)));
  assert.equal(staging.document().dispatches.length, leadDispatchesMax);
});

test("a dispatch fenced on a version the observation did not show is refused", async () => {
  const { staging, call } = stagingOn();

  const answer = await call("dispatch", {
    ticket: 4,
    expectedTicketVersion: 1,
  });

  assert.ok(errored(answer));
  assert.equal(staging.staged(), false);
});

test("a refusal naming a ticket the observation did not offer is refused", async () => {
  const { staging, call } = stagingOn();

  const answer = await call("refuse", {
    ticket: 99,
    ticketVersion: 1,
    reason: "not mine",
  });

  assert.ok(errored(answer));
  assert.match(textOf(answer), /observation did not offer/);
  assert.equal(staging.staged(), false);
});

test("a refusal past the ledger bound is an error, and the ledger stops there", async () => {
  const candidates = Array.from(
    { length: leadRefusalsPerDecisionMax + 1 },
    (_, index) => ({ ticket: index + 1, ticketVersion: 1 }),
  );
  const { staging, call } = stagingOn(observationOf({ candidates }));

  let refused;
  for (const { ticket } of candidates)
    refused = await call("refuse", { ticket, ticketVersion: 1, reason: "no" });

  assert.ok(errored(refused));
  assert.equal(staging.document().refusals.length, leadRefusalsPerDecisionMax);
});

test("one ticket entered in the refusal ledger twice is refused where the lead sees it", async () => {
  const { staging, call } = stagingOn();

  await call("refuse", { ticket: 5, ticketVersion: 1, reason: "one" });
  const second = await call("refuse", {
    ticket: 5,
    ticketVersion: 1,
    reason: "two",
  });
  const lifted = await call("lift", { ticket: 5 });

  assert.ok(errored(second));
  assert.ok(errored(lifted));
  assert.equal(staging.document().refusals.length, 1);
});

test("a ticket both dispatched and refused is refused either way round", async () => {
  const first = stagingOn();
  await first.call("dispatch", { ticket: 4, expectedTicketVersion: 2 });
  const refused = await first.call("refuse", {
    ticket: 4,
    ticketVersion: 2,
    reason: "no",
  });

  const second = stagingOn();
  await second.call("refuse", { ticket: 4, ticketVersion: 2, reason: "no" });
  const dispatched = await second.call("dispatch", {
    ticket: 4,
    expectedTicketVersion: 2,
  });

  assert.ok(errored(refused));
  assert.ok(errored(dispatched));
});

test("a lift names a refusal the observation showed as standing", async () => {
  const { staging, call } = stagingOn();

  const missing = await call("lift", { ticket: 4 });
  const held = await call("lift", { ticket: 5 });

  assert.ok(errored(missing));
  assert.ok(!errored(held));
  assert.deepEqual(staging.document().lifts, [{ ticket: 5 }]);
});

test("a reason past its bound never reaches the ledger", async () => {
  const { staging, call } = stagingOn();

  const answer = await call("refuse", {
    ticket: 5,
    ticketVersion: 1,
    reason: "x".repeat(agenticRefusalReasonCharsMax + 1),
  });

  assert.ok(errored(answer));
  assert.equal(staging.staged(), false);
});

test("a note past its column is refused and the staged note is unmoved", async () => {
  const { staging, call } = stagingOn();

  await call("set_handoff_note", { note: { kept: "small" } });
  const answer = await call("set_handoff_note", {
    note: { big: "x".repeat(selectorHandoffNoteBytesMax) },
  });

  assert.ok(errored(answer));
  assert.deepEqual(staging.document().handoffNote, { kept: "small" });
});

test("a staging that would outgrow the mailbox row is refused rather than truncated", async () => {
  const { staging, call } = stagingOn();

  await call("set_handoff_note", { note: { a: "x".repeat(60_000) } });
  const answer = await call("set_planning_intent", {
    intent: { b: "y".repeat(60_000) },
  });

  assert.ok(errored(answer));
  assert.match(textOf(answer), /the turn's answer holds/);
  assert.equal(staging.document().planningIntent, undefined);
  assert.ok(
    Buffer.byteLength(JSON.stringify(staging.document())) <= 65_536,
    "the composed document would be truncated by the pod",
  );
});

test("one turn's staging never leaks into the next", async () => {
  const held = stagingOn();

  await held.call("dispatch", { ticket: 4, expectedTicketVersion: 2 });
  await held.call("set_attention", { attention: "Stopped" });
  held.reset(observationOf({ handoffNote: { second: "turn" } }));

  assert.equal(held.staging.staged(), false);
  assert.equal(held.staging.document(), undefined);

  await held.call("set_attention", { attention: "Monitoring" });

  assert.deepEqual(held.staging.document(), {
    version: leadTurnDocumentVersion,
    dispatches: [],
    refusals: [],
    lifts: [],
    attention: "Monitoring",
    handoffNote: { second: "turn" },
  });
});

test("a turn whose input is not an observation offers nothing to decide on", async () => {
  for (const input of ["what is the plan?", "{", "[]", '{"candidates":4}']) {
    const { staging, call } = stagingOn(input);

    const answer = await call("dispatch", {
      ticket: 4,
      expectedTicketVersion: 2,
    });

    assert.ok(errored(answer), input);
    assert.equal(staging.document(), undefined);
  }
});
