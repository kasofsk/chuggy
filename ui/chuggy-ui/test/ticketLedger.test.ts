/**
 * That the executions of a ticket come back as the cycles that produced them.
 *
 * The failure this catches is the one a real operator hit: a stage-0 pass from
 * a superseded artifact drawn beside a stage-0 failure of the current one, with
 * nothing saying they judged different things. Every case below drives the page
 * in an order the route no longer answers in — by execution identity, a string
 * the model gives no meaning to — so a passing case is one the derivation
 * recovered from each row's own `identity` rather than one the page arrived
 * sorted for.
 */

import { expect, test } from "vitest";

import type { Cycle, StageRow, TaskSet } from "../app/core/ticketLedger.ts";
import {
  cycleLabel,
  cycleLastSet,
  retriesLabel,
  stageLabel,
  ticketLedger,
} from "../app/core/ticketLedger.ts";
import {
  evalIdentity,
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  ticket21Resumed,
  workIdentity,
  type ExecutionShape,
} from "./ticketLedgerFixture.ts";

/** The task ordinals a set holds, which is what the sort is visible as. */
function tasksOf(set: TaskSet | undefined): readonly number[] {
  return (set?.executions ?? []).map((row) => row.task);
}

/** Every task a Ran stage's current evaluators hold, in evaluator-key order. */
function ranTasks(row: StageRow): readonly number[] {
  return row.kind === "Ran"
    ? row.evaluators.flatMap((evaluator) => tasksOf(evaluator.set))
    : [];
}

/** Each stage row as its kind and the tasks it ran, in stage order. */
function stagesOf(stages: readonly StageRow[]): readonly string[] {
  return stages.map((row) =>
    row.kind === "Ran"
      ? `${String(row.stage)} ${row.verdict} ${ranTasks(row).join(",")}`
      : `${String(row.stage)} ${row.kind}`,
  );
}

function cycleAt(shapes: readonly ExecutionShape[], at: number): Cycle {
  const cycle = ticketLedger(ledgerPage(shapes), ticket21Authoring).cycles[at];
  if (cycle === undefined) throw new Error(`no cycle at ${String(at)}`);
  return cycle;
}

const singleStage: typeof ticket21Authoring = {
  ...ticket21Authoring,
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
};

test("a ticket's page becomes one cycle per work run, newest last", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Parked), ticket21Authoring);
  expect(ledger.cycles.map((cycle) => cycle.ordinal)).toEqual([1, 2, 3]);
  expect(ledger.cycles.map((cycle) => tasksOf(cycle.work))).toEqual([
    [1],
    [3],
    [6],
  ]);
});

test("the work runs are ordered by task and not by the identity they are held in", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Parked), ticket21Authoring);
  const evaluated = ledger.cycles.flatMap((cycle) => stagesOf(cycle.stages));
  expect(evaluated).toEqual([
    "1 Failed 2",
    "2 Skipped",
    "1 Passed 4",
    "2 Failed 5",
    "1 Failed 7",
    "2 Skipped",
  ]);
});

test("a stage that failed short-circuits the stages after it", () => {
  expect(stagesOf(cycleAt(ticket21Parked, 0).stages)).toEqual([
    "1 Failed 2",
    "2 Skipped",
  ]);
});

test("a resume re-asks only the evaluator its stage blocked, at the next generation", () => {
  const cycle = cycleAt(ticket21Resumed, 2);
  expect(stagesOf(cycle.stages)).toEqual(["1 Running 8,7", "2 Queued"]);
  const stage = cycle.stages[0];
  expect(
    stage?.kind === "Ran" ? stage.evaluators[0]?.generation : undefined,
  ).toBe(2);
  expect(
    stage?.kind === "Ran"
      ? stage.evaluators.map((row) => [row.generation, row.standing])
      : undefined,
  ).toEqual([
    [2, "Current"],
    [1, "Superseded"],
  ]);
});

test("a stage blocked at generation 1 draws its resumed evaluator beside the pass it kept, and keeps its blocked generation as a row of its own", () => {
  const twoEvaluatorStage: typeof ticket21Authoring = {
    ...ticket21Authoring,
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  };
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Passed",
        totals: { turns: 1, durationMs: 1_000, costUsdMicros: 1_000_000 },
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1, 1),
        outcome: "Blocked",
        totals: { turns: 1, durationMs: 1_000, costUsdMicros: 500_000 },
      },
      {
        execution: "execution-cc-3",
        task: 3,
        identity: evalIdentity(1, 1, 1, 2),
        outcome: "Passed",
        totals: { turns: 1, durationMs: 1_000, costUsdMicros: 300_000 },
      },
      {
        execution: "execution-dd-4",
        task: 4,
        identity: evalIdentity(1, 1, 2, 1),
        outcome: "Passed",
        totals: { turns: 1, durationMs: 1_000, costUsdMicros: 700_000 },
      },
    ]),
    twoEvaluatorStage,
  );
  const cycle = ledger.cycles[0];
  const stage = cycle?.stages[0];
  if (stage?.kind !== "Ran") throw new Error("stage did not run");
  expect(
    stage.evaluators.map((row) => [
      row.key,
      row.generation,
      row.set.verdict,
      row.standing,
      ...tasksOf(row.set),
    ]),
  ).toEqual([
    [1, 2, "Passed", "Current", 4],
    [1, 1, "Blocked", "Superseded", 2],
    [2, 1, "Passed", "Current", 3],
  ]);
  expect(stage.verdict).toBe("Passed");
  expect(stage.expected).toBe(2);
  expect(cycle?.spend.totals?.costUsdMicros).toBe(2_500_000);
});

test("only the last cycle stands as current", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Resumed), ticket21Authoring);
  expect(ledger.cycles.map((cycle) => cycle.standing)).toEqual([
    "Superseded",
    "Superseded",
    "Current",
  ]);
});

test("a passed work run marks the cycle's artifact and a failed one marks none", () => {
  expect(cycleAt(ticket21Parked, 0).artifact).toBe("Produced");
  const failed = cycleAt(
    [
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Failed",
      },
    ],
    0,
  );
  expect(failed.artifact).toBe("None");
  expect(failed.stages).toEqual([]);
});

test("a work run still running has no artifact and no evaluation yet", () => {
  const cycle = cycleAt(
    [
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        status: "Running",
      },
    ],
    0,
  );
  expect(cycle.work?.verdict).toBe("Running");
  expect(cycle.artifact).toBe("None");
});

/** A one-stage program keyed 1 and 3, after the evaluators named have passed. */
function sparseStage(evaluators: readonly number[]): StageRow | undefined {
  const sparse: typeof ticket21Authoring = {
    ...ticket21Authoring,
    program: [{ key: 1, evaluators: [{ key: 1 }, { key: 3 }] }],
  };
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Passed",
      },
      ...evaluators.map((evaluator) => ({
        execution: `execution-bb-${evaluator}`,
        task: evaluator + 1,
        identity: evalIdentity(1, 1, 1, evaluator),
        outcome: "Passed" as const,
      })),
    ]),
    sparse,
  );
  return ledger.cycles[0]?.stages[0];
}

test("a sparse stage draws both evaluators", () => {
  const stage = sparseStage([1, 3]);
  if (stage?.kind !== "Ran") throw new Error("stage did not run");
  expect(stage.evaluators.map((row) => row.key)).toEqual([1, 3]);
  expect(stage.expected).toBe(2);
});

test("a cancelled set and a blocked one are each their own verdict", () => {
  const blocked = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        status: "Cancelled",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Blocked",
      },
    ]),
    singleStage,
  );
  expect(blocked.cycles[0]?.work?.verdict).toBe("Cancelled");
  expect(stagesOf(blocked.cycles[0]?.stages ?? [])).toEqual(["1 Blocked 2"]);
});

test("a stage that was blocked leaves the stages after it queued, not skipped", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        identity: evalIdentity(1, 1, 1),
        outcome: "Blocked",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Blocked 1",
    "2 Queued",
  ]);
});

test("a stage that was cancelled skips the stages after it, as a failed one does", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        identity: evalIdentity(1, 1, 1),
        status: "Cancelled",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Cancelled 1",
    "2 Skipped",
  ]);
});

test("a stage that is still running leaves the stages after it queued", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        identity: evalIdentity(1, 1, 1),
        status: "Running",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Running 1",
    "2 Queued",
  ]);
});

test("two stages of one generation are two rows, not one merged row", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        identity: evalIdentity(1, 1, 1),
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 2, 1),
        outcome: "Failed",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Passed 1",
    "2 Failed 2",
  ]);
});

test("a work task and an evaluation task of one cycle are two sets", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
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
    singleStage,
  );
  expect(tasksOf(ledger.cycles[0]?.work)).toEqual([1]);
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual(["1 Passed 2"]);
});

test("a stage is drawn against the fan-out its stage was authored with", () => {
  const cycle = cycleAt(ticket21Parked, 0);
  expect(cycle.work?.expected).toBe(1);
  const row = cycle.stages[0];
  expect(row?.kind === "Ran" ? row.expected : undefined).toBe(1);
});

test("a sparse stage's expected width is its evaluator count, not its highest key", () => {
  const row = sparseStage([1]);
  expect(row?.kind === "Ran" ? row.expected : undefined).toBe(2);
});

test("a single-stage program draws one row and no stage after it", () => {
  const ledger = ticketLedger(
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
    singleStage,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual(["1 Passed 2"]);
});

test("a page the route has more of says so", () => {
  const short = ticketLedger(
    ledgerPage([], "execution-zz-9"),
    ticket21Authoring,
  );
  expect(short.cycles).toEqual([]);
  expect(short.truncated).toBe(true);
  expect(ticketLedger(ledgerPage([]), ticket21Authoring).truncated).toBe(false);
});

test("the page's cursor reaches the ledger and every cycle under it", () => {
  const rows: readonly ExecutionShape[] = [
    {
      execution: "execution-aa-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
    },
  ];
  const whole = ticketLedger(ledgerPage(rows), ticket21Authoring);
  expect([whole.truncated, whole.cycles[0]?.complete]).toEqual([false, true]);
  const short = ticketLedger(
    ledgerPage(rows, "execution-zz-9"),
    ticket21Authoring,
  );
  expect([short.truncated, short.cycles[0]?.complete]).toEqual([true, false]);
});

test("a page cut before a cycle's work run says the artifact is unknown", () => {
  const cycle = cycleAt(
    [
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Failed",
      },
    ],
    0,
  );
  expect(cycle.work).toBeUndefined();
  expect(cycle.artifact).toBe("Unknown");
});

test("a stage the page holds no set for is missing rather than skipped", () => {
  const ledger = ticketLedger(
    ledgerPage([
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
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Missing",
    "2 Failed 3",
  ]);
});

test("a stage is labelled from one, and past the program without a total", () => {
  expect(stageLabel(1, 2)).toBe("Stage 1 of 2");
  expect(stageLabel(2, 2)).toBe("Stage 2 of 2");
  expect(stageLabel(3, 2)).toBe("Stage 3");
});

test("a cycle is labelled by its own ordinal", () => {
  expect(cycleLabel(3)).toBe("Cycle 3");
});

test("a container the fabric relaunched is labelled, and one it did not is not", () => {
  expect(retriesLabel(3)).toBe("Relaunched 3× by fabric");
  expect(retriesLabel(0)).toBeUndefined();
});

test("a stage number in the millions draws rows, not that many rows", () => {
  const beyond = 5_000_000;
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        identity: evalIdentity(1, beyond, 1),
        outcome: "Failed",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Missing",
    "2 Missing",
    `${String(beyond)} Failed 1`,
  ]);
});

test("a stage past the authored program is still given a row", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Passed",
      },
      {
        execution: "execution-cc-3",
        task: 3,
        identity: evalIdentity(1, 2, 1),
        outcome: "Failed",
      },
    ]),
    singleStage,
  );
  expect(stagesOf(ledger.cycles[0]?.stages ?? [])).toEqual([
    "1 Passed 2",
    "2 Failed 3",
  ]);
});

test("the last stage's verdict is what cycleLastSet and the wall it fed report", () => {
  const cycle = cycleAt(ticket21Parked, 1);
  expect(cycleLastSet(cycle)).toEqual({
    taskKind: "Evaluation",
    stage: 2,
    verdict: "Failed",
  });
});
