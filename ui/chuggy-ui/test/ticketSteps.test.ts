/**
 * The Overview's steps block over the current cycle: three phase columns
 * every ticket has, the evaluation one a box per stage of the plan in its
 * order, each box marked and saying how long it ran or what will run, and
 * each column's edge toned once it has run.
 */

import { expect, test } from "vitest";

import { ticketLandingOf } from "../app/core/ticketLandings.ts";
import type { TicketLanding } from "../app/core/ticketLandings.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import type { TicketPlan } from "../app/core/ticketPlan.ts";
import { ticketStepsOf } from "../app/core/ticketSteps.ts";
import type { TicketSteps } from "../app/core/ticketSteps.ts";
import { landingConflicted, landingLanded } from "./ticketLandingsFixture.ts";
import {
  evalIdentity,
  ledgerPage,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

const program = [
  { key: 1, evaluators: [{ key: 1 }] },
  { key: 2, evaluators: [{ key: 1 }, { key: 2 }] },
];

/** Checks, then a review run by two evaluators side by side, landing by a
 * pull request it merges. */
const plan: TicketPlan = {
  work: "Claude · Opus",
  stages: [
    {
      stage: 1,
      name: "checks",
      evaluators: [{ key: 1, name: "ci", runs: "ci · commands" }],
    },
    {
      stage: 2,
      name: "review",
      evaluators: [
        { key: 1, name: "review", runs: "review · Claude · Opus" },
        { key: 2, name: "security", runs: "security · Claude" },
      ],
    },
  ],
  names: ["checks", "review"],
  lands: true,
  landing: { id: "codes-merge-mode-pull-request" },
};

function stepsOf(
  shapes: readonly ExecutionShape[],
  over: {
    readonly plan?: TicketPlan;
    readonly landings?: readonly TicketLanding[];
    readonly settled?: boolean;
  } = {},
): TicketSteps {
  const ledger = ticketLedger(ledgerPage(shapes), program);
  const landings = new Map<number, readonly TicketLanding[]>();
  for (const landing of over.landings ?? [])
    landings.set(landing.cycle, [
      ...(landings.get(landing.cycle) ?? []),
      landing,
    ]);
  return ticketStepsOf(
    {
      ledger,
      plan: over.plan ?? plan,
      landings,
      settled: over.settled ?? false,
      nowMs: Date.parse("2026-08-26T12:00:00Z"),
    },
    copyTextEn,
  );
}

/** Each column as its phase, its edge, and each box's name, mark and line. */
function said(steps: TicketSteps) {
  return steps.columns.map((column) => [
    column.phase,
    column.edge,
    column.boxes.map((box) => [
      box.name,
      box.mark,
      box.line.line === "Words"
        ? box.line.words
        : box.line.live
          ? "running"
          : "ran",
    ]),
  ]);
}

const cycleOne: readonly ExecutionShape[] = [
  { execution: "e-1", task: 1, identity: workIdentity(1), outcome: "Passed" },
  {
    execution: "e-2",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Passed",
  },
  {
    execution: "e-3",
    task: 3,
    identity: evalIdentity(1, 2, 1, 1),
    outcome: "Failed",
  },
  {
    execution: "e-4",
    task: 4,
    identity: evalIdentity(1, 2, 1, 2),
    outcome: "Passed",
  },
];

const cycleTwoReviewing: readonly ExecutionShape[] = [
  ...cycleOne,
  { execution: "e-5", task: 5, identity: workIdentity(2), outcome: "Passed" },
  {
    execution: "e-6",
    task: 6,
    identity: evalIdentity(2, 1, 1),
    outcome: "Passed",
  },
  {
    execution: "e-7",
    task: 7,
    identity: evalIdentity(2, 2, 1, 1),
    status: "Running",
  },
  {
    execution: "e-8",
    task: 8,
    identity: evalIdentity(2, 2, 1, 2),
    outcome: "Passed",
  },
];

test("before the first run every ticket's three phases say what will run, the plan's stages in its order", () => {
  const steps = stepsOf([]);
  expect(steps.cycle).toBeUndefined();
  expect(steps.previous).toBeUndefined();
  expect(said(steps)).toEqual([
    ["Work", undefined, [["Work", "Open", "Claude · Opus"]]],
    [
      "Evaluation",
      undefined,
      [
        ["checks", "Open", "ci · commands"],
        ["review", "Open", "2 side by side"],
      ],
    ],
    [
      "Finalization",
      undefined,
      [["Landing", "Open", "Pull request, then merge"]],
    ],
  ]);
  expect(
    steps.columns[1]?.boxes[1]?.evaluators.map((evaluator) => evaluator.name),
  ).toEqual(["review", "security"]);
});

test("the current cycle is headed by its number and the cycle before it, each run its box's page", () => {
  const steps = stepsOf(cycleTwoReviewing);
  expect(steps.cycle).toBe(2);
  expect(steps.previous).toBe("Cycle 1 sent back by review");
  expect(said(steps)).toEqual([
    ["Work", "live", [["Work", "Check", "ran"]]],
    [
      "Evaluation",
      "evaluation",
      [
        ["checks", "Check", "ran"],
        ["review", "Spin", "2 side by side"],
      ],
    ],
    [
      "Finalization",
      undefined,
      [["Landing", "Open", "Pull request, then merge"]],
    ],
  ]);
  expect(steps.columns[0]?.boxes[0]?.address).toEqual({ to: "Run", task: 5 });
  expect(steps.columns[1]?.boxes[0]?.address).toEqual({ to: "Run", task: 6 });
});

test("a stage of several evaluators lists each with its own mark and page inside its one box", () => {
  const review = stepsOf(cycleTwoReviewing).columns[1]?.boxes[1];
  expect(review?.address).toBeUndefined();
  expect(
    review?.evaluators.map((evaluator) => [
      evaluator.name,
      evaluator.mark,
      evaluator.address,
    ]),
  ).toEqual([
    ["review", "Spin", { to: "Run", task: 7 }],
    ["security", "Check", { to: "Run", task: 8 }],
  ]);
});

test("a cycle that stopped at a failure parks its column, and what it never reached says so", () => {
  const steps = stepsOf(cycleOne, { settled: true });
  expect(steps.previous).toBeUndefined();
  expect(steps.columns.map((column) => column.edge)).toEqual([
    "live",
    "parked",
    undefined,
  ]);
  expect(said(steps)[2]).toEqual([
    "Finalization",
    undefined,
    [["Landing", "Open", "Not reached"]],
  ]);
});

test("a ticket that lands nothing has a Landing with no mark, no page and no wait", () => {
  const box = stepsOf(cycleOne, { plan: { ...plan, lands: false } }).columns[2]
    ?.boxes[0];
  expect(box).toMatchObject({
    name: "Landing",
    mark: undefined,
    line: { line: "Words", words: "None" },
    address: undefined,
  });
});

test("a landing that failed draws its failure and parks its column; one that merged names its pull request", () => {
  const passed = cycleOne.map((shape) =>
    shape.task === 3 ? { ...shape, outcome: "Passed" as const } : shape,
  );
  const failed = stepsOf(passed, {
    landings: [ticketLandingOf(landingConflicted(1), copyTextEn)],
  });
  expect(failed.columns[2]?.edge).toBe("parked");
  expect(failed.columns[2]?.boxes[0]).toMatchObject({
    mark: "Cross",
    tone: "fail",
    line: { words: "Merge conflict" },
    address: { to: "Landing" },
  });
  const merged = stepsOf(passed, {
    landings: [
      ticketLandingOf(landingConflicted(1), copyTextEn),
      ticketLandingOf(landingLanded(1), copyTextEn),
    ],
  });
  expect(merged.columns[2]?.edge).toBe("finalization");
  expect(merged.columns[2]?.boxes[0]).toMatchObject({
    mark: "Merge",
    tone: "finalization",
    line: { words: "PR #68" },
  });
});

test("a configuration that names no stages names each by its number", () => {
  const unnamed: TicketPlan = {
    ...plan,
    names: undefined,
    stages: plan.stages.map((stage) => ({
      ...stage,
      name: `Stage ${String(stage.stage)}`,
    })),
  };
  const steps = stepsOf(cycleTwoReviewing, { plan: unnamed });
  expect(steps.previous).toBe("Cycle 1 sent back by Stage 2");
  expect(steps.columns[1]?.boxes.map((box) => box.name)).toEqual([
    "Stage 1",
    "Stage 2",
  ]);
});
