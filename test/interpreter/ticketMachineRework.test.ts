/**
 * What a release's rework limit counts. Cycles are one-based, so a limit of two
 * is two work cycles with one rework between them, never two reworks. The
 * ticket view publishes the limit as a denominator, and a reader drawing work
 * cycles against it is drawing this arithmetic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as evaluation from "../../src/domain/chuggernaut/evaluation.js";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import { TicketId } from "../../src/domain/chuggernaut/task.js";
import { ticketMachineReworkPolicy } from "../../src/interpreter/ticketMachineRun.ts";
import {
  Driver,
  dispatch,
  evaluator_result_command,
  released,
  work_result_command,
} from "../chuggernaut/domain/testing.js";

const reworkTicket = TicketId(1);
const reworkStepsMax = 64;

/**
 * One ticket driven under `limit` with every work result accepted and every
 * evaluator failing, which is the only path the failure policy decides. The
 * drive stops when the ticket settles or when it has started more than
 * `cyclesMax` work cycles, so an unbounded limit returns rather than spins.
 */
function reworkDriven(limit: number | null, cyclesMax: number): ticket.Ticket {
  const policy = ticketMachineReworkPolicy(limit);
  const driver = new Driver();
  driver.submit(new ticket.CreateTicket(released(reworkTicket)), policy);
  driver.submit(dispatch(reworkTicket), policy);
  for (let step = 0; step < reworkStepsMax; step += 1) {
    const held = driver.graph.tickets.get(reworkTicket);
    assert.ok(held !== undefined, "the driven ticket left the graph");
    if (held.work_cycles_started > cyclesMax) return held;
    if (held.state.kind === "Work")
      driver.submit(
        work_result_command(driver.graph, reworkTicket, step + 1),
        policy,
      );
    else if (held.state.kind === "Evaluation")
      driver.submit(
        evaluator_result_command(
          driver.graph,
          reworkTicket,
          step + 1,
          new evaluation.EvaluatorFail(),
        ),
        policy,
      );
    else return held;
  }
  assert.fail("the driven ticket neither settled nor passed its cycle bound");
}

test("the work cycle a limit escalates on is the limit itself", () => {
  for (const limit of [1, 2, 3]) {
    const held = reworkDriven(limit, limit + 1);
    assert.equal(
      held.state.kind,
      "Escalated",
      `a limit of ${String(limit)} had not escalated by cycle ${String(limit + 1)}`,
    );
    assert.equal(
      held.work_cycles_started,
      limit,
      `a limit of ${String(limit)} ran ${String(held.work_cycles_started)} work cycles`,
    );
  }
});

test("a null limit is the domain's own policy, which reworks without bound", () => {
  const held = reworkDriven(null, 8);
  assert.notEqual(held.state.kind, "Escalated");
  assert.equal(held.work_cycles_started, 9);
});

test("a limit that is not a whole count is refused rather than rounded", () => {
  for (const limit of [-1, 1.5, Number.NaN])
    assert.throws(() => ticketMachineReworkPolicy(limit), RangeError);
});
