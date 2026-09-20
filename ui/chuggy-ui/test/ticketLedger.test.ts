/**
 * The ledger's arrangement: which cycle a run lands in, and which runs land
 * nowhere.
 *
 * The rows are handed in deliberately out of order, so a case that passes
 * because the fixture was already sorted cannot pass here. The key is what
 * places a run, and these are the cases where sorting or a stem match would
 * give a different — and wrong — answer.
 */

import { describe, expect, test } from "vitest";

import { ticketLedgerOf } from "../app/core/ticketLedger.ts";
import { evaluationRun, run, workRun } from "./ticketRuns.ts";

const ticket = 7;

describe("a run is placed by its key", () => {
  test("a work run lands in the cycle its key names", () => {
    const ledger = ticketLedgerOf(ticket, [
      workRun(ticket, 3),
      workRun(ticket, 1),
    ]);

    expect(ledger.cycles.map((cycle) => cycle.cycle)).toEqual([1, 3]);
    expect(ledger.cycles[0]?.work?.taskKey).toBe("work:7:1");
    expect(ledger.cycles[1]?.work?.taskKey).toBe("work:7:3");
  });

  test("an evaluation lands in the work cycle it judged", () => {
    const ledger = ticketLedgerOf(ticket, [
      workRun(ticket, 2),
      evaluationRun(ticket, 2, 0, 0, 0),
    ]);

    expect(ledger.cycles).toHaveLength(1);
    expect(ledger.cycles[0]?.cycle).toBe(2);
    expect(ledger.cycles[0]?.evaluations).toHaveLength(1);
  });

  test("an evaluation of an earlier cycle does not follow the run beside it", () => {
    const ledger = ticketLedgerOf(ticket, [
      workRun(ticket, 2),
      evaluationRun(ticket, 1, 0, 0, 0),
    ]);

    expect(ledger.cycles.map((cycle) => cycle.cycle)).toEqual([1, 2]);
    expect(ledger.cycles[0]?.evaluations).toHaveLength(1);
    expect(ledger.cycles[0]?.work).toBeUndefined();
    expect(ledger.cycles[1]?.evaluations).toHaveLength(0);
  });

  test("a cycle whose work run this page did not read is still drawn", () => {
    const ledger = ticketLedgerOf(ticket, [evaluationRun(ticket, 4, 0, 0, 0)]);

    expect(ledger.cycles.map((cycle) => cycle.cycle)).toEqual([4]);
    expect(ledger.cycles[0]?.work).toBeUndefined();
  });

  test("cycles ascend by number and never by the order rows arrived", () => {
    const ledger = ticketLedgerOf(ticket, [
      workRun(ticket, 10),
      workRun(ticket, 2),
      workRun(ticket, 1),
    ]);

    expect(ledger.cycles.map((cycle) => cycle.cycle)).toEqual([1, 2, 10]);
  });
});

describe("evaluations inside one cycle", () => {
  test("order by stage, then generation, then evaluator", () => {
    const ledger = ticketLedgerOf(ticket, [
      evaluationRun(ticket, 1, 1, 0, 0),
      evaluationRun(ticket, 1, 0, 0, 1),
      evaluationRun(ticket, 1, 0, 1, 0),
      evaluationRun(ticket, 1, 0, 0, 0),
    ]);

    expect(
      ledger.cycles[0]?.evaluations.map((held) => [
        held.stage,
        held.generation,
        held.evaluator,
      ]),
    ).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  });

  test("stage ten orders after stage two rather than beside stage one", () => {
    const ledger = ticketLedgerOf(ticket, [
      evaluationRun(ticket, 1, 10, 0, 0),
      evaluationRun(ticket, 1, 2, 0, 0),
    ]);

    expect(ledger.cycles[0]?.evaluations.map((held) => held.stage)).toEqual([
      2, 10,
    ]);
  });

  test("each evaluation carries the stage its own key names", () => {
    const ledger = ticketLedgerOf(ticket, [
      evaluationRun(ticket, 1, 0, 0, 0),
      evaluationRun(ticket, 1, 3, 0, 0),
    ]);
    const stages = ledger.cycles[0]?.evaluations.map((held) => [
      held.execution.taskKey,
      held.stage,
    ]);

    expect(stages).toEqual([
      ["evaluation:7:1:0:0:0", 0],
      ["evaluation:7:1:3:0:0", 3],
    ]);
  });
});

describe("a row the ledger will not place", () => {
  test("an unreadable key is unplaced and is never guessed into a cycle", () => {
    const ledger = ticketLedgerOf(ticket, [
      workRun(ticket, 1),
      run("work:seven:1"),
    ]);

    expect(ledger.cycles).toHaveLength(1);
    expect(ledger.cycles[0]?.cycle).toBe(1);
    expect(ledger.unplaced).toEqual([
      { execution: run("work:seven:1"), why: "Unreadable" },
    ]);
  });

  test("a key naming another ticket is unplaced as that, not as unreadable", () => {
    const ledger = ticketLedgerOf(ticket, [workRun(8, 1)]);

    expect(ledger.cycles).toHaveLength(0);
    expect(ledger.unplaced.map((held) => held.why)).toEqual(["OtherTicket"]);
  });

  test("a ticket number this one is a prefix of is another ticket", () => {
    const ledger = ticketLedgerOf(ticket, [workRun(70, 1)]);

    expect(ledger.cycles).toHaveLength(0);
    expect(ledger.unplaced.map((held) => held.why)).toEqual(["OtherTicket"]);
  });

  test("a ticket with nothing run holds no cycles and nothing unplaced", () => {
    expect(ticketLedgerOf(ticket, [])).toEqual({ cycles: [], unplaced: [] });
  });
});
