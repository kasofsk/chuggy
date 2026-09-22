/**
 * The randomized layer's own evidence: the roster held against the model, the
 * init refusal the model states as a validity condition, seed purity, the
 * accumulator's red side, and the seeded walk over the three full-roster
 * instances of `model/mc/mc_chuggy.qnt`.
 *
 * THE WALK HERE IS THE BOUNDED DEFAULT; `.chug/tasks/check-random.sh` runs this
 * same suite at the sample count the model gate's randomized stage uses, so the
 * depth of a run is the caller's and the samples consumed are counted into a
 * tally the gate's clean line reports. `CHUG_WALK_SEED` with
 * `CHUG_WALK_INSTANCE` reproduces one named run, which is what a failure
 * message tells a reader to do.
 *
 * WHAT A GREEN WALK MEANS is bounded the way the model gate's randomized stage
 * is bounded: sampled evidence, not a proof. What it adds over the conformance
 * replay is states no golden recorded — the deciders steered by the enablement
 * predicates rather than past them — and the one property no single state can
 * refute, exclusivity of the completion emission over the run.
 */

import type { StepRecord } from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "../../src/domain/config.ts";
import { isValidPlan, stageChoices } from "../../src/domain/config.ts";

import { declaredActions } from "../domain/declared.ts";
import { CONFIGS, modelInstance } from "../domain/configs.ts";
import { graphOf, id, ticketOn } from "../domain/fixtures.ts";
import {
  validPlansIn,
  walkActionOf,
  walkActions,
  type Drawn,
} from "./draws.ts";
import { counterexampleReport } from "./counterexample.ts";
import {
  completionFindings,
  creditCompletions,
  decideViaTable,
  walkInit,
  walkRun,
  walkStepsMax,
  type CompletionCounts,
} from "./walk.ts";

const ROOT = join(import.meta.dirname, "..", "..");

/** The instances the sweep walks, the ones the model gate runs. */
const INSTANCES = ["mc_chuggy"];

const samplesDefault = 25;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`walk: ${name}=${raw} is not a usable count`);
  }
  return value;
}

interface PlannedRun {
  readonly instance: string;
  readonly seed: number;
}

/**
 * Every run this invocation makes: one named run when `CHUG_WALK_SEED` and
 * `CHUG_WALK_INSTANCE` reproduce a failure, else the seeded sweep — sequential
 * seeds from the base, so the seed a message names is the seed a rerun sets.
 */
function plannedRuns(): readonly PlannedRun[] {
  const seedRaw = process.env["CHUG_WALK_SEED"];
  const instanceRaw = process.env["CHUG_WALK_INSTANCE"];
  if (seedRaw !== undefined || instanceRaw !== undefined) {
    if (seedRaw === undefined || instanceRaw === undefined) {
      throw new Error(
        "walk: CHUG_WALK_SEED and CHUG_WALK_INSTANCE reproduce one run and are set together",
      );
    }
    const seed = Number(seedRaw);
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error(`walk: CHUG_WALK_SEED=${seedRaw} is not a seed`);
    }
    return [{ instance: instanceRaw, seed }];
  }
  const samples = envInt("CHUG_WALK_SAMPLES", samplesDefault);
  const base = envInt("CHUG_WALK_SEED_BASE", 1);
  return INSTANCES.flatMap((instance) =>
    Array.from({ length: samples }, (_unused, index) => ({
      instance,
      seed: base + index,
    })),
  );
}

function configOf(instance: string): Config {
  const config = CONFIGS[instance];
  assert.ok(
    config,
    `${instance} has no configuration in test/domain/configs.ts`,
  );
  return config;
}

test("the walk's roster is the model's own action roster, in its order", () => {
  assert.deepEqual(
    walkActions.map((entry) => entry.action),
    [...declaredActions(ROOT)],
    "the walk and model/domain.qnt's step offer different actions",
  );
});

test("every init conjunct refuses as the model's init does, and a valid instance starts empty", () => {
  const invalid: readonly Partial<Config>[] = [
    { nTasks: 0 },
    { nTickets: 0 },
    { maxStages: 0 },
  ];
  for (const broken of invalid) {
    assert.throws(
      () => walkInit({ ...modelInstance, ...broken }),
      /no initial state/,
    );
  }
  assert.equal(walkInit(modelInstance).tickets.size, 0);
});

test("the release's plan draw ranges over exactly the well-formed set", () => {
  const plans = validPlansIn(modelInstance);
  const rosters = stageChoices(modelInstance).length;
  assert.equal(
    plans.length,
    rosters + rosters * rosters,
    "one stage or two, each drawn from the roster vocabulary, as the model folds validPlans",
  );
  assert.ok(plans.every((plan) => isValidPlan(modelInstance, plan)));
  assert.equal(
    new Set(plans.map((plan) => JSON.stringify(plan))).size,
    plans.length,
    "a duplicate would weight one plan over its siblings",
  );
});

test("the release's permit refuses the dependency named twice", () => {
  const graph = graphOf([ticketOn(modelInstance)]);
  const stages = validPlansIn(modelInstance)[0];
  assert.ok(stages);
  const drawn: Drawn = {
    ticket: id(2),
    dependencies: [id(1), id(1)],
    stages,
  };
  const release = walkActionOf("releaseTicket");
  assert.equal(release.permitsIn(modelInstance, graph, drawn), false);
  assert.equal(
    release.permitsIn(modelInstance, graph, {
      ...drawn,
      dependencies: [id(1)],
    }),
    true,
  );
});

test("a run is a pure function of its seed", () => {
  const first = walkRun(modelInstance, 7, walkStepsMax);
  const second = walkRun(modelInstance, 7, walkStepsMax);
  assert.deepEqual(first, second);
  assert.equal(first.steps.length, walkStepsMax);
});

test("the accumulator rebuilds the ghost and can go red in every direction", () => {
  const done = graphOf([
    ticketOn(modelInstance, {
      phase: "Done",
      artifact: { type: "ProducedArtifact", value: 1 },
      completions: 1,
    }),
  ]);
  const completeRec: StepRecord = {
    label: "ticket-done",
    transitions: [{ ticket: id(1), from: "Finalization", to: "Done" }],
    effects: [],
  };
  const counts: CompletionCounts = new Map();
  assert.deepEqual(creditCompletions(counts, id(1), completeRec), []);
  assert.deepEqual(completionFindings(counts, done), []);

  creditCompletions(counts, id(1), completeRec);
  assert.match(
    completionFindings(counts, done).join(" "),
    /2 completion\(s\) counted/,
    "a second completion for a completed ticket is the accumulator's whole reason",
  );

  const silent: CompletionCounts = new Map();
  assert.match(
    completionFindings(silent, done).join(" "),
    /0 completion\(s\) counted/,
    "a ticket Done with nothing counted is the other half of the iff",
  );

  const working = graphOf([ticketOn(modelInstance)]);
  const early: CompletionCounts = new Map();
  creditCompletions(early, id(1), completeRec);
  assert.match(completionFindings(early, working).join(" "), /phase Pending/);

  assert.match(
    creditCompletions(new Map(), undefined, completeRec).join(" "),
    /no drawn ticket/,
    "a completion with no stepped ticket has no subject and is its own finding",
  );
});

test("the model's instances hold the bundle and the accumulator under the seeded walk", () => {
  let runs = 0;
  let steps = 0;
  const walked = new Set<string>();
  for (const planned of plannedRuns()) {
    const config = configOf(planned.instance);
    const outcome = walkRun(config, planned.seed, walkStepsMax);
    runs++;
    steps += outcome.steps.length;
    walked.add(planned.instance);
    if (outcome.finding !== undefined) {
      assert.fail(
        counterexampleReport(
          config,
          planned.instance,
          planned.seed,
          outcome,
          decideViaTable,
          process.env["CHUG_WALK_DIR"],
        ),
      );
    }
  }
  const tally = process.env["CHUG_WALK_TALLY"];
  if (tally !== undefined && tally !== "") {
    writeFileSync(
      tally,
      `${JSON.stringify({ instances: walked.size, runs, steps })}\n`,
    );
  }
});
