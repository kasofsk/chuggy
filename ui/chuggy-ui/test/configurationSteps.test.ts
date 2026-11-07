/**
 * A configuration read as the steps a ticket runs: the rows each phase
 * groups, what the Overrides column names, and where the selection's
 * defaults are said.
 */

import { expect, test } from "vitest";

import type { ConfigurationOverrides } from "../../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../../src/contract/configurationSelection.ts";
import { configurationStepsOf } from "../app/core/configurationSteps.ts";
import type {
  ConfigurationStepRow,
  ConfigurationSteps,
} from "../app/core/configurationSteps.ts";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";

function steps(
  overrides?: ConfigurationOverrides,
  selection?: ConfigurationSelection,
  canonical: string = creationCatalogCanonical,
): ConfigurationSteps {
  return configurationStepsOf({
    canonical,
    overrides,
    selection,
    finalization: undefined,
  });
}

function rowsOf(read: ConfigurationSteps, phase: string) {
  const group = read.groups.find((held) => held.phase === phase);
  if (group === undefined) throw new Error(`no ${phase} group`);
  return group.rows;
}

function workRow(read: ConfigurationSteps): ConfigurationStepRow {
  const [work] = rowsOf(read, "Work");
  if (work === undefined) throw new Error("no work row");
  return work;
}

test("a catalog is grouped as its work, its plan's stages in order and its landing", () => {
  const read = steps(undefined, { evaluation: "gated" });
  expect(read.groups.map((group) => group.phase)).toStrictEqual([
    "Work",
    "Evaluation",
    "Finalization",
  ]);
  expect(rowsOf(read, "Work").map((row) => [row.step, row.workload])).toEqual([
    ["Work", "build"],
  ]);
  expect(
    rowsOf(read, "Evaluation").map((row) => [row.step, row.workload]),
  ).toEqual([
    ["review", undefined],
    ["gates", undefined],
  ]);
  expect(rowsOf(read, "Finalization").map((row) => row.step)).toEqual([
    "Landing",
  ]);
});

test("a stage of several evaluators holds a row per evaluator, and a stage of one is that evaluator's row", () => {
  const [review, gates] = rowsOf(
    steps(undefined, { evaluation: "gated" }),
    "Evaluation",
  );
  expect(review?.runs?.by).toBe("2 side by side");
  expect(review?.details).toEqual([]);
  expect(review?.evaluators.map((row) => row.step)).toEqual([
    "review",
    "review",
  ]);
  expect(gates?.evaluators).toEqual([]);
  expect(gates?.runs).toEqual({ by: "Commands", from: "npm test", more: 0 });
  expect(gates?.model).toBeUndefined();
});

test("a version 1 configuration's stages are each named by their place", () => {
  const legacy = JSON.stringify({
    version: 1,
    worker: { mode: { agent: "Claude", arguments: ["--model=sonnet"] } },
    evaluations: [{ checks: ["a", "b", "c"] }, { instructions: ["Review."] }],
  });
  const read = steps(undefined, undefined, legacy);
  expect(read.groups.map((group) => group.phase)).toStrictEqual([
    "Work",
    "Evaluation",
  ]);
  const [checks, review] = rowsOf(read, "Evaluation");
  expect([checks?.step, review?.step]).toEqual(["Stage 1", "Stage 2"]);
  expect(checks?.runs).toEqual({ by: "Commands", from: "a", more: 2 });
  expect(review?.runs?.by).toBe("Claude");
  expect(review?.model).toBe("Sonnet");
});

test("a value the ticket changed is named once in the Overrides column and marked beside it alone", () => {
  const work = workRow(
    steps({ workloads: { build: { resources: { cpus: 4 } } } }),
  );
  expect(work.overrides).toEqual(["4 CPUs"]);
  expect(work.details.filter((detail) => detail.overridden)).toEqual([
    { name: "CPUs", lines: ["4"], code: false, overridden: true },
  ]);
  const single = workRow(
    steps({
      workloads: { build: { resources: { cpus: 1, memoryMib: 2048 } } },
    }),
  );
  expect(single.overrides).toEqual(["1 CPU", "2048 MiB"]);
});

test("an override that drops a resource names it without a count", () => {
  const catalog = JSON.parse(creationCatalogCanonical) as {
    workloads: Record<string, Record<string, unknown>>;
  };
  catalog.workloads["build"] = {
    ...catalog.workloads["build"],
    resources: { cpus: 2, memoryMib: 4096 },
  };
  const work = workRow(
    steps(
      { workloads: { build: { resources: { memoryMib: 8192 } } } },
      undefined,
      JSON.stringify(catalog),
    ),
  );
  expect(work.overrides).toEqual(["CPUs", "8192 MiB"]);
});

test("an override of one workload marks no other step", () => {
  const read = steps(
    { workloads: { gates: { commands: ["npm run gate"] } } },
    { evaluation: "gated" },
  );
  expect(workRow(read).overrides).toEqual([]);
  const [, gates] = rowsOf(read, "Evaluation");
  expect(gates?.overrides).toEqual(["Commands"]);
  expect(gates?.runs?.from).toBe("npm run gate");
});

test("an override that writes the value the catalog already holds marks nothing", () => {
  const work = workRow(
    steps({
      workloads: {
        build: {
          worker: {
            mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
            setup: [],
            files: [],
          },
        },
      },
    }),
  );
  expect(work.overrides).toEqual([]);
  expect(work.details.some((detail) => detail.overridden)).toBe(false);
});

test("a changed model is named as the model, and its arguments are where it is marked", () => {
  const work = workRow(
    steps({
      workloads: {
        build: {
          worker: {
            mode: {
              type: "SingleAgent",
              agent: "Claude",
              arguments: ["--model=opus"],
            },
            setup: [],
            files: [],
          },
        },
      },
    }),
  );
  expect(work.model).toBe("Opus");
  expect(work.overrides).toEqual(["Model"]);
  expect(
    work.details.find((detail) => detail.name === "Arguments"),
  ).toMatchObject({ lines: ["--model=opus"], overridden: true });
});

test("a Codex model the ticket changed is named and marked, though its arguments are the same", () => {
  const work = workRow(
    steps(
      {
        workloads: {
          quick: {
            worker: {
              mode: {
                type: "SingleAgent",
                agent: "Codex",
                arguments: [],
                model: "gpt-5",
              },
              setup: [],
              files: [],
            },
          },
        },
      },
      { work: "quick" },
    ),
  );
  expect(work.overrides).toEqual(["Model"]);
  expect(work.details.filter((detail) => detail.overridden)).toEqual([
    { name: "Model", lines: [work.model], code: false, overridden: true },
  ]);
});

test("an agent the ticket changed is named and marked beside the agent", () => {
  const work = workRow(
    steps({
      workloads: {
        build: {
          worker: {
            mode: {
              type: "SingleAgent",
              agent: "Codex",
              arguments: [],
              model: "gpt-5",
            },
            setup: [],
            files: [],
          },
        },
      },
    }),
  );
  expect(work.overrides).toEqual(["Agent", "Model"]);
  expect(work.details.find((detail) => detail.name === "Agent")).toMatchObject({
    lines: ["Codex"],
    overridden: true,
  });
});

test("a prompt or field the ticket writes back as the catalog holds it marks nothing", () => {
  const [review] = rowsOf(
    steps({
      workloads: {
        review: { prompt: { text: "Review it." }, purpose: "Review" },
      },
    }),
    "Evaluation",
  );
  expect(review?.overrides).toEqual([]);
  expect(review?.prompt.some((part) => part.overridden)).toBe(false);
  expect(review?.details.some((detail) => detail.overridden)).toBe(false);
});

test("a version 1 override that writes the value already there marks nothing", () => {
  const legacy = JSON.stringify({
    version: 1,
    worker: { mode: { agent: "Claude", arguments: [] }, setup: ["npm ci"] },
  });
  const work = workRow(
    steps({ worker: { setup: ["npm ci"] } }, undefined, legacy),
  );
  expect(work.overrides).toEqual([]);
  expect(work.details.some((detail) => detail.overridden)).toBe(false);
});

test("a prompt the ticket replaced is named in the column and marked over the prompt", () => {
  const work = workRow(
    steps({ workloads: { build: { prompt: { text: "Build it twice." } } } }),
  );
  expect(work.overrides).toEqual(["Prompt"]);
  expect(work.prompt).toEqual([
    { heading: undefined, lines: ["Build it twice."], overridden: true },
  ]);
});

test("a version 1 override is named by its field", () => {
  const legacy = JSON.stringify({
    version: 1,
    worker: { mode: { agent: "Claude", arguments: [] }, setup: ["npm ci"] },
  });
  const work = workRow(
    steps(
      { worker: { setup: ["npm ci", "npm run build"] } },
      undefined,
      legacy,
    ),
  );
  expect(work.overrides).toEqual(["Setup"]);
  expect(work.details.find((detail) => detail.name === "Setup")).toMatchObject({
    lines: ["npm ci", "npm run build"],
    overridden: true,
  });
});

test("the selection's default is said in its group, once each, and a choice is said without it", () => {
  const defaulted = steps();
  expect(defaulted.groups.map((group) => group.note)).toEqual([
    "default",
    "plan review · default",
    "finalizer land · default",
  ]);
  const chosen = steps(undefined, {
    work: "quick",
    evaluation: "gated",
    finalization: "approved",
  });
  expect(chosen.groups.map((group) => group.note)).toEqual([
    undefined,
    "plan gated",
    "finalizer approved",
  ]);
  for (const read of [defaulted, chosen])
    for (const group of read.groups)
      for (const row of group.rows)
        expect(row.details.map((detail) => detail.name)).not.toContain(
          "Default",
        );
});

test("a landing a person approves says so, and one that needs no approval says nothing of it", () => {
  const [approved] = rowsOf(
    steps(undefined, { finalization: "approved" }),
    "Finalization",
  );
  expect(approved?.details).toEqual([
    { name: "Approval", lines: ["Required"], code: false, overridden: false },
  ]);
  const [landed] = rowsOf(steps(), "Finalization");
  expect(landed?.details).toEqual([]);
});
