/**
 * That the executions of a ticket come back as the cycles that produced them.
 *
 * The failure this catches is the one a real operator hit: a stage-0 pass from
 * a superseded artifact drawn beside a stage-0 failure of the current one, with
 * nothing saying they judged different things. Every case below drives the page
 * in the order the route sends it, which is by identity and so unrelated to
 * time.
 */

import { expect, test } from "vitest";

import type { Cycle, ProgramRun, TaskSet } from "../app/core/ticketLedger.ts";
import {
  cycleLabel,
  retriesLabel,
  stageLabel,
  ticketLedger,
} from "../app/core/ticketLedger.ts";
import {
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  ticket21Resumed,
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
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
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

test("the work runs are ordered by task and not by the identity the route sorts on", () => {
  const ledger = ticketLedger(ledgerPage(ticket21Parked), ticket21Authoring);
  const evaluated = ledger.cycles.flatMap((cycle) =>
    cycle.programRuns.flatMap((run) => stagesOf(run)),
  );
  expect(evaluated).toEqual([
    "0 Failed 2",
    "1 Skipped",
    "0 Passed 4",
    "1 Failed 5",
    "0 Failed 7",
    "1 Skipped",
  ]);
});

test("a stage that failed short-circuits the stages after it", () => {
  expect(stagesOf(cycleAt(ticket21Parked, 0).programRuns[0])).toEqual([
    "0 Failed 2",
    "1 Skipped",
  ]);
});

test("the pass and the failure of one artifact stay in one program run", () => {
  const cycle = cycleAt(ticket21Parked, 1);
  expect(cycle.programRuns).toHaveLength(1);
  expect(stagesOf(cycle.programRuns[0])).toEqual(["0 Passed 4", "1 Failed 5"]);
});

test("a resume starts a second program run against the same artifact", () => {
  const cycle = cycleAt(ticket21Resumed, 2);
  expect(cycle.programRuns.map((run) => run.ordinal)).toEqual([1, 2]);
  expect(stagesOf(cycle.programRuns[0])).toEqual(["0 Failed 7", "1 Skipped"]);
  expect(stagesOf(cycle.programRuns[1])).toEqual(["0 Running 8", "1 Queued"]);
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
        taskKind: "Work",
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
        taskKind: "Work",
        status: "Running",
      },
    ],
    0,
  );
  expect(cycle.work?.verdict).toBe("Running");
  expect(cycle.artifact).toBe("None");
});

test("one spawn of many tasks is one set, and two spawns of one stage are two runs", () => {
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
      {
        execution: "execution-bb-3",
        task: 3,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Failed",
      },
      {
        execution: "execution-cc-4",
        task: 4,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
      },
      {
        execution: "execution-cc-5",
        task: 5,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
      },
    ]),
    { ...singleStage, program: [{ fanout: 2, combinator: "UnanimousPass" }] },
  );
  const runs = fanned.cycles[0]?.programRuns ?? [];
  expect(runs.map((run) => stagesOf(run))).toEqual([
    ["0 Failed 2,3"],
    ["0 Passed 4,5"],
  ]);
});

test("a stage's combinator decides its set, so any pass carries an AnyPass stage", () => {
  const anyPass = ticketLedger(
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
        outcome: "Failed",
      },
    ]),
    { ...singleStage, program: [{ fanout: 2, combinator: "AnyPass" }] },
  );
  expect(stagesOf(anyPass.cycles[0]?.programRuns[0])).toEqual(["0 Passed 1,2"]);
});

test("a cancelled set and a blocked one are each their own verdict", () => {
  const blocked = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        taskKind: "Work",
        status: "Cancelled",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Blocked",
      },
    ]),
    singleStage,
  );
  expect(blocked.cycles[0]?.work?.verdict).toBe("Cancelled");
  expect(stagesOf(blocked.cycles[0]?.programRuns[0])).toEqual(["0 Blocked 2"]);
});

test("a stage that was blocked skips the stages after it, as a failed one does", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Blocked",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Blocked 1",
    "1 Skipped",
  ]);
});

test("a stage that was cancelled skips the stages after it, as a failed one does", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        status: "Cancelled",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Cancelled 1",
    "1 Skipped",
  ]);
});

test("a stage that is still running leaves the stages after it queued", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        status: "Running",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Running 1",
    "1 Queued",
  ]);
});

test("two stages of one spawn stem are two sets, not one merged set", () => {
  const ledger = ticketLedger(
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
        stage: 1,
        outcome: "Failed",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Passed 1",
    "1 Failed 2",
  ]);
});

test("a request the wire names groups a set over stems that disagree", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
        request: "one-spawn",
      },
      {
        execution: "execution-zz-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Failed",
        request: "one-spawn",
      },
    ]),
    { ...singleStage, program: [{ fanout: 2, combinator: "UnanimousPass" }] },
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual(["0 Failed 1,2"]);
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
    singleStage,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual(["0 Passed 2"]);
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

test("a page cut before a cycle's work run says the artifact is unknown", () => {
  const cycle = cycleAt(
    [
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
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
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Missing",
    "1 Failed 3",
  ]);
});

test("a stage is labelled from one, and past the program without a total", () => {
  expect(stageLabel(0, 2)).toBe("Stage 1 of 2");
  expect(stageLabel(1, 2)).toBe("Stage 2 of 2");
  expect(stageLabel(2, 2)).toBe("Stage 3");
});

test("a cycle is labelled by its own ordinal", () => {
  expect(cycleLabel(3)).toBe("Cycle 3");
});

test("a container the fabric relaunched is labelled, and one it did not is not", () => {
  expect(retriesLabel(3)).toBe("Relaunched 3×");
  expect(retriesLabel(0)).toBeUndefined();
});

test("a stage number in the millions draws rows, not that many rows", () => {
  const beyond = 5_000_000;
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-1",
        task: 1,
        taskKind: "Evaluation",
        stage: beyond,
        outcome: "Failed",
      },
    ]),
    ticket21Authoring,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Missing",
    "1 Missing",
    `${String(beyond)} Failed 1`,
  ]);
});

test("a stage past the authored program is still given a row", () => {
  const ledger = ticketLedger(
    ledgerPage([
      {
        execution: "execution-bb-2",
        task: 2,
        taskKind: "Evaluation",
        stage: 0,
        outcome: "Passed",
      },
      {
        execution: "execution-cc-3",
        task: 3,
        taskKind: "Evaluation",
        stage: 1,
        outcome: "Failed",
      },
    ]),
    singleStage,
  );
  expect(stagesOf(ledger.cycles[0]?.programRuns[0])).toEqual([
    "0 Passed 2",
    "1 Failed 3",
  ]);
});
