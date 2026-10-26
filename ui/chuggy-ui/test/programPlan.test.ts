/**
 * What a configuration plans its program to run, and which programs run less:
 * a catalog's selected plan by stage and evaluator, a document's `evaluations`
 * by stage alone, and a document listing none planning nothing.
 */

import { expect, test } from "vitest";

import { configurationCatalogInitialization } from "../app/core/configurationCatalog.ts";
import {
  programPlanned,
  programShort,
  programStageLeast,
} from "../app/core/programPlan.ts";
import type { PlannedProgram } from "../app/core/programPlan.ts";
import {
  creationCatalogOffer,
  creationInitialization,
} from "./ticketCreationFixture.ts";

/** A program of one stage per width given, each holding evaluators keyed from one. */
function programOf(...widths: readonly number[]): PlannedProgram {
  return widths.map((width, index) => ({
    key: index + 1,
    evaluators: Array.from({ length: width }, (_, at) => ({ key: at + 1 })),
  }));
}

const gated = programPlanned(
  configurationCatalogInitialization(creationCatalogOffer().initialization, {
    evaluation: "gated",
  }),
);

const documented = programPlanned({
  ...creationInitialization,
  configuration: {
    ...creationInitialization.configuration,
    canonical: JSON.stringify({
      evaluations: [{ purpose: "Review" }, { purpose: "Check" }],
    }),
  },
});

test("a catalog plans every evaluator of its selected plan, stage by stage", () => {
  expect(gated).toStrictEqual([
    { stage: 1, evaluator: 1 },
    { stage: 1, evaluator: 2 },
    { stage: 2, evaluator: 1 },
  ]);
  expect(programShort(gated, programOf(2, 1))).toBe(false);
  expect(programShort(gated, programOf(3, 2))).toBe(false);
});

test("a program with fewer stages than its catalog's plan runs less", () => {
  expect(programShort(gated, programOf(2))).toBe(true);
  expect(programShort(gated, [])).toBe(true);
});

test("a stage leaving out an evaluator its plan stage holds runs less", () => {
  expect(programShort(gated, programOf(1, 1))).toBe(true);
  expect(
    programShort(gated, [
      { key: 1, evaluators: [{ key: 2 }, { key: 3 }] },
      { key: 2, evaluators: [{ key: 1 }] },
    ]),
  ).toBe(true);
});

test("a document plans a stage under each of its evaluations, whatever evaluators that stage holds", () => {
  expect(documented).toStrictEqual([{ stage: 1 }, { stage: 2 }]);
  expect(programShort(documented, programOf(1, 1))).toBe(false);
  expect(
    programShort(documented, [
      { key: 1, evaluators: [{ key: 2 }] },
      { key: 2, evaluators: [{ key: 3 }] },
    ]),
  ).toBe(false);
  expect(programShort(documented, programOf(1))).toBe(true);
  expect(programShort(documented, programOf(1, 0))).toBe(true);
});

test("a document listing no evaluations plans nothing, so no program runs less", () => {
  const planned = programPlanned(creationInitialization);
  expect(planned).toStrictEqual([]);
  expect(programShort(planned, [])).toBe(false);
});

test("a stage may hold no fewer evaluators than its plan stage, and one where it plans none", () => {
  expect(
    [1, 2, 3].map((stage) => programStageLeast(gated, stage)),
  ).toStrictEqual([2, 1, 1]);
  expect(programStageLeast(documented, 2)).toBe(1);
});
