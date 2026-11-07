/**
 * What a ticket will run, as its configuration and its release say: each
 * stage named as the selected plan writes it, each step said as what runs it,
 * and whether the ticket lands anything at all.
 */

import { expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import { ticketPlanOf } from "../app/core/ticketPlan.ts";
import { ticketInstants } from "./ticketInstants.ts";

/** A catalog whose default plan names two stages, the second of two
 * evaluators, and a second plan of one stage. */
const catalog = JSON.stringify({
  version: 2,
  workloads: {
    build: {
      runner: "Agent",
      worker: { mode: { agent: "Claude", arguments: ["--model=opus"] } },
    },
    ci: { runner: "Commands", commands: ["npm test"] },
    review: {
      runner: "Agent",
      worker: { mode: { agent: "Claude", arguments: ["--model=opus"] } },
    },
    security: { runner: "Agent", worker: { mode: { agent: "Claude" } } },
  },
  plans: {
    standard: [
      { name: "checks", evaluators: ["ci"] },
      { name: "review", evaluators: ["review", "security"] },
    ],
    quick: [{ name: "review", evaluators: ["review"] }],
  },
  finalizers: {
    merge: { landing: { mode: "PullRequestMerge" } },
    none: { landing: { mode: "None" } },
  },
  defaults: { work: "build", evaluation: "standard", finalization: "merge" },
});

function ticket(over: Partial<TicketResponse> = {}): TicketResponse {
  return {
    ticket: 335,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    ...over,
  };
}

test("a catalog's selected plan names each stage, and each step says what runs it", () => {
  const plan = ticketPlanOf(catalog, ticket());
  expect(plan.names).toEqual(["checks", "review"]);
  expect(plan.work).toBe("Claude · Opus");
  expect(
    plan.stages.map((stage) => [
      stage.name,
      stage.evaluators.map((evaluator) => evaluator.runs),
    ]),
  ).toEqual([
    ["checks", ["ci · commands"]],
    ["review", ["review · Claude · Opus", "security · Claude"]],
  ]);
  expect(plan.landing).toBe("Pull request, then merge");
  expect(plan.lands).toBe(true);
  expect(
    ticketPlanOf(catalog, ticket({ selection: { evaluation: "quick" } })).names,
  ).toEqual(["review"]);
});

test("the stages are the program the ticket was released with, named by position", () => {
  const plan = ticketPlanOf(
    catalog,
    ticket({ program: [{ key: 1, evaluators: [{ key: 1 }] }] }),
  );
  expect(plan.stages.map((stage) => stage.name)).toEqual(["checks"]);
});

test("a version 1 configuration, or one not read, names its stages and evaluators by number", () => {
  const program = [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }];
  for (const canonical of [JSON.stringify({ version: 1 }), undefined]) {
    const plan = ticketPlanOf(canonical, ticket({ program }));
    expect(plan.names).toBeUndefined();
    expect(plan.work).toBeUndefined();
    expect(plan.stages).toEqual([
      {
        stage: 1,
        name: "Stage 1",
        evaluators: [
          { key: 1, name: "Evaluator 1", runs: undefined },
          { key: 2, name: "Evaluator 2", runs: undefined },
        ],
      },
    ]);
  }
});

test("the brief's landing comes before the finalizer's, and one that lands nothing lands nothing", () => {
  const brief = { intent: "Lock the contract", links: [] };
  expect(
    ticketPlanOf(
      catalog,
      ticket({ brief: { ...brief, finalization: { kind: "None" } } }),
    ),
  ).toMatchObject({ lands: false, landing: "None" });
  expect(
    ticketPlanOf(catalog, ticket({ selection: { finalization: "none" } })),
  ).toMatchObject({ lands: false });
  expect(
    ticketPlanOf(
      catalog,
      ticket({
        brief: { ...brief, finalization: { kind: "PullRequest" } },
        selection: { finalization: "none" },
      }),
    ),
  ).toMatchObject({ lands: true, landing: "Pull request" });
  expect(ticketPlanOf(undefined, ticket())).toMatchObject({
    lands: true,
    landing: undefined,
  });
});
