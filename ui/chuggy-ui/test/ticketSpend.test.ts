/**
 * That the ledger carries what a ticket's work took and what it cost, and says
 * how much of that it could see.
 *
 * The failure this catches is a sum a reader trusts: the route pages in
 * identity order, so a page short of the ticket's executions produces a total
 * that looks like the ticket's own and is not. Every rollup here is checked
 * against its own rows and against whether the page could have held them all.
 */

import { expect, test } from "vitest";

import type { Cycle, Ledger } from "../app/core/ticketLedger.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { runSpendOf } from "../app/core/runTotals.ts";
import {
  ledgerExecution,
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  ticket21Resumed,
  type ExecutionShape,
} from "./ticketLedgerFixture.ts";

function ledgerOf(
  shapes: readonly ExecutionShape[],
  nextAfter?: string,
): Ledger {
  return ticketLedger(ledgerPage(shapes, nextAfter), ticket21Authoring);
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

test("a set runs from its first registration to its last end", () => {
  const cycle = cycleAt(ledgerOf(ticket21Parked), 0);
  expect(cycle.work?.span).toEqual({
    from: "2026-08-26T00:10:00.000Z",
    to: "2026-08-26T00:20:00.000Z",
  });
});

test("a set still holding an open execution has not ended", () => {
  const cycle = cycleAt(ledgerOf(ticket21Resumed), 2);
  const run = cycle.programRuns[1]?.stages[0];
  expect(run?.kind === "Ran" ? run.set.span : undefined).toEqual({
    from: "2026-08-26T01:20:00.000Z",
    to: undefined,
  });
});

test("a fan-out one of whose tasks has ended has not ended", () => {
  const half = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        status: "Running",
      },
    ]),
    {
      ...ticket21Authoring,
      program: [{ fanout: 2, combinator: "UnanimousPass" }],
    },
  );
  const run = cycleAt(half, 0).programRuns[0]?.stages[0];
  expect(run?.kind === "Ran" ? run.set.span : undefined).toEqual({
    from: "2026-08-26T00:10:00.000Z",
    to: undefined,
  });
});

/** One evaluation set of two tasks, each stating the instants a case wants. */
function spanOfPair(
  first: Pick<ExecutionShape, "registeredAt" | "terminalAt">,
  second: Pick<ExecutionShape, "registeredAt" | "terminalAt">,
): unknown {
  const paired = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
        ...first,
      },
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
        ...second,
      },
    ]),
    {
      ...ticket21Authoring,
      program: [{ fanout: 2, combinator: "UnanimousPass" }],
    },
  );
  const row = cycleAt(paired, 0).programRuns[0]?.stages[0];
  return row?.kind === "Ran" ? row.set.span : undefined;
}

test("an offset the text sorts after is still the earlier instant", () => {
  expect(
    spanOfPair(
      {
        registeredAt: "2026-01-01T13:00:00Z",
        terminalAt: "2026-01-01T21:00:00.500Z",
      },
      {
        registeredAt: "2026-01-01T14:00:00+02:00",
        terminalAt: "2026-01-01T21:00:00Z",
      },
    ),
  ).toEqual({
    from: "2026-01-01T14:00:00+02:00",
    to: "2026-01-01T21:00:00.500Z",
  });
});

test("a durable timestamp trimmed of its trailing zeros orders by its clock", () => {
  expect(
    spanOfPair(
      {
        registeredAt: "2026-08-26 00:10:00.123456+00",
        terminalAt: "2026-08-26 00:40:00+00",
      },
      {
        registeredAt: "2026-08-26 00:10:00+00",
        terminalAt: "2026-08-26 00:40:00.5+00",
      },
    ),
  ).toEqual({
    from: "2026-08-26 00:10:00+00",
    to: "2026-08-26 00:40:00.5+00",
  });
});

test("an instant no clock can read is left out of the span it cannot order", () => {
  expect(
    spanOfPair(
      { registeredAt: "0000-bad", terminalAt: "2026-01-01T05:00:00Z" },
      {
        registeredAt: "2026-01-01T01:00:00Z",
        terminalAt: "2026-01-01T06:00:00Z",
      },
    ),
  ).toEqual({
    from: "2026-01-01T01:00:00Z",
    to: "2026-01-01T06:00:00Z",
  });
  expect(
    spanOfPair(
      {
        registeredAt: "2026-01-01T01:00:00Z",
        terminalAt: "2026-01-01T06:00:00Z",
      },
      { registeredAt: "2026-01-01T02:00:00Z", terminalAt: "zzzz-bad" },
    ),
  ).toEqual({
    from: "2026-01-01T01:00:00Z",
    to: "2026-01-01T06:00:00Z",
  });
});

test("a cycle's span covers its work run and every evaluation of it", () => {
  const parked = ledgerOf(ticket21Parked);
  expect(cycleAt(parked, 1).span).toEqual({
    from: "2026-08-26T00:30:00.000Z",
    to: "2026-08-26T00:53:30.000Z",
  });
  expect(cycleAt(parked, 2).span).toEqual({
    from: "2026-08-26T01:00:00.000Z",
    to: "2026-08-26T01:14:00.000Z",
  });
});

test("a cycle the resume reopened has a span with no end", () => {
  expect(cycleAt(ledgerOf(ticket21Resumed), 2).span).toEqual({
    from: "2026-08-26T01:00:00.000Z",
    to: undefined,
  });
});

test("the page's span runs from its earliest row to its latest", () => {
  expect(ledgerOf(ticket21Parked).span).toEqual({
    from: "2026-08-26T00:10:00.000Z",
    to: "2026-08-26T01:14:00.000Z",
  });
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
      taskKind: "Work",
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
      taskKind: "Work",
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
      taskKind: "Work",
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
      taskKind: "Work",
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
      taskKind: "Work",
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
    ledgerExecution({
      execution: "execution-bb-2",
      task: 2,
      taskKind: "Work",
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
  ]);
  expect(agreed.totals?.costBasis).toBe("List");
  const disagreed = runSpendOf([
    ledgerExecution({
      execution: "execution-aa-1",
      task: 1,
      taskKind: "Work",
      totals: { turns: 1, durationMs: 1, costUsdMicros: 1 },
    }),
    ledgerExecution({
      execution: "execution-bb-2",
      task: 2,
      taskKind: "Work",
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
      taskKind: "Evaluation",
      stage: 0,
      outcome: "Failed",
    },
    {
      execution: "execution-cc-2",
      task: 2,
      taskKind: "Work",
      outcome: "Passed",
    },
    {
      execution: "execution-dd-3",
      task: 3,
      taskKind: "Evaluation",
      stage: 0,
      outcome: "Passed",
    },
    {
      execution: "execution-ee-4",
      task: 4,
      taskKind: "Evaluation",
      stage: 1,
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
      taskKind: "Evaluation",
      stage: 0,
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
      taskKind: "Work",
      outcome: "Passed",
    },
    {
      execution: "execution-cc-3",
      task: 3,
      taskKind: "Evaluation",
      stage: 1,
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
        taskKind: "Work",
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
      },
    ]),
    {
      ...ticket21Authoring,
      program: [{ fanout: 2, combinator: "UnanimousPass" }],
    },
  );
  expect(cycleAt(fanned, 0).complete).toBe(false);
});
