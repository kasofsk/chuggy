/**
 * `subjectOf`, and the one thing it must never become: a second spelling of the
 * model's attribution rule.
 *
 * `model/refinement.qnt` asks "did this record step ticket j?" as
 * `stepsTicket`, which `journal.ts` ships. An adapter needs the same fact as a
 * VALUE rather than as a question, so this slice ships the projection — and a
 * projection that drifted from its predicate would attribute the world's ledger
 * to the wrong ticket, which is precisely what theorem 2 counts over. The cases
 * below hold the two together over every record a real walk produces, rather
 * than over records this file invented.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { stepsTicket } from "../spine/journal.ts";
import { actorInit, type DurableState } from "../spine/actor.ts";
import type { Cmd } from "../spine/cmd.ts";
import { cfgInterp, createRig, decide, progFlat, wx1 } from "./harness.test.ts";
import { subjectOf } from "./ports.ts";

/** Every record a walk that reaches a cascade produces, in journal order. */
function walkedRecords(): DurableState {
  const rig = createRig();
  const arrival = (deps: ReadonlySet<number>): Cmd => ({
    tag: "JArrive",
    deps,
    program: progFlat,
    project: 1,
    wrapUp: wx1,
  });
  let s = actorInit(cfgInterp);
  s = decide(rig, s, arrival(new Set()), "arrive 1");
  s = decide(rig, s, arrival(new Set([1])), "arrive 2");
  s = decide(rig, s, arrival(new Set([1])), "arrive 3");
  s = decide(rig, s, { tag: "JRelease", ticket: 1 }, "release 1");
  s = decide(rig, s, { tag: "JDispatch", ticket: 1 }, "dispatch 1");
  return decide(rig, s, { tag: "JRevoke", ticket: 1 }, "revoke 1");
}

const walked = walkedRecords();

test("subjectOf answers exactly the ticket stepsTicket agrees with", () => {
  for (const entry of walked.journal) {
    const subject = subjectOf(entry.rec);
    for (let ticket = 1; ticket <= cfgInterp.nTickets; ticket += 1) {
      assert.equal(
        stepsTicket(entry.rec, ticket),
        subject === ticket,
        `seq ${String(entry.seq)} (${entry.rec.label}) disagreed about ticket ${String(ticket)}`,
      );
    }
  }
});

test("subjectOf answers undefined exactly when the record moved nothing", () => {
  for (const entry of walked.journal) {
    assert.equal(
      subjectOf(entry.rec) === undefined,
      entry.rec.transitions.length === 0,
      `seq ${String(entry.seq)} (${entry.rec.label})`,
    );
  }
});

test("an arrival carries an effect and names no ticket", () => {
  const arrival = walked.journal[0];
  assert.ok(arrival !== undefined);
  assert.equal(arrival.rec.label, "ticket-arrived");
  assert.deepEqual(arrival.rec.effects, ["CreateDraft"]);
  assert.equal(subjectOf(arrival.rec), undefined);
});

test("a cascade's whole list belongs to the decision's own subject", () => {
  // The revoked ticket, not the parked dependents: the record's head transition
  // is the stepped ticket, and the effects after the first are still that
  // decision's. Which dependents were parked is in the transitions.
  const cascade = walked.journal[walked.journal.length - 1];
  assert.ok(cascade !== undefined);
  assert.equal(cascade.rec.effects.length, 3);
  assert.equal(subjectOf(cascade.rec), 1);
  assert.deepEqual(
    cascade.rec.transitions.map((transition) => transition.ticket),
    [1, 2, 3],
  );
});
