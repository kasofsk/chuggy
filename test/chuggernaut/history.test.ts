import assert from "node:assert/strict";
import { test } from "node:test";
import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  EvaluatorFail,
  EvaluatorPass,
} from "../../src/domain/chuggernaut/evaluation.js";
import { TicketId } from "../../src/domain/chuggernaut/task.js";
import {
  decode,
  encode,
  TICKET_DECISION,
} from "../../src/interpreter/codec.ts";
import {
  ticketMachineEmpty,
  ticketMachineReplay,
  type TicketMachineHistory,
} from "../../src/interpreter/ticketMachineReplay.ts";
import {
  Driver,
  released,
  dispatch,
  work_result_command,
  evaluator_result_command,
} from "./domain/testing.js";

function accept(
  driver: Driver,
  command: ticket.TicketCommand,
): ticket.TicketDecision {
  const decision = driver.submit(command);
  assert.equal(decision.kind, "TicketDecided");
  if (decision.kind !== "TicketDecided") throw new Error("command refused");
  return decode(encode(decision), TICKET_DECISION);
}

test("persisted events recover a rework decision independently of policy", () => {
  const driver = new Driver();
  const history: TicketMachineHistory[] = [];
  const record = (command: ticket.TicketCommand) => {
    history.push({
      sequence: history.length + 1,
      decision: accept(driver, command),
    });
  };
  record(new ticket.CreateTicket(released(1)));
  record(dispatch(1));
  record(work_result_command(driver.graph, 1, 400));
  record(evaluator_result_command(driver.graph, 1, 401, new EvaluatorFail()));
  record(evaluator_result_command(driver.graph, 1, 402, new EvaluatorPass()));
  const checkpoint = ticketMachineReplay(
    ticketMachineEmpty(),
    history.slice(0, 3),
  );
  const recovered = ticketMachineReplay(checkpoint, history.slice(3));
  assert.deepEqual(recovered.graph, driver.graph);
  assert.equal(recovered.sequence, history.length);
  assert.equal(recovered.graph.tickets.get(TicketId(1))?.state.kind, "Work");
});

test("history rejects a gap, duplicate, or reordered event", () => {
  const driver = new Driver();
  const decision = accept(driver, new ticket.CreateTicket(released(1)));
  const state = ticketMachineReplay(ticketMachineEmpty(), [
    { sequence: 1, decision },
  ]);
  for (const sequence of [0, 1, 3, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => ticketMachineReplay(state, [{ sequence, decision }]),
      /contiguous/,
    );
  }
});

test("history rejects events that cannot follow the recovered graph", () => {
  const driver = new Driver();
  accept(driver, new ticket.CreateTicket(released(1)));
  const decision = accept(driver, dispatch(1));
  assert.throws(() =>
    ticketMachineReplay(ticketMachineEmpty(), [{ sequence: 1, decision }]),
  );
});
