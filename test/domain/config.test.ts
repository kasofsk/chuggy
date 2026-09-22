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
  defaultProgram,
  everyEvaluator,
  isValidProgram,
  stageChoices,
  ticketIdUniverse,
} from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { modelInstance } from "./configs.ts";

const config = modelInstance;

test("the default program is one stage listing every evaluator the bound allows, and it is authorable", () => {
  assert.deepEqual(defaultProgram(config), [
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
  ]);
  assert.ok(isValidProgram(config, defaultProgram(config)));
});

test("the program rule refuses exactly what a release may not carry", () => {
  assert.ok(
    !isValidProgram(config, []),
    "an empty program authors a ticket that can never pass evaluation",
  );
  assert.ok(
    !isValidProgram(config, [{ key: 1, evaluators: [] }]),
    "a stage listing no evaluator runs nothing and can never pass",
  );
  assert.ok(
    !isValidProgram(config, [
      { key: 1, evaluators: [{ key: config.nTasks + 1 }] },
    ]),
    "an evaluator key past the bound",
  );
  assert.ok(
    !isValidProgram(config, [{ key: 1, evaluators: [{ key: 0 }] }]),
    "an evaluator key below one",
  );
  assert.ok(
    !isValidProgram(config, [{ key: 1, evaluators: [{ key: 1 }, { key: 1 }] }]),
    "a stage names each evaluator once",
  );
  assert.ok(
    !isValidProgram(config, [{ key: 2, evaluators: [{ key: 1 }] }]),
    "a stage's key is its position",
  );
  const overlong = Array.from({ length: config.maxStages + 1 }, (_u, i) => ({
    key: i + 1,
    evaluators: [{ key: 1 }],
  }));
  assert.ok(!isValidProgram(config, overlong));
});

test("a sparse roster is authorable: the keys are names, not positions", () => {
  assert.ok(isValidProgram(config, [{ key: 1, evaluators: [{ key: 2 }] }]));
});

test("a program of rosters the vocabulary offers is authorable at any length within the bound", () => {
  const staged = [
    { key: 1, evaluators: [{ key: 1 }] },
    { key: 2, evaluators: everyEvaluator(config) },
  ];
  assert.equal(staged.length, config.maxStages);
  assert.ok(isValidProgram(config, staged));
  assert.ok(
    staged.every((stage) =>
      stageChoices(config).some(
        (roster) =>
          roster.length === stage.evaluators.length &&
          roster.every((entry, i) => entry.key === stage.evaluators[i]?.key),
      ),
    ),
    "an authorable program is built from the vocabulary the release draws from",
  );
});

test("the stage vocabulary is every non-empty ascending roster of keys within the bound", () => {
  assert.deepEqual(stageChoices(config), [
    [{ key: 1 }],
    [{ key: 2 }],
    [{ key: 1 }, { key: 2 }],
  ]);
  assert.deepEqual(everyEvaluator(config), [{ key: 1 }, { key: 2 }]);
});

test("the id universe is deliberately wider than the fleet bound, which is what makes ids sparse", () => {
  const universe = ticketIdUniverse(config);
  assert.deepEqual(universe, [1, 2, 3, 4, 5, 6].map(asTicketId));
  assert.ok(
    universe.length > config.nTickets,
    "a fleet at its bound still leaves ids unclaimed, so a release may draw a gap",
  );
});
