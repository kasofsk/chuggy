/**
 * The universes a deployment's constants generate, and the release refusals
 * they are.
 *
 * The model states each of these as a SET a release draws from, so an
 * ill-formed program, an out-of-universe id or a policy nobody granted cannot
 * enter a reachable state — the refusal is structural rather than a guard a
 * decider carries. Here the same rule is a predicate at the boundary, and what
 * a suite can pin is that it refuses exactly what the set excludes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boundsOf,
  defaultProgram,
  finalizationPricingChoices,
  finalizerChoices,
  isValidProgram,
  resumePricingChoices,
  reworkPolicyChoices,
  stageChoices,
  ticketIdUniverse,
  workFanoutChoices,
} from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import { budgetedInstance, deadlineOnlyInstance } from "./configs.ts";

const config = budgetedInstance;

test("the default program is one unanimous stage at full fan-out, and it is authorable", () => {
  assert.deepEqual(defaultProgram(config), [
    { fanout: config.nTasks, combinator: "UnanimousPass" },
  ]);
  assert.ok(isValidProgram(config, defaultProgram(config)));
});

test("the program rule refuses exactly what a release may not carry", () => {
  assert.ok(
    !isValidProgram(config, []),
    "an empty program authors a ticket that can never pass evaluation",
  );
  assert.ok(!isValidProgram(config, [{ fanout: 0, combinator: "AnyPass" }]));
  assert.ok(
    !isValidProgram(config, [
      { fanout: config.nTasks + 1, combinator: "UnanimousPass" },
    ]),
  );
  const overlong = Array.from({ length: config.maxStages + 1 }, () => ({
    fanout: 1,
    combinator: "UnanimousPass" as const,
  }));
  assert.ok(!isValidProgram(config, overlong));
});

test("a program of stages the vocabulary offers is authorable at any length within the bound", () => {
  const staged = [
    { fanout: 1, combinator: "UnanimousPass" as const },
    { fanout: config.nTasks, combinator: "AnyPass" as const },
  ];
  assert.equal(staged.length, config.maxStages);
  assert.ok(isValidProgram(config, staged));
  assert.ok(
    staged.every((stage) =>
      stageChoices(config).some(
        (choice) =>
          choice.fanout === stage.fanout &&
          choice.combinator === stage.combinator,
      ),
    ),
    "an authorable program is built from the vocabulary the release draws from",
  );
});

test("the stage vocabulary is every fan-out in range against both combinators", () => {
  const choices = stageChoices(config);
  assert.equal(choices.length, config.nTasks * 2);
  assert.deepEqual(choices, [
    { fanout: 1, combinator: "UnanimousPass" },
    { fanout: 1, combinator: "AnyPass" },
    { fanout: 2, combinator: "UnanimousPass" },
    { fanout: 2, combinator: "AnyPass" },
  ]);
});

test("the id universe is deliberately wider than the fleet bound, which is what makes ids sparse", () => {
  const universe = ticketIdUniverse(config);
  assert.deepEqual(universe, [1, 2, 3, 4, 5, 6].map(asTicketId));
  assert.ok(
    universe.length > config.nTickets,
    "a fleet at its bound still leaves ids unclaimed, so a release may draw a gap",
  );
});

test("the work-set widths a release may author run from one to the task ceiling", () => {
  assert.deepEqual(workFanoutChoices(config), [1, 2]);
  assert.ok(
    !workFanoutChoices(config).includes(0),
    "a zero-width work set is a cycle that resolves without doing anything",
  );
});

test("a ticket may be authored poorer than its fleet but never richer", () => {
  assert.deepEqual(reworkPolicyChoices(config), [
    reworkBudgetOf(0),
    reworkBudgetOf(1),
  ]);
  assert.deepEqual(finalizationPricingChoices(config), [
    "DeadlineOnly",
    budgeted(0),
    budgeted(1),
  ]);
  assert.deepEqual(
    finalizationPricingChoices(deadlineOnlyInstance),
    ["DeadlineOnly", budgeted(0)],
    "the unbudgeted instance still offers the budgeted branch at the only size it grants",
  );
});

test("both finish kinds and both resume pricings are always drawable", () => {
  assert.deepEqual(finalizerChoices, ["NoFinalizer", "ManagedFinalizer"]);
  assert.deepEqual(resumePricingChoices, ["RetryCharged", "RetryFree"]);
});

test("the bounds carry what the measure reads and nothing else", () => {
  assert.deepEqual(boundsOf(config), {
    reworkPolicy: config.reworkPolicy,
    nTasks: config.nTasks,
    maxStages: config.maxStages,
    finalizationPricing: config.finalizationPricing,
  });
});
