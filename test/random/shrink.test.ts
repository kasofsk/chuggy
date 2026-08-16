/**
 * The shrinker and the counterexample writer, proved against a deliberately
 * broken decider rather than against a defect nobody has.
 *
 * THE MUTANT IS THE ONE THE ACCUMULATOR EXISTS FOR: the duplicate-completion
 * decider re-emitting `Complete`, which changes no state — so every leaf of the
 * bundle stays green on every state it builds — and is caught only by the
 * emission count across the run. The injection is the walk's `decide` seam, so
 * the broken decider exists for the length of a test and the tree is never
 * touched; `.chug/tasks/check-random.test.sh` runs the same defect through the
 * real gates in a scratch copy and restores it, which is the tier this file
 * cannot express.
 *
 * WHAT THE FIXTURE PROVES CUTS BOTH WAYS. Under the broken decider the written
 * states are exactly what replaying its own trace reproduces, which is what
 * makes the file a corpus the replayer consumes; under the true dispatch table
 * the recorded step diverges at the double emission, which is what makes it pin
 * the defect once fixed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { budgetedInstance } from "../domain/configs.ts";
import { decodeTrace } from "../itf/decode.ts";
import { encodeCore, encodeStepRecord } from "../itf/vocabulary.ts";
import { seedLabel, writeCounterexample } from "./counterexample.ts";
import { shrinkSteps } from "./shrink.ts";
import {
  decideViaTable,
  walkRecord,
  walkReplay,
  walkRun,
  walkStepsMax,
  type Decide,
  type WalkOutcome,
  type WalkStep,
} from "./walk.ts";

const config = budgetedInstance;
const instance = "mc_chuggy_budgeted";

/** The double emission: the duplicate delivery answered with a completion effect, state untouched. */
const doubleEmit: Decide = (walkConfig, core, action, picks) => {
  const decision = decideViaTable(walkConfig, core, action, picks);
  if (action !== "completeDuplicate") return decision;
  return {
    rec: { ...decision.rec, effects: ["Complete"] },
    post: decision.post,
  };
};

const seedPinned = 10975;
const seedFallbackMax = 400;

interface Found {
  readonly seed: number;
  readonly outcome: WalkOutcome;
  readonly shrunk: readonly WalkStep[];
}

let cached: Found | undefined;

/**
 * A seed whose budgeted run draws a duplicate completion: the pinned one, then
 * a bounded fallback sweep. A miss on both means the draw stream changed shape
 * under the pin, and the fix is a wider offline sweep and a fresh pin.
 */
function found(): Found {
  if (cached !== undefined) return cached;
  const candidates = [
    seedPinned,
    ...Array.from({ length: seedFallbackMax }, (unused, index) => index + 1),
  ];
  for (const seed of candidates) {
    const outcome = walkRun(config, seed, walkStepsMax, doubleEmit);
    if (outcome.finding !== undefined) {
      cached = {
        seed,
        outcome,
        shrunk: shrinkSteps(config, outcome.steps, doubleEmit),
      };
      return cached;
    }
  }
  throw new Error(
    "no counterexample at the pinned seed or inside the fallback sweep; re-search and re-pin",
  );
}

test("the double emission is caught by the accumulator and by nothing structural", () => {
  const { outcome } = found();
  assert.ok(outcome.finding);
  assert.equal(outcome.finding.action, "completeDuplicate");
  const failure = outcome.finding.failure;
  assert.deepEqual(failure.failed, [], "every bundle leaf stays green");
  assert.deepEqual(failure.refused, [], "no leaf even refuses");
  assert.equal(failure.broke, undefined);
  assert.match(failure.emissions.join(" "), /Complete emission/);
});

test("the counterexample shrinks to a one-minimal machine trace that still fails", () => {
  const { outcome, shrunk } = found();
  assert.ok(shrunk.length >= 1);
  assert.ok(shrunk.length <= outcome.steps.length);
  const replayed = walkReplay(config, shrunk, doubleEmit);
  assert.equal(replayed.kind, "finding");
  assert.equal(shrunk[shrunk.length - 1]?.action, "completeDuplicate");
  for (let index = 0; index < shrunk.length; index++) {
    const without = [...shrunk.slice(0, index), ...shrunk.slice(index + 1)];
    assert.notEqual(
      walkReplay(config, without, doubleEmit).kind,
      "finding",
      `dropping step ${String(index + 1)} still fails, so the shrinker left slack`,
    );
  }
});

test("a clean trace refuses to shrink rather than inventing a counterexample", () => {
  assert.throws(
    () => shrinkSteps(config, [], decideViaTable),
    /nothing to shrink/,
  );
});

test("the written counterexample is a corpus: its states are what its own steps replay", () => {
  const { seed, shrunk } = found();
  const directory = mkdtempSync(join(tmpdir(), "chuggy-shrink-"));
  const written = writeCounterexample(
    directory,
    config,
    instance,
    seed,
    shrunk,
    doubleEmit,
    "the suite's double-emission counterexample",
  );
  const raw = JSON.parse(readFileSync(written.file, "utf8")) as {
    states: Record<string, unknown>[];
  };
  const trace = decodeTrace(raw);
  const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
  const lastStepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  assert.ok(ticketsVar, "the replayer looks the tickets variable up by suffix");
  assert.ok(lastStepVar, "the replayer looks the record variable up by suffix");
  assert.equal(trace.states.length, shrunk.length + 1);

  const recorded = walkRecord(config, shrunk, doubleEmit);
  recorded.forEach(({ decision }, index) => {
    const state = raw.states[index + 1];
    assert.ok(state);
    assert.ok(isDeepStrictEqual(state[ticketsVar], encodeCore(decision.post)));
    assert.ok(
      isDeepStrictEqual(state[lastStepVar], encodeStepRecord(decision.rec)),
    );
  });

  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as { goldens: { name: string; instance: string; steps: number }[] };
  const row = manifest.goldens[0];
  assert.ok(row);
  assert.equal(row.instance, instance);
  assert.equal(row.steps, shrunk.length);
  assert.equal(row.name, `walk-${instance}-${seedLabel(seed)}`);
});

test("under the true dispatch table the recorded step diverges at the double emission", () => {
  const { shrunk } = found();
  const broken = walkRecord(config, shrunk, doubleEmit);
  const fixed = walkRecord(config, shrunk, decideViaTable);
  const last = broken[broken.length - 1];
  const same = fixed[fixed.length - 1];
  assert.ok(last && same);
  assert.deepEqual(
    same.decision.rec.effects,
    [],
    "the machine absorbs the duplicate silently",
  );
  assert.ok(
    !isDeepStrictEqual(
      encodeStepRecord(last.decision.rec),
      encodeStepRecord(same.decision.rec),
    ),
    "the fixture pins exactly the divergence a fixed tree replays red",
  );
});
