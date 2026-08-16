/**
 * The universes a deployment's constants generate, and the arrival refusals
 * they are.
 *
 * The model states each of these as a SET an arrival draws from, so an
 * ill-formed program, an out-of-universe project or a lease on a resource
 * nobody declared cannot enter a reachable state — the refusal is structural
 * rather than a guard a decider carries. Here the same rule is a predicate at
 * the boundary, and what a suite can pin is that it refuses exactly what the
 * set excludes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boundsOf,
  defaultProgram,
  isValidProgram,
  projects,
  stageChoices,
  wrapUpChoices,
} from "../../src/domain/config.ts";
import { wExclusive, wNone } from "../../src/domain/wrapUp.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import { budgetedInstance } from "./configs.ts";

const config = budgetedInstance;

test("the default program is one unanimous stage at full fan-out, and it is authorable", () => {
  assert.deepEqual(defaultProgram(config), [
    { fanout: config.nTasks, combinator: "CUnanimousPass" },
  ]);
  assert.ok(isValidProgram(config, defaultProgram(config)));
});

test("the program rule refuses exactly what an arrival may not carry", () => {
  assert.ok(
    !isValidProgram(config, []),
    "an empty program authors a ticket that can never pass evaluation",
  );
  assert.ok(!isValidProgram(config, [{ fanout: 0, combinator: "CAnyPass" }]));
  assert.ok(
    !isValidProgram(config, [
      { fanout: config.nTasks + 1, combinator: "CUnanimousPass" },
    ]),
  );
  const overlong = Array.from({ length: config.maxStages + 1 }, () => ({
    fanout: 1,
    combinator: "CUnanimousPass" as const,
  }));
  assert.ok(!isValidProgram(config, overlong));
});

test("a program of stages the vocabulary offers is authorable at any length within the bound", () => {
  const staged = [
    { fanout: 1, combinator: "CUnanimousPass" as const },
    { fanout: config.nTasks, combinator: "CAnyPass" as const },
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
    "an authorable program is built from the vocabulary the arrival draws from",
  );
});

test("the stage vocabulary is every fan-out in range against both combinators", () => {
  const choices = stageChoices(config);
  assert.equal(choices.length, config.nTasks * 2);
  assert.deepEqual(choices, [
    { fanout: 1, combinator: "CUnanimousPass" },
    { fanout: 1, combinator: "CAnyPass" },
    { fanout: 2, combinator: "CUnanimousPass" },
    { fanout: 2, combinator: "CAnyPass" },
  ]);
});

test("the wrap-up choices are the no-lease kind plus one lease per project", () => {
  assert.deepEqual(wrapUpChoices(config), [
    wNone,
    wExclusive(1),
    wExclusive(2),
  ]);
});

test("the project universe collapses to a constant under a single-project deployment", () => {
  const solo = { ...config, nProjects: 1 };
  assert.deepEqual(projects(solo), [asProjectId(1)]);
  assert.deepEqual(wrapUpChoices(solo), [wNone, wExclusive(1)]);
  assert.deepEqual(projects(config), [asProjectId(1), asProjectId(2)]);
});

test("the bounds carry what the measure reads and nothing else", () => {
  assert.deepEqual(boundsOf(config), {
    reworkPolicy: config.reworkPolicy,
    nTasks: config.nTasks,
    maxStages: config.maxStages,
    wrapUpPricing: config.wrapUpPricing,
  });
});
