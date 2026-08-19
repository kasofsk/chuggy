/**
 * The shrinker and the counterexample writer, proved against a deliberately
 * broken decider rather than against a defect nobody has.
 *
 * THE MUTANT IS THE ONE THE ACCUMULATOR EXISTS FOR: a revoke that records its
 * ticket reaching Done on the way out. It changes no state, so every leaf of the
 * bundle stays green on every state it builds — `revokedNeverCompletes`
 * included, because the ledger it reads is the one the revoke left alone — and
 * only the completions counted off the record stream see it. The injection is
 * the walk's `decide` seam, so the broken decider exists for the length of a
 * test and the tree is never touched; `.chug/tasks/check-random.test.sh` runs
 * the same defect through the real gates in a scratch copy and restores it,
 * which is the tier this file cannot express.
 *
 * WHAT THE FIXTURE PROVES CUTS BOTH WAYS. Under the broken decider the written
 * states are exactly what replaying its own trace reproduces, which is what
 * makes the file a corpus the replayer consumes; under the true dispatch table
 * the recorded step diverges at the phantom completion, which is what makes it
 * pin the defect once fixed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { budgetedInstance } from "../domain/configs.ts";
import { decodeTrace, encodeValue } from "../itf/decode.ts";
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

/** The phantom completion: a revoke recording its ticket as having reached Done, state untouched. */
const phantomCompletion: Decide = (walkConfig, core, action, picks) => {
  const decision = decideViaTable(walkConfig, core, action, picks);
  const moved = decision.rec.transitions[0];
  if (action !== "revoke" || moved === undefined) return decision;
  return {
    rec: {
      ...decision.rec,
      transitions: [...decision.rec.transitions, { ...moved, to: "Done" }],
    },
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
 * A seed whose budgeted run draws a revoke: the pinned one, then a bounded
 * fallback sweep. A miss on both means the draw stream changed shape under the
 * pin, and the fix is a wider offline sweep and a fresh pin.
 */
function found(): Found {
  if (cached !== undefined) return cached;
  const candidates = [
    seedPinned,
    ...Array.from({ length: seedFallbackMax }, (_unused, index) => index + 1),
  ];
  for (const seed of candidates) {
    const outcome = walkRun(config, seed, walkStepsMax, phantomCompletion);
    if (outcome.finding !== undefined) {
      cached = {
        seed,
        outcome,
        shrunk: shrinkSteps(config, outcome.steps, phantomCompletion),
      };
      return cached;
    }
  }
  throw new Error(
    "no counterexample at the pinned seed or inside the fallback sweep; re-search and re-pin",
  );
}

test("the phantom completion is caught by the accumulator and by nothing structural", () => {
  const { outcome } = found();
  assert.ok(outcome.finding);
  assert.equal(outcome.finding.action, "revoke");
  const failure = outcome.finding.failure;
  assert.deepEqual(failure.failed, [], "every bundle leaf stays green");
  assert.deepEqual(failure.refused, [], "no leaf even refuses");
  assert.equal(failure.broke, undefined);
  assert.match(failure.emissions.join(" "), /1 completion\(s\) counted/);
});

test("the counterexample shrinks to a one-minimal machine trace that still fails", () => {
  const { outcome, shrunk } = found();
  assert.ok(shrunk.length >= 1);
  assert.ok(shrunk.length <= outcome.steps.length);
  const replayed = walkReplay(config, shrunk, phantomCompletion);
  assert.equal(replayed.kind, "finding");
  assert.equal(shrunk[shrunk.length - 1]?.action, "revoke");
  for (let index = 0; index < shrunk.length; index++) {
    const without = [...shrunk.slice(0, index), ...shrunk.slice(index + 1)];
    assert.notEqual(
      walkReplay(config, without, phantomCompletion).kind,
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
    phantomCompletion,
    "the suite's phantom-completion counterexample",
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

  const recorded = walkRecord(config, shrunk, phantomCompletion);
  recorded.forEach(({ decision }, index) => {
    const state = raw.states[index + 1];
    assert.ok(state);
    assert.ok(
      isDeepStrictEqual(
        state[ticketsVar],
        encodeValue(encodeCore(decision.post)),
      ),
    );
    assert.ok(
      isDeepStrictEqual(
        state[lastStepVar],
        encodeValue(encodeStepRecord(decision.rec)),
      ),
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

test("under the true dispatch table the recorded step diverges at the phantom completion", () => {
  const { shrunk } = found();
  const broken = walkRecord(config, shrunk, phantomCompletion);
  const fixed = walkRecord(config, shrunk, decideViaTable);
  const last = broken[broken.length - 1];
  const same = fixed[fixed.length - 1];
  assert.ok(last && same);
  assert.equal(
    same.decision.rec.transitions.filter((t) => t.to === "Done").length,
    0,
    "the machine records no completion on the way out of a revoke",
  );
  assert.ok(
    !isDeepStrictEqual(
      encodeValue(encodeStepRecord(last.decision.rec)),
      encodeValue(encodeStepRecord(same.decision.rec)),
    ),
    "the fixture pins exactly the divergence a fixed tree replays red",
  );
});
