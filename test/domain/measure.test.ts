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
import { boundsOf } from "../../src/domain/config.ts";
import { CONFIGS } from "./configs.ts";
import {
  rankCeiling,
  rankDraft,
  rankSettled,
  phaseRank,
} from "../../src/domain/phase.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import { aNone, aSome, wNone } from "../../src/domain/wrapUp.ts";
import type { Ticket } from "../../src/domain/ticket.ts";
import type { Phase } from "../../src/domain/phase.ts";
import { budgetedInstance } from "./configs.ts";
import { ticketOn, workOutstanding } from "./fixtures.ts";

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
  const bounds = boundsFor("mc_chuggy_budgeted");
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

test("no digit, weight or radix reads the project or the artifact", () => {
  const bounds = boundsFor("mc_chuggy_budgeted");
  assert.ok(bounds);
  const phases: readonly Phase[] = [
    "PDraft",
    "PPending",
    "PWorking",
    "PEvaluating",
    "PWrapUp",
    "PWrapUpHolding",
    "PEscalated",
  ];
  for (const phase of phases) {
    const ticket = ticketOn(budgetedInstance, 1, {
      phase,
      tasks: [workOutstanding(1)],
      spawned: 1,
    });
    assert.equal(
      ticketMeasure(bounds, ticket),
      ticketMeasure(bounds, { ...ticket, project: asProjectId(2) }),
      `${phase}: the measure moved with the project`,
    );
    assert.equal(
      ticketMeasure(bounds, ticket),
      ticketMeasure(bounds, { ...ticket, artifact: aSome(9) }),
      `${phase}: the measure moved with the artifact`,
    );
  }
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
