/**
 * The measure, checked against the model's own arithmetic rather than against
 * a table somebody typed.
 *
 * Every golden state carries `prevMeasure`, the ghost the model snapshots
 * before each decision, so the corpus already contains the specification's
 * value for `sysMeasure` at every step of every trace. Reproducing it exactly
 * is a far stronger statement than any hand-written expectation: it exercises
 * the whole weight chain — the rank ladder, both radices, three accounts and
 * the stage digit — at every state the corpus reaches.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { decodeTrace, describe, stateValue } from "../itf/decode.ts";
import { decodeCore } from "../itf/vocabulary.ts";
import {
  micro,
  microBound,
  radix,
  rankWeight,
  stageWeight,
  sysMeasure,
  ticketMeasure,
} from "../../src/domain/measure.ts";
import {
  budgeted,
  deadlineOnly,
  reworkBudgetOf,
  reworkBudget,
  wrapUpBudget,
  type Bounds,
} from "../../src/domain/pricing.ts";
import {
  rankCeiling,
  rankDraft,
  rankSettled,
  phaseRank,
} from "../../src/domain/phase.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import { aNone, wNone } from "../../src/domain/wrapUp.ts";
import type { Ticket } from "../../src/domain/ticket.ts";

const GOLDEN_DIR = join(import.meta.dirname, "..", "golden");

/**
 * The consts each instance is declared with, read off `model/mc/mc_chuggy.qnt`.
 * They are stated rather than parsed because a Quint instantiation is not a
 * declaration a grep reads reliably, and a wrong value here fails loudly
 * against `prevMeasure` on the first state of the first trace.
 */
const BOUNDS: Record<string, Bounds> = {
  mc_chuggy_budgeted: {
    reworkPolicy: reworkBudgetOf(1),
    nTasks: 2,
    maxStages: 2,
    wrapUpPricing: budgeted(1),
  },
  mc_chuggy_deadline_only: {
    reworkPolicy: reworkBudgetOf(1),
    nTasks: 2,
    maxStages: 2,
    wrapUpPricing: deadlineOnly,
  },
  mc_chuggy_retryfree: {
    reworkPolicy: reworkBudgetOf(1),
    nTasks: 2,
    maxStages: 2,
    wrapUpPricing: deadlineOnly,
  },
};

interface Row {
  readonly name: string;
  readonly instance: string;
}

function manifestRows(): readonly Row[] {
  const manifest = JSON.parse(
    readFileSync(join(GOLDEN_DIR, "manifest.json"), "utf8"),
  ) as {
    goldens: { name: string; instance: string }[];
  };
  return manifest.goldens;
}

test("the corpus reproduces this implementation's sysMeasure at every step", () => {
  const rows = manifestRows();
  assert.ok(rows.length > 0, "the manifest is empty");
  let compared = 0;
  for (const row of rows) {
    const bounds = BOUNDS[row.instance];
    assert.ok(bounds, `${row.instance} has no bounds declared here`);
    const trace = decodeTrace(
      JSON.parse(
        readFileSync(join(GOLDEN_DIR, `${row.name}.itf.json`), "utf8"),
      ) as unknown,
    );
    const ticketsVar = trace.vars.find((v) => v.endsWith("::tickets"));
    const prevVar = trace.vars.find((v) => v.endsWith("::prevMeasure"));
    assert.ok(
      ticketsVar && prevVar,
      `${row.name}: the ghosts are not in this trace`,
    );

    for (let i = 1; i < trace.states.length; i++) {
      const before = trace.states[i - 1];
      const now = trace.states[i];
      if (!before || !now) continue;
      const expected = stateValue(now, prevVar);
      assert.equal(
        typeof expected,
        "bigint",
        `${row.name} state ${String(i)}: prevMeasure is not an integer`,
      );
      const computed = sysMeasure(
        bounds,
        decodeCore(stateValue(before, ticketsVar)),
      );
      assert.equal(
        BigInt(computed),
        expected,
        `${row.name} state ${String(i)}: the model measured ${describe(expected)} and this implementation measured ${String(computed)}`,
      );
      compared++;
    }
  }
  assert.ok(
    compared > 300,
    `only ${String(compared)} states compared; the corpus should carry more`,
  );
});

test("radix is the one place the chain adds one", () => {
  assert.equal(radix(0), 1);
  assert.equal(radix(7), 8);
});

test("each weight is worth exactly a full digit of the one below it", () => {
  const bounds = BOUNDS["mc_chuggy_budgeted"];
  assert.ok(bounds);
  assert.equal(stageWeight(bounds), radix(bounds.nTasks));
  assert.equal(
    rankWeight(bounds),
    radix(bounds.maxStages) * stageWeight(bounds),
  );
  assert.equal(microBound(bounds), radix(rankCeiling) * rankWeight(bounds));
});

test("micro is bounded strictly below microBound, which is what makes the flattening work", () => {
  const bounds = BOUNDS["mc_chuggy_budgeted"];
  assert.ok(bounds);
  const worst: Ticket = {
    phase: "PDraft",
    deps: [],
    wrapUp: wNone,
    artifact: aNone,
    project: asProjectId(1),
    program: [],
    tasks: [],
    record: [],
    spawned: 0,
    reworkLeft: 0,
    wrapUpLeft: 0,
    gasLeft: 0,
    resumeAt: "RNone",
    reason: "RsNone",
  };
  assert.equal(phaseRank(worst.phase), rankDraft);
  assert.ok(micro(bounds, worst) < microBound(bounds));
});

test("a settled ticket with empty accounts measures zero, which is the well-foundedness floor", () => {
  const bounds = BOUNDS["mc_chuggy_budgeted"];
  assert.ok(bounds);
  const settled: Ticket = {
    phase: "PDone",
    deps: [],
    wrapUp: wNone,
    artifact: aNone,
    project: asProjectId(1),
    program: [],
    tasks: [],
    record: [],
    spawned: 0,
    reworkLeft: 0,
    wrapUpLeft: 0,
    gasLeft: 0,
    resumeAt: "RNone",
    reason: "RsNone",
  };
  assert.equal(phaseRank(settled.phase), rankSettled);
  assert.equal(ticketMeasure(bounds, settled), 0);
});

test("the accounts' radices come from the policies, not from a literal", () => {
  assert.equal(wrapUpBudget(budgeted(3)), 3);
  assert.equal(wrapUpBudget(deadlineOnly), 0);
  assert.equal(reworkBudget(reworkBudgetOf(2)), 2);
});

test("the corpus spans every golden the directory holds", () => {
  const onDisk = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".itf.json"))
    .map((f) => f.slice(0, -".itf.json".length));
  const named = manifestRows().map((r) => r.name);
  assert.deepEqual([...onDisk].sort(), [...named].sort());
});
