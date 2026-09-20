/**
 * The rework meter's arithmetic, against what the machine actually does.
 *
 * `ticketMachineReworkPolicy` escalates when `evaluation.work_cycle >= limit`,
 * and cycle numbers are 1-based, so a limit of `n` admits exactly `n` work
 * cycles. A meter that read the limit as "n reworks after the first" would be
 * one cycle generous for every ticket that has one, and no single ticket would
 * make that visible — which is why the boundary is named here case by case.
 */

import { describe, expect, test } from "vitest";

import {
  reworkMeterOf,
  reworkMeterStates,
} from "../app/core/ticketMeter.ts";

function meter(workCyclesStarted: number, reworkLimit: number | null) {
  return reworkMeterOf({ workCyclesStarted, reworkLimit }, "Work cycles");
}

describe("the limit is a ceiling on cycles", () => {
  test("a limit of one admits exactly one work cycle", () => {
    expect(meter(0, 1)).toMatchObject({ state: "Room", remaining: 1 });
    expect(meter(1, 1)).toMatchObject({ state: "AtLimit", remaining: 0 });
    expect(meter(2, 1)).toMatchObject({ state: "Over", remaining: 0 });
  });

  test("a limit of three admits three, and the third is the last", () => {
    expect(meter(2, 3)).toMatchObject({ state: "Room", remaining: 1 });
    expect(meter(3, 3)).toMatchObject({ state: "AtLimit", remaining: 0 });
  });

  test("the cycles left is the limit less the cycles started", () => {
    expect(meter(1, 5).remaining).toBe(4);
    expect(meter(4, 5).remaining).toBe(1);
  });
});

describe("the ends of the range", () => {
  test("a fresh ticket under a limit has every cycle before it", () => {
    expect(meter(0, 5)).toMatchObject({ state: "Room", remaining: 5 });
  });

  test("zero is a limit like any other and is not unbounded", () => {
    const held = meter(0, 0);

    expect(held.state).toBe("AtLimit");
    expect(held.limit).toBe(0);
    expect(held.figure).toContain("0/0");
  });

  test("a cycle started past a zero limit is counted past it", () => {
    expect(meter(1, 0).state).toBe("Over");
  });
});

describe("an unbounded ticket", () => {
  test("null is unbounded and has no cycles remaining to state", () => {
    const held = meter(4, null);

    expect(held.state).toBe("Unbounded");
    expect(held.limit).toBeNull();
    expect(held.remaining).toBeUndefined();
  });

  test("it is drawn as a count with no denominator", () => {
    const held = meter(4, null);

    expect(held.figure).toBe("4 cycles · no limit");
    expect(held.figure).not.toContain("/");
  });

  test("an unbounded ticket with no cycles yet is still unbounded", () => {
    expect(meter(0, null).state).toBe("Unbounded");
  });
});

describe("the words", () => {
  test("the figure states the count against the ceiling", () => {
    expect(meter(2, 5).figure).toBe("2/5 cycles · 3 before escalation");
    expect(meter(5, 5).figure).toBe("5/5 cycles · at the limit");
    expect(meter(6, 5).figure).toBe("6/5 cycles · past the limit");
  });

  test("the spoken figure carries none of the marks a reader hears wrong", () => {
    for (const held of [meter(2, 5), meter(5, 5), meter(6, 5), meter(2, null)])
      expect(held.spoken).not.toMatch(/[/·+]/u);
  });

  test("the spoken figure says the same thing in words", () => {
    expect(meter(2, 5).spoken).toBe(
      "Work cycles 2 work cycles started of 5 allowed, 3 before escalation",
    );
    expect(meter(2, null).spoken).toBe(
      "Work cycles 2 work cycles started, no limit",
    );
  });

  test("every state the meter can reach is on its roster", () => {
    const reached = [
      meter(0, 5),
      meter(5, 5),
      meter(6, 5),
      meter(0, null),
    ].map((held) => held.state);

    expect([...reached].sort()).toEqual([...reworkMeterStates].sort());
  });
});
