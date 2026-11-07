/**
 * That the ledger carries what a ticket's work cost and says how much of that
 * it could see, and that a run's time and wait are each a sum over runs.
 *
 * The failure this catches is a sum a reader trusts: a page short of the
 * ticket's executions produces a total that looks like the ticket's own and is
 * not. Every rollup here is checked against its own rows and against whether
 * the page could have held them all.
 */

import { expect, test } from "vitest";

import type { Cycle, Ledger } from "../app/core/ticketLedger.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { runSpendOf, runTimeOf } from "../app/core/runTotals.ts";
import type { RunTimed } from "../app/core/runTotals.ts";
import {
  evalIdentity,
  ledgerExecution,
  ledgerPage,
  ticket21Program,
  ticket21Parked,
  ticket21Resumed,
  workIdentity,
  type ExecutionShape,
} from "./ticketLedgerFixture.ts";

function ledgerOf(shapes: readonly ExecutionShape[], cursor?: string): Ledger {
  return ticketLedger(ledgerPage(shapes, cursor), ticket21Program);
}

function cycleAt(ledger: Ledger, at: number): Cycle {
  const cycle = ledger.cycles[at];
  if (cycle === undefined) throw new Error(`no cycle at ${String(at)}`);
  return cycle;
}

/** The figures a meter is drawn from, in the units the wire sends them in. */
function spent(cycle: Cycle | Ledger): readonly unknown[] {
  return [
    cycle.spend.executions,
    cycle.spend.measured,
    cycle.spend.totals?.turns,
    cycle.spend.totals?.durationMs,
    cycle.spend.totals?.costUsdMicros,
    cycle.spend.totals?.costBasis,
  ];
}

/** A run registered at an instant a case names, taken and ended where it says. */
function timed(
  registeredAt: string,
  takenAt?: string,
  terminalAt?: string,
): RunTimed {
  return {
    registeredAt,
    ...(takenAt === undefined ? {} : { takenAt }),
    ...(terminalAt === undefined ? {} : { terminalAt }),
  };
}

const minuteMs = 60_000;

test("a run's time runs from when it was taken to its end, and its wait from its registration to when it was taken", () => {
  const run = timed(
    "2026-11-07T10:00:00Z",
    "2026-11-07T10:23:00Z",
    "2026-11-07T10:25:00Z",
  );
  expect(runTimeOf([run], Date.parse("2026-11-07T12:00:00Z"))).toEqual({
    ranMs: 2 * minuteMs,
    waitedMs: 23 * minuteMs,
  });
});

test("a run nothing has taken has no time, and its wait grows with now", () => {
  const run = timed("2026-11-07T10:00:00Z");
  expect(runTimeOf([run], Date.parse("2026-11-07T10:05:00Z"))).toEqual({
    ranMs: undefined,
    waitedMs: 5 * minuteMs,
  });
  expect(runTimeOf([run], Date.parse("2026-11-07T10:09:00Z"))).toEqual({
    ranMs: undefined,
    waitedMs: 9 * minuteMs,
  });
});

test("a run still going has run until now, and one ended untaken waited until its end", () => {
  const nowMs = Date.parse("2026-11-07T10:30:00Z");
  expect(
    runTimeOf([timed("2026-11-07T10:00:00Z", "2026-11-07T10:01:00Z")], nowMs),
  ).toEqual({ ranMs: 29 * minuteMs, waitedMs: minuteMs });
  expect(
    runTimeOf(
      [timed("2026-11-07T10:00:00Z", undefined, "2026-11-07T10:04:00Z")],
      nowMs,
    ),
  ).toEqual({ ranMs: undefined, waitedMs: 4 * minuteMs });
});

test("a set's time and wait are its runs' summed, and the gap between two runs is neither", () => {
  const first = timed(
    "2026-11-07T10:00:00Z",
    "2026-11-07T10:01:00Z",
    "2026-11-07T10:05:00Z",
  );
  const second = timed(
    "2026-11-07T10:15:00Z",
    "2026-11-07T10:17:00Z",
    "2026-11-07T10:20:00Z",
  );
  expect(
    runTimeOf([first, second], Date.parse("2026-11-07T11:00:00Z")),
  ).toEqual({ ranMs: 7 * minuteMs, waitedMs: 3 * minuteMs });
});

test("instants are read by their clock, an offset and a trimmed durable timestamp included, and one no clock can read counts for nothing", () => {
  const nowMs = Date.parse("2026-11-07T12:00:00Z");
  expect(
    runTimeOf(
      [
        timed(
          "2026-11-07T12:00:00+02:00",
          "2026-11-07 10:01:00.5+00",
          "2026-11-07T10:03:00.500Z",
        ),
      ],
      nowMs,
    ),
  ).toEqual({ ranMs: 2 * minuteMs, waitedMs: minuteMs + 500 });
  expect(
    runTimeOf(
      [timed("0000-bad", "2026-11-07T10:00:00Z", "2026-11-07T10:02:00Z")],
      nowMs,
    ),
  ).toEqual({ ranMs: 2 * minuteMs, waitedMs: 0 });
  expect(runTimeOf([timed("2026-11-07T10:00:00Z", "zzzz-bad")], nowMs)).toEqual(
    { ranMs: undefined, waitedMs: 120 * minuteMs },
  );
});

test("each cycle's spend is the sum of the executions under it", () => {
  const parked = ledgerOf(ticket21Parked);
  expect(spent(cycleAt(parked, 0))).toEqual([
    2,
    2,
    52,
    780_000,
    2_220_000,
    "List",
  ]);
  expect(spent(cycleAt(parked, 1))).toEqual([
    3,
    3,
    59,
    900_000,
    2_480_000,
    "List",
  ]);
  expect(spent(cycleAt(parked, 2))).toEqual([
    2,
    2,
    47,
    810_000,
    2_050_000,
    "List",
  ]);
});

test("the page's spend is the sum of every execution it holds", () => {
  expect(spent(ledgerOf(ticket21Parked))).toEqual([
    7,
    7,
    158,
    2_490_000,
    6_750_000,
    "List",
  ]);
});

test("an execution carrying no figures is counted but not measured", () => {
  expect(spent(ledgerOf(ticket21Resumed))).toEqual([
    8,
    7,
    158,
    2_490_000,
    6_750_000,
    "List",
  ]);
  expect(spent(cycleAt(ledgerOf(ticket21Resumed), 2))).toEqual([
    3,
    2,
    47,
    810_000,
    2_050_000,
    "List",
  ]);
});

test("a rollup adds the halves of a total the wire sends beside the whole", () => {
  const cycle = cycleAt(ledgerOf(ticket21Parked), 0);
  expect(cycle.spend.totals?.durationApiMs).toBe(390_000);
  expect(cycle.spend.totals?.tokensInput).toBe(52_000);
  expect(cycle.spend.totals?.tokensOutput).toBe(52);
});

test("a set nothing measured has no totals rather than totals of zero", () => {
  const bare = ledgerOf([
    {
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
    },
  ]);
  expect(bare.spend.totals).toBeUndefined();
  expect(bare.spend.measured).toBe(0);
  expect(bare.spend.executions).toBe(1);
});

test("per-model figures merge by the model that ran them", () => {
  const spend = runSpendOf([
    ledgerExecution({
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
      totals: {
        turns: 3,
        durationMs: 1_000,
        costUsdMicros: 700,
        model: "one-model",
      },
    }),
    ledgerExecution({
      execution: "execution-bb-2",
      task: 2,
      identity: workIdentity(2),
      outcome: "Passed",
      totals: {
        turns: 4,
        durationMs: 2_000,
        costUsdMicros: 900,
        model: "one-model",
      },
    }),
    ledgerExecution({
      execution: "execution-cc-3",
      task: 3,
      identity: workIdentity(3),
      outcome: "Passed",
      totals: {
        turns: 5,
        durationMs: 3_000,
        costUsdMicros: 100,
        model: "other-model",
      },
    }),
  ]);
  expect(
    spend.totals?.models.map((usage) => [usage.model, usage.costUsdMicros]),
  ).toEqual([
    ["one-model", 1_600],
    ["other-model", 100],
  ]);
});

test("a rollup claims one basis only where every run priced on it", () => {
  const agreed = runSpendOf([
    ledgerExecution({
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
    ledgerExecution({
      execution: "execution-bb-2",
      task: 2,
      identity: workIdentity(2),
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
  ]);
  expect(agreed.totals?.costBasis).toBe("List");
  const disagreed = runSpendOf([
    ledgerExecution({
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
    ledgerExecution({
      execution: "execution-bb-2",
      task: 2,
      identity: workIdentity(2),
      totals: {
        turns: 1,
        durationMs: 1,
        costUsdMicros: 1,
        costBasis: "Estimated",
      },
    }),
  ]);
  expect(disagreed.totals?.costBasis).toBe("Mixed");
});

test("a ticket whose every execution is on the page is counted as complete", () => {
  const parked = ledgerOf(ticket21Parked);
  expect(parked.cycles.map((cycle) => cycle.complete)).toEqual([
    true,
    true,
    true,
  ]);
  expect(parked.complete).toBe(true);
});

test("a page the route has more of is complete nowhere", () => {
  const short = ledgerOf(ticket21Parked, "execution-zz-9");
  expect(short.cycles.map((cycle) => cycle.complete)).toEqual([
    false,
    false,
    false,
  ]);
  expect(short.complete).toBe(false);
});

test("one incomplete cycle is enough to make the page incomplete", () => {
  const cut = ledgerOf([
    {
      execution: "execution-bb-1",
      task: 1,
      identity: evalIdentity(1, 1, 1),
      outcome: "Failed",
    },
    {
      execution: "execution-cc-2",
      task: 2,
      identity: workIdentity(2),
      outcome: "Passed",
    },
    {
      execution: "execution-dd-3",
      task: 3,
      identity: evalIdentity(2, 1, 1),
      outcome: "Passed",
    },
    {
      execution: "execution-ee-4",
      task: 4,
      identity: evalIdentity(2, 2, 1),
      outcome: "Passed",
    },
  ]);
  expect(cut.truncated).toBe(false);
  expect(cut.cycles.map((cycle) => cycle.complete)).toEqual([false, true]);
  expect(cut.complete).toBe(false);
});

test("a cycle whose work run the page does not hold is not complete", () => {
  const cut = ledgerOf([
    {
      execution: "execution-bb-2",
      task: 2,
      identity: evalIdentity(1, 1, 1),
      outcome: "Failed",
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    },
  ]);
  expect(cycleAt(cut, 0).complete).toBe(false);
  expect(cut.complete).toBe(false);
});

test("a cycle with a stage row the page holds no set for is not complete", () => {
  const gapped = ledgerOf([
    {
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
    },
    {
      execution: "execution-cc-3",
      task: 3,
      identity: evalIdentity(1, 2, 1),
      outcome: "Failed",
    },
  ]);
  expect(cycleAt(gapped, 0).complete).toBe(false);
});

test("a set short of the fan-out its stage was authored with is not complete", () => {
  const fanned = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Passed",
      },
    ]),
    [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  );
  expect(cycleAt(fanned, 0).complete).toBe(false);
});
