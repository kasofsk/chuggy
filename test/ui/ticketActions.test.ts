/**
 * The console's copy of the model's action enablement, held against the model.
 *
 * `ui/chuggy-ui/app/core/ticketActions.ts` restates `revocableIn` and
 * `retryableIn` because a browser reaches only `src/contract/`, and this is the
 * arrangement `no-console-sees-another` names for a value two trees both need:
 * the copy is written twice and a suite outside both holds them equal. Order is
 * not part of the claim — the offers are compared as an enablement per phase.
 *
 * The console sees less than the model does, and the second half of this suite
 * pins exactly where: a resume also needs a modeled resumption and the gas to
 * pay for it, and the wire carries neither, so the console offers a resume the
 * actor may still refuse.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { phaseRoster } from "../../src/contract/rosters.ts";
import type { TicketPhase } from "../../src/contract/rosters.ts";
import { retryableIn, revocableIn } from "../../src/domain/enablement.ts";
import type { Core, Ticket } from "../../src/domain/generated/modelTypes.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  actionsFor,
  ticketResumable,
  ticketRevocable,
} from "../../ui/chuggy-ui/app/core/ticketActions.ts";

const id = asTicketId(7);

function ticketIn(phase: TicketPhase, over: Partial<Ticket> = {}): Ticket {
  return {
    phase,
    deps: new Set<number>(),
    finalizer: "NoFinalizer",
    artifact: "NoArtifact",
    workFanout: 1,
    reworkPolicy: { type: "BudgetedRework", value: 1 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryFree",
    program: [],
    tasks: new Set(),
    record: [],
    spawned: 0,
    reworkLeft: 1,
    finalizationLeft: 1,
    gasLeft: 4,
    resumeAt: "ResumeWorking",
    reason: "NoReason",
    completions: 0,
    ...over,
  };
}

function coreWith(ticket: Ticket): Core {
  return { tickets: new Map([[id, ticket]]) };
}

test("the console's revocable phases are the model's, phase by phase", () => {
  for (const phase of phaseRoster)
    assert.equal(
      ticketRevocable(phase),
      revocableIn(coreWith(ticketIn(phase)), id),
      `revocable disagreed at ${phase}`,
    );
});

test("the console's resumable phases are the model's, phase by phase", () => {
  for (const phase of phaseRoster)
    assert.equal(
      ticketResumable(phase),
      retryableIn(coreWith(ticketIn(phase)), id),
      `resumable disagreed at ${phase}`,
    );
});

test("what the console offers is what the two predicates enable", () => {
  for (const phase of phaseRoster) {
    const core = coreWith(ticketIn(phase));
    const offered = new Set(
      actionsFor({ ticket: 7, phase, sequence: 1 }).map((one) => one.action),
    );
    assert.equal(offered.has("Revoke"), revocableIn(core, id), phase);
    assert.equal(offered.has("Resume"), retryableIn(core, id), phase);
  }
});

test("a park with no modeled resume is offered a resume the actor refuses", () => {
  const core = coreWith(ticketIn("Escalated", { resumeAt: "NoResume" }));
  assert.equal(retryableIn(core, id), false);
  assert.equal(ticketResumable("Escalated"), true);
});

test("a park with no gas for its resume is offered one the actor refuses", () => {
  const core = coreWith(
    ticketIn("Escalated", { resumeAt: "ResumeWorking", gasLeft: 0 }),
  );
  assert.equal(retryableIn(core, id), false);
  assert.equal(ticketResumable("Escalated"), true);
});
