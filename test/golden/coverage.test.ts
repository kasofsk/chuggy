/**
 * The corpus fires every step label the model declares, and each row contains
 * what its manifest row says it was aimed at.
 *
 * This fails the corpus rather than reporting on it. A label no golden fires is
 * an edge of the machine nothing replays, which is the same as an edge the
 * implementation is free to get wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeTrace, field, stateValue } from "../itf/decode.ts";
import { declaredLabels, loadCorpus, UNREACHABLE_LABEL } from "./corpus.ts";

const ROOT = join(import.meta.dirname, "..", "..");

const corpus = loadCorpus();

test("the manifest and the files on disk agree in both directions", () => {
  for (const row of corpus.rows) {
    assert.ok(
      row.trace !== undefined,
      `manifest row ${row.name} names a golden that is not on disk`,
    );
  }
  for (const file of corpus.filesOnDisk) {
    assert.ok(
      corpus.rows.some((r) => r.name === file),
      `golden ${file} is on disk with no manifest row; regeneration would not reproduce it`,
    );
  }
});

test("every manifest row records what reproduces it", () => {
  for (const row of corpus.rows) {
    assert.ok(row.instance.length > 0, `${row.name}: no instance`);
    assert.match(
      row.seed,
      /^0x[0-9a-f]+$/,
      `${row.name}: seed is not a literal`,
    );
    assert.ok(row.maxSamples > 0, `${row.name}: no sample budget`);
    assert.ok(row.maxSteps > 0, `${row.name}: no step bound`);
    assert.equal(
      row.quintVersion,
      "0.32.0",
      `${row.name}: pinned to another quint`,
    );
  }
});

test("the declared roster is read from the model, not from this file", () => {
  const labels = declaredLabels(ROOT);
  assert.ok(labels.has("init"), "the label roster did not parse");
  assert.ok(
    labels.has(UNREACHABLE_LABEL),
    "the guarded label is not in the roster",
  );
});

test("every reachable label the model declares is fired somewhere in the corpus", () => {
  const declared = declaredLabels(ROOT);
  const fired = corpus.firedAcross();
  const missing = [...declared].filter(
    (l) => l !== UNREACHABLE_LABEL && !fired.has(l),
  );
  assert.deepEqual(
    missing,
    [],
    `these declared labels are in no golden, so nothing replays them: ${missing.join(", ")}`,
  );
});

test("the guarded label is not fired, because the model asserts it unreachable", () => {
  const fired = corpus.firedAcross();
  assert.ok(
    !fired.has(UNREACHABLE_LABEL),
    `${UNREACHABLE_LABEL} appears in the corpus; the model says its guard refuses it`,
  );
});

test("every golden's first state is the init step", () => {
  for (const row of corpus.rows) {
    const trace = decodeTrace(row.trace);
    const lastStep = trace.vars.find((v) => v.endsWith("::lastStep"));
    assert.ok(lastStep, `${row.name}: no lastStep variable`);
    const first = trace.states[0];
    assert.ok(first, `${row.name}: no states`);
    assert.equal(
      field(stateValue(first, lastStep), "label"),
      "init",
      `${row.name}`,
    );
  }
});

test("every golden's step count matches what its manifest row records", () => {
  for (const row of corpus.rows) {
    const trace = decodeTrace(row.trace);
    assert.equal(
      trace.states.length - 1,
      row.steps,
      `${row.name}: the manifest records ${String(row.steps)} steps and the file holds ${String(trace.states.length - 1)}`,
    );
  }
});

/**
 * An aim is either `lastStep.label != "x"` or `not(lastStep.label == "x" and
 * ...)`; both are refuted only by a step labelled `x`, so a trace that reaches
 * neither has drifted from its row. Any other shape is refused rather than
 * skipped: an aim this test cannot read is an aim nothing checks.
 */
test("an aimed golden actually contains what it was aimed at", () => {
  for (const row of corpus.rows) {
    if (row.invariant === "") continue;
    const aimed = /lastStep\.label (?:!=|==) "([^"]+)"/.exec(row.invariant);
    assert.ok(
      aimed?.[1],
      `${row.name} is aimed by an invariant this test cannot read: ${row.invariant}`,
    );
    const fired = corpus.firedForRow(row);
    assert.ok(
      fired.has(aimed[1]),
      `${row.name} is aimed at ${aimed[1]} and does not contain it; the row's aim and its file have drifted`,
    );
  }
});

test("the corpus is small enough that a reviewer can read a regeneration diff", () => {
  /** A review budget rather than a measurement, so raising it is a decision rather than a fix. */
  const totalSteps = corpus.rows.reduce((n, r) => n + r.steps, 0);
  assert.ok(
    corpus.rows.length <= 24,
    `${String(corpus.rows.length)} goldens is past what a reviewer reads; prefer fewer, longer traces with a stated purpose each`,
  );
  assert.ok(
    totalSteps <= 800,
    `${String(totalSteps)} steps across the corpus is past the review budget`,
  );
});

test("a decoded state carries the ghosts the replayer reads", () => {
  const row = corpus.rows[0];
  assert.ok(row, "the corpus is empty");
  const trace = decodeTrace(row.trace);
  const first = trace.states[0];
  assert.ok(first, `${row.name}: no states`);
  for (const suffix of ["::prevRecords", "::tickets"]) {
    const name = trace.vars.find((v) => v.endsWith(suffix));
    assert.ok(
      name,
      `no ${suffix} variable; the replayer would have nothing to compare`,
    );
    assert.ok(stateValue(first, name) !== undefined);
  }
});

test("every state records the action that produced it and the picks it drew", () => {
  for (const row of corpus.rows) {
    const trace = decodeTrace(row.trace);
    for (const state of trace.states) {
      assert.ok(
        state.values.has("mbt::actionTaken"),
        `${row.name} state ${String(state.index)}: no action recorded, so the step cannot be replayed`,
      );
      assert.ok(
        state.values.has("mbt::nondetPicks"),
        `${row.name} state ${String(state.index)}: no picks recorded, so the step cannot be replayed`,
      );
    }
  }
});

test("the corpus spans every instance the model declares", () => {
  const declared = readFileSync(
    join(ROOT, "model", "mc", "mc_chuggy.qnt"),
    "utf8",
  )
    .split("\n")
    .flatMap((line) => /^module (mc_chuggy\w*)/.exec(line)?.[1] ?? []);
  assert.ok(declared.length > 0, "no instances parsed out of the model");
  for (const instance of declared) {
    assert.ok(
      corpus.rows.some((r) => r.instance === instance),
      `${instance} is declared in the model and has no golden`,
    );
  }
});
