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

import type { Cycle, ProgramRun, TaskSet } from "../app/core/ticketLedger.ts";
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

/** Each stage row of a run as its kind and the tasks it ran, in stage order. */
function stagesOf(run: ProgramRun | undefined): readonly string[] {
  return (run?.stages ?? []).map((row) =>
    row.kind === "Ran"
      ? `${String(row.stage)} ${row.set.verdict} ${tasksOf(row.set).join(",")}`
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
  program: [{ fanout: 1 }],
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
  const evaluated = ledger.cycles.flatMap((cycle) =>
    cycle.programRuns.flatMap((run) => stagesOf(run)),
  );
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
  expect(stagesOf(cycleAt(ticket21Parked, 0).programRuns[0])).toEqual([
    "1 Failed 2",
    "2 Skipped",
  ]);
});

test("the pass and the failure of one artifact stay in one program run", () => {
  const cycle = cycleAt(ticket21Parked, 1);
  expect(cycle.programRuns).toHaveLength(1);
  expect(stagesOf(cycle.programRuns[0])).toEqual(["1 Passed 4", "2 Failed 5"]);
});

test("a resume starts a second program run against the same artifact", () => {
  const cycle = cycleAt(ticket21Resumed, 2);
  expect(cycle.programRuns.map((run) => run.ordinal)).toEqual([1, 2]);
  expect(stagesOf(cycle.programRuns[0])).toEqual(["1 Failed 7", "2 Skipped"]);
  expect(stagesOf(cycle.programRuns[1])).toEqual(["1 Running 8", "2 Queued"]);
});

test("a stage first reached after a resume belongs to the run that resumed", () => {
  const cycle = cycleAt(
    [
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
        outcome: "Blocked",
      },
      {
        execution: "execution-cc-3",
        task: 3,
        identity: evalIdentity(1, 1, 2),
        outcome: "Passed",
      },
      {
        execution: "execution-dd-4",
        task: 4,
        identity: evalIdentity(1, 2, 1),
        outcome: "Passed",
      },
    ],
    0,
  );
  expect(cycle.programRuns.map((run) => [run.ordinal, run.standing])).toEqual([
    [1, "Superseded"],
    [2, "Current"],
  ]);
  expect(stagesOf(cycle.programRuns[0])).toEqual(["1 Blocked 2", "2 Skipped"]);
  expect(stagesOf(cycle.programRuns[1])).toEqual(["1 Passed 3", "2 Passed 4"]);
  expect(cycleLastSet(cycle)).toEqual({
    taskKind: "Evaluation",
    stage: 2,
    verdict: "Passed",
  });
  expect(cycle.complete).toBe(true);
});

test("only the last cycle and the last run of it stand as current", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Resumed), ticket21Authoring);
  expect(ledger.cycles.map((cycle) => cycle.standing)).toEqual([
    "Superseded",
    "Superseded",
    "Current",
  ]);
  const runs = ledger.cycles[2]?.programRuns ?? [];
  expect(runs.map((run) => run.standing)).toEqual(["Superseded", "Current"]);
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
  expect(failed.programRuns).toEqual([]);
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

test("one spawn of many tasks is one set, and two generations of one stage are two runs", () => {
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
        identity: evalIdentity(1, 1, 1, 1),
        outcome: "Passed",
      },
      {
        execution: "execution-bb-3",
        task: 3,
        identity: evalIdentity(1, 1, 1, 2),
        outcome: "Failed",
      },
      {
        execution: "execution-cc-4",
        task: 4,
        identity: evalIdentity(1, 1, 2, 1),
        outcome: "Passed",
      },
      {
        execution: "execution-cc-5",
        task: 5,
        identity: evalIdentity(1, 1, 2, 2),
        outcome: "Passed",
      },
    ]),
    { ...singleStage, program: [{ fanout: 2 }] },
  );
  const runs = fanned.cycles[0]?.programRuns ?? [];
  expect(runs.map((run) => stagesOf(run))).toEqual([
    ["1 Failed 2,3"],
    ["1 Passed 4,5"],
  ]);
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
  expect(stagesOf(blocked.cycles[0]?.programRuns[0])).toEqual(["1 Blocked 2"]);
});

test("a stage that was blocked skips the stages after it, as a failed one does", () => {
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "1 Blocked 1",
    "2 Skipped",
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "1 Running 1",
    "2 Queued",
  ]);
});

test("two stages of one generation are two sets, not one merged set", () => {
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual(["1 Passed 2"]);
});

test("a set is drawn against the fan-out its stage was authored with", () => {
  const cycle = cycleAt(ticket21Parked, 0);
  expect(cycle.work?.expected).toBe(1);
  const run = cycle.programRuns[0]?.stages[0];
  expect(run?.kind === "Ran" ? run.set.expected : undefined).toBe(1);
});

test("a single-stage program draws one row per run and no stage after it", () => {
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual(["1 Passed 2"]);
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
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
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "1 Passed 2",
    "2 Failed 3",
  ]);
});
