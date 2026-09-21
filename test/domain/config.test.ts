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
  isValidProgram,
  stageChoices,
  ticketIdUniverse,
  workFanoutChoices,
} from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { modelInstance } from "./configs.ts";

const config = modelInstance;

test("the default program is one stage at full fan-out, and it is authorable", () => {
  assert.deepEqual(defaultProgram(config), [{ fanout: config.nTasks }]);
  assert.ok(isValidProgram(config, defaultProgram(config)));
});

test("the program rule refuses exactly what a release may not carry", () => {
  assert.ok(
    !isValidProgram(config, []),
    "an empty program authors a ticket that can never pass evaluation",
  );
  assert.ok(!isValidProgram(config, [{ fanout: 0 }]));
  assert.ok(!isValidProgram(config, [{ fanout: config.nTasks + 1 }]));
  const overlong = Array.from({ length: config.maxStages + 1 }, () => ({
    fanout: 1,
  }));
  assert.ok(!isValidProgram(config, overlong));
});

test("a program of stages the vocabulary offers is authorable at any length within the bound", () => {
  const staged = [{ fanout: 1 }, { fanout: config.nTasks }];
  assert.equal(staged.length, config.maxStages);
  assert.ok(isValidProgram(config, staged));
  assert.ok(
    staged.every((stage) =>
      stageChoices(config).some((choice) => choice.fanout === stage.fanout),
    ),
    "an authorable program is built from the vocabulary the release draws from",
  );
});

test("the stage vocabulary is every fan-out in range", () => {
  const choices = stageChoices(config);
  assert.equal(choices.length, config.nTasks);
  assert.deepEqual(choices, [{ fanout: 1 }, { fanout: 2 }]);
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
