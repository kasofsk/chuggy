/**
 * The manifest and the model's own const blocks.
 *
 * THE CASE THAT EARNS THIS FILE is `readModuleConsts` against the REAL model
 * sources. It is a text parse of a Quint declaration, which is the one part of
 * the corpus machinery that can rot without anything else noticing — and what
 * it reads is the staleness alarm for every committed fixture. So it is pinned
 * against the actual `mc/mc_chuggy.qnt` and `tests/chuggy_witness_test.qnt`, at
 * the modules the manifest names, rather than against a fixture that would go
 * on parsing after the model's shape had changed.
 *
 * `verify.ts` and the two CLI drivers have no suite here on purpose: everything
 * they do is read the filesystem and turn a walk into an exit code, and
 * `.chug/tasks/check-conformance.test.sh` drives them over real repositories —
 * a clean one, one with a corrupted fixture, one with a manifest entry dropped,
 * and one with no corpus at all. A unit test that stubbed the filesystem would
 * check less at more cost.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CorpusError,
  configOf,
  constsDisagree,
  loadManifest,
  mcSource,
  readModuleConsts,
  witnessSource,
  type ModelConsts,
} from "./corpus.ts";

const budgeted: ModelConsts = {
  N_TICKETS: "3",
  N_TASKS: "2",
  REWORK_POLICY: "RWBudget(1)",
  GAS: "3",
  WRAPUP_PRICING: "Budgeted(1)",
  OP_RETRY_PRICING: "RetryCharged",
  MAX_STAGES: "2",
  N_PROJECTS: "2",
};

test("readModuleConsts: the mc instances, read out of the model itself", () => {
  // The parenthesis inside `RWBudget(1)` is why the block is read by depth
  // rather than to the first close, and this row is what would catch a reader
  // that stopped there.
  assert.deepEqual(readModuleConsts(mcSource, "mc_chuggy_budgeted"), budgeted);
  assert.deepEqual(readModuleConsts(mcSource, "mc_chuggy_deadline_only"), {
    ...budgeted,
    WRAPUP_PRICING: "DeadlineOnly",
  });
  assert.deepEqual(readModuleConsts(mcSource, "mc_chuggy_retryfree"), {
    ...budgeted,
    N_TICKETS: "2",
    GAS: "2",
    WRAPUP_PRICING: "DeadlineOnly",
    OP_RETRY_PRICING: "RetryFree",
  });
});

test("readModuleConsts: a witness module, and a module that is not there", () => {
  assert.deepEqual(
    readModuleConsts(witnessSource, "chuggy_witness_free_test"),
    {
      ...budgeted,
      N_TICKETS: "2",
      GAS: "2",
      WRAPUP_PRICING: "DeadlineOnly",
      OP_RETRY_PRICING: "RetryFree",
    },
  );
  // "No consts" and "consts this parse cannot see" must not report the same,
  // so an absent module is an error rather than an empty answer.
  assert.throws(
    () => readModuleConsts(witnessSource, "chuggy_witness_imaginary_test"),
    CorpusError,
  );
  // A source that is not there at all. The path names no tree this repo has,
  // deliberately: `.chug/tasks/check-paths.sh` reads a claim about `model/` as a
  // claim this tree must satisfy, and a fixture for an absent file is not one.
  assert.throws(
    () => readModuleConsts("nowhere/nothing.qnt", "x"),
    CorpusError,
  );
});

test("configOf: the model's const spelling into the shipped Config", () => {
  assert.deepEqual(configOf(budgeted, "at"), {
    nTickets: 3,
    nTasks: 2,
    reworkPolicy: { tag: "RWBudget", budget: 1 },
    gas: 3,
    wrapUpPricing: { tag: "Budgeted", budget: 1 },
    opRetryPricing: "RetryCharged",
    maxStages: 2,
    nProjects: 2,
  });
  assert.deepEqual(
    configOf({ ...budgeted, WRAPUP_PRICING: "DeadlineOnly" }, "at")
      .wrapUpPricing,
    { tag: "DeadlineOnly" },
  );
  assert.equal(
    configOf({ ...budgeted, OP_RETRY_PRICING: "RetryFree" }, "at")
      .opRetryPricing,
    "RetryFree",
  );
});

test("configOf: a const it cannot read is refused, never defaulted", () => {
  const bad: readonly Partial<ModelConsts>[] = [
    { GAS: "three" },
    { GAS: "" },
    { REWORK_POLICY: "RWUnbounded" },
    { WRAPUP_PRICING: "Budgeted" },
    { OP_RETRY_PRICING: "RetrySometimes" },
  ];
  for (const over of bad) {
    assert.throws(
      () => configOf({ ...budgeted, ...over }, "at"),
      CorpusError,
      JSON.stringify(over),
    );
  }
});

test("constsDisagree: silent on agreement, and it names the const that moved", () => {
  const config = configOf(budgeted, "at");
  assert.equal(constsDisagree(config, budgeted, "at"), undefined);
  const moved = constsDisagree(config, { ...budgeted, GAS: "4" }, "at");
  assert.ok(moved?.includes("gas"));
  // A pricing branch changing is the same alarm, and it is a record rather
  // than a number — which is why the comparison is structural.
  const repriced = constsDisagree(
    config,
    { ...budgeted, WRAPUP_PRICING: "DeadlineOnly" },
    "at",
  );
  assert.ok(repriced?.includes("wrapUpPricing"));
});

test("loadManifest: the committed manifest loads, and names nothing twice", () => {
  const manifest = loadManifest();
  const names = [
    ...manifest.tier1.map((f) => f.name),
    ...manifest.tier2.map((f) => f.name),
  ];
  assert.equal(new Set(names).size, names.length);
  // Both tiers are populated: a corpus with an empty tier is not the two-tier
  // corpus the mechanism decided on.
  assert.ok(manifest.tier1.length > 0);
  assert.ok(manifest.tier2.length > 0);
  // Every tier-1 entry names an mc instance, which is what the instance
  // obligation is counted from.
  for (const fixture of manifest.tier1) {
    assert.ok(
      ["budgeted", "deadline_only", "retryfree"].includes(fixture.instance),
    );
  }
});
