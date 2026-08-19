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
  finalizationBudget,
  reworkBudgetOf,
  reworkBudget,
  type Bounds,
} from "../../src/domain/pricing.ts";
import { boundsOf } from "../../src/domain/config.ts";
import { CONFIGS } from "./configs.ts";
import { rankCeiling, rankSettled, phaseRank } from "../../src/domain/phase.ts";

import { budgetedInstance } from "./configs.ts";
import { depsOf, ticketOn, workOutstanding } from "./fixtures.ts";
import type {
  Phase,
  Task,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const GOLDEN_DIR = join(import.meta.dirname, "..", "golden");

/**
 * What the measure needs, read off the one transcription of the model's
 * instance constants. A second copy here would be a second version of
 * `model/mc/mc_chuggy.qnt` inside a year.
 */
function boundsFor(instance: string): Bounds | undefined {
  const config = CONFIGS[instance];
  return config === undefined ? undefined : boundsOf(config);
}

interface Row {
  readonly name: string;
  readonly instance: string;
  readonly steps: number;
}

function manifestRows(): readonly Row[] {
  const manifest = JSON.parse(
    readFileSync(join(GOLDEN_DIR, "manifest.json"), "utf8"),
  ) as {
    goldens: { name: string; instance: string; steps: number }[];
  };
  return manifest.goldens;
}

/** A ticket at rest, which every hand-built measure case varies one field of. */
const atRest: Ticket = {
  phase: "Done",
  deps: new Set<number>(),
  finalizer: "NoFinalizer",
  artifact: "NoArtifact",
  workFanout: 1,
  reworkPolicy: reworkBudgetOf(0),
  finalizationPricing: deadlineOnly,
  resumePricing: "RetryCharged",
  program: [],
  tasks: new Set<Task>(),
  record: [],
  spawned: 0,
  reworkLeft: 0,
  finalizationLeft: 0,
  gasLeft: 0,
  resumeAt: "NoResume",
  reason: "NoReason",
  completions: 0,
};

test("the corpus reproduces this implementation's sysMeasure at every step", () => {
  const rows = manifestRows();
  assert.ok(rows.length > 0, "the manifest is empty");
  let compared = 0;
  for (const row of rows) {
    const bounds = boundsFor(row.instance);
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
    assert.equal(
      trace.states.length - 1,
      row.steps,
      `${row.name}: the trace on disk is not the length its manifest row claims`,
    );
  }
  assert.equal(
    compared,
    rows.reduce((total, row) => total + row.steps, 0),
    "every step of every golden is compared, which is what the manifest's own lengths add up to",
  );
});

test("radix is the one place the chain adds one", () => {
  assert.equal(radix(0), 1);
  assert.equal(radix(7), 8);
});

test("each weight is worth exactly a full digit of the one below it", () => {
  const bounds = boundsFor("mc_chuggy_budgeted");
  assert.ok(bounds);
  assert.equal(stageWeight(bounds), radix(bounds.nTasks));
  assert.equal(
    rankWeight(bounds),
    radix(bounds.maxStages) * stageWeight(bounds),
  );
  assert.equal(microBound(bounds), radix(rankCeiling) * rankWeight(bounds));
});

test("micro is bounded strictly below microBound, which is what makes the flattening work", () => {
  const bounds = boundsFor("mc_chuggy_budgeted");
  assert.ok(bounds);
  const worst: Ticket = { ...atRest, phase: "Pending" };
  assert.equal(phaseRank(worst.phase), rankCeiling);
  assert.ok(micro(bounds, worst) < microBound(bounds));
});

test("a settled ticket with empty accounts measures zero, which is the well-foundedness floor", () => {
  const bounds = boundsFor("mc_chuggy_budgeted");
  assert.ok(bounds);
  assert.equal(phaseRank(atRest.phase), rankSettled);
  assert.equal(ticketMeasure(bounds, atRest), 0);
});

test("no digit, weight or radix reads what the ticket produced or waits on", () => {
  const bounds = boundsFor("mc_chuggy_budgeted");
  assert.ok(bounds);
  const phases: readonly Phase[] = [
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Escalated",
  ];
  for (const phase of phases) {
    const ticket = ticketOn(budgetedInstance, "ManagedFinalizer", {
      phase,
      tasks: new Set([workOutstanding(1)]),
      spawned: 1,
    });
    assert.equal(
      ticketMeasure(bounds, ticket),
      ticketMeasure(bounds, {
        ...ticket,
        artifact: { type: "ProducedArtifact", value: 9 },
      }),
      `${phase}: the measure moved with the artifact`,
    );
    assert.equal(
      ticketMeasure(bounds, ticket),
      ticketMeasure(bounds, { ...ticket, deps: depsOf(4) }),
      `${phase}: the measure moved with the dependency set`,
    );
    assert.equal(
      ticketMeasure(bounds, ticket),
      ticketMeasure(bounds, { ...ticket, finalizer: "NoFinalizer" }),
      `${phase}: the measure moved with the finish kind`,
    );
  }
});

test("the accounts' radices come from the policies, not from a literal", () => {
  assert.equal(finalizationBudget(budgeted(3)), 3);
  assert.equal(finalizationBudget(deadlineOnly), 0);
  assert.equal(reworkBudget(reworkBudgetOf(2)), 2);
});

test("the corpus spans every golden the directory holds", () => {
  const onDisk = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".itf.json"))
    .map((f) => f.slice(0, -".itf.json".length));
  const named = manifestRows().map((r) => r.name);
  assert.deepEqual([...onDisk].sort(), [...named].sort());
});
