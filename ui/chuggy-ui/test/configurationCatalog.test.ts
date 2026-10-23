/**
 * A catalog's canonical bytes read for the console: what it holds, what a
 * selection runs, and the initialization that selection draws a form under.
 */

import { expect, test } from "vitest";

import {
  configurationCatalogChoices,
  configurationCatalogInitialization,
  configurationCatalogOf,
  configurationCatalogSelected,
  configurationCatalogSelection,
} from "../app/core/configurationCatalog.ts";
import {
  creationCatalogCanonical,
  creationCatalogOffer,
  creationInitialization,
} from "./ticketCreationFixture.ts";

function catalog() {
  const read = configurationCatalogOf(creationCatalogCanonical);
  if (read === undefined) throw new Error("the fixture is a catalog");
  return read;
}

test("a catalog reads as its workloads, plans, finalizers and defaults", () => {
  const read = catalog();
  expect(read.workloads.map((workload) => workload.name)).toStrictEqual([
    "build",
    "quick",
    "gates",
    "review",
  ]);
  expect(read.workloads[0]).toMatchObject({
    runner: "Agent",
    prompt: "Build it.\nTest it.",
    promptPath: "prompts/build.md",
  });
  expect(read.workloads[2]).toMatchObject({
    runner: "Commands",
    model: undefined,
    commands: ["npm test"],
  });
  expect([...read.plans.keys()]).toStrictEqual(["review", "gated"]);
  expect(read.finalizers).toStrictEqual([
    { name: "land", approvalRequired: false },
    { name: "approved", approvalRequired: true },
  ]);
  expect(read.defaults).toStrictEqual({
    work: "build",
    evaluation: "review",
    finalization: "land",
  });
});

test("a version 1 document, and bytes that are no JSON, are no catalog", () => {
  expect(configurationCatalogOf(JSON.stringify({ version: 1 }))).toBe(
    undefined,
  );
  expect(configurationCatalogOf("{")).toBe(undefined);
});

test("a selection runs its defaults where it names nothing, and holds only what differs from them", () => {
  const read = catalog();
  expect(configurationCatalogSelected(read, undefined)).toStrictEqual({
    work: "build",
    evaluation: "review",
    finalization: "land",
  });
  const selected = configurationCatalogSelected(read, {
    work: "quick",
    finalization: "land",
  });
  expect(configurationCatalogSelection(read, selected)).toStrictEqual({
    work: "quick",
  });
});

test("a selected plan draws the program, its length and the stage its commands run in", () => {
  const drawn = configurationCatalogInitialization(
    creationCatalogOffer().initialization,
    { evaluation: "gated" },
  );
  expect(drawn.defaults.program).toStrictEqual([
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ]);
  expect(drawn.choices.programStagesMax).toBe(2);
  expect(drawn.commandedCheckStage).toBe(2);
  const plain = configurationCatalogInitialization(
    creationCatalogOffer().initialization,
    {},
  );
  expect(plain.choices.programStagesMax).toBe(1);
  expect("commandedCheckStage" in plain).toBe(false);
});

test("a selected plan drops the note the server wrote of the plan it read", () => {
  const read = creationCatalogOffer().initialization;
  const drawn = configurationCatalogInitialization(
    { ...read, commandedCheckStageNote: "No stage takes checks." },
    { evaluation: "gated" },
  );
  expect(drawn.commandedCheckStage).toBe(2);
  expect("commandedCheckStageNote" in drawn).toBe(false);
});

test("an initialization whose configuration is no catalog is left as read", () => {
  expect(
    configurationCatalogInitialization(creationInitialization, {
      evaluation: "gated",
    }),
  ).toBe(creationInitialization);
});

test("each choice marks the catalog's default", () => {
  const choices = configurationCatalogChoices(catalog());
  expect(choices.work.map((choice) => choice.text)[0]).toMatch(
    /^build \(default\) · /u,
  );
  expect(choices.evaluation.map((choice) => choice.text)).toStrictEqual([
    "review (default) · review",
    "gated · review → gates",
  ]);
  expect(choices.finalization.map((choice) => choice.value)).toStrictEqual([
    "land",
    "approved",
  ]);
});
