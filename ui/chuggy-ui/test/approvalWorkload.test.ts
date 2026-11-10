/**
 * An Approval workload as each surface of the console shows or authors it:
 * the Catalog page, a ticket's Configuration tab and plan, ticket creation's
 * choices, and the YAML editor. It reads as a person's approval wherever it
 * is shown, by role or by the people it lists, and as nothing an agent or a
 * worker runs. A runner the console does not know reads as unknown.
 */

import { expect, test } from "vitest";

import { approvalRoles } from "../../../src/contract/rosters.ts";
import {
  ticketYamlOf,
  ticketYamlVocabulary,
} from "../app/browser/editor/ticketYaml.ts";
import type { TicketYamlContext } from "../app/browser/editor/ticketYaml.ts";
import { ticketYamlWorkloadUnset } from "../app/browser/editor/ticketYamlWorkloads.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  catalogEntriesOf,
  catalogEntryFields,
  catalogEntrySummary,
} from "../app/core/catalogEntries.ts";
import type { CatalogEntries } from "../app/core/catalogEntries.ts";
import {
  configurationCatalogChoices,
  configurationCatalogInitialization,
  configurationCatalogOf,
} from "../app/core/configurationCatalog.ts";
import type { ConfigurationCatalog } from "../app/core/configurationCatalog.ts";
import { configurationStepsOf } from "../app/core/configurationSteps.ts";
import type { ConfigurationStepRow } from "../app/core/configurationSteps.ts";
import { ticketPlanOf } from "../app/core/ticketPlan.ts";
import { saidEn } from "./saidEn.ts";
import { creationFormFrom } from "../app/core/ticketCreation.ts";
import {
  creationCatalogCanonical,
  creationCatalogOffer,
} from "./ticketCreationFixture.ts";

const principals = ["plain-ada", "plain-bo"];

/** The fixture catalog with an approval workload of each shape, and plans
 * staging them, one before a commands stage. */
const approvalCanonical = (() => {
  const catalog = JSON.parse(creationCatalogCanonical) as {
    workloads: Record<string, unknown>;
    plans: Record<string, unknown>;
  };
  catalog.workloads["signoff"] = { runner: "Approval" };
  catalog.workloads["admins"] = {
    runner: "Approval",
    approvers: "Admin",
    instructions: "Read the release notes.",
  };
  catalog.workloads["people"] = {
    runner: "Approval",
    approvers: principals,
    instructions: "Try it on staging.",
  };
  catalog.workloads["robot"] = {
    runner: "Robot",
    prompt: { text: "Beep." },
    worker: { mode: { type: "SingleAgent", agent: "Claude", arguments: [] } },
  };
  catalog.plans["signed"] = [
    { name: "review", evaluators: ["review"] },
    { name: "sign-off", evaluators: ["signoff"] },
  ];
  catalog.plans["approved"] = [
    { name: "approve", evaluators: ["admins", "people"] },
    { name: "gates", evaluators: ["gates"] },
  ];
  return JSON.stringify(catalog);
})();

function catalogOf(canonical: string): ConfigurationCatalog {
  const catalog = configurationCatalogOf(canonical);
  if (catalog === undefined) throw new Error("no catalog");
  return catalog;
}

const entries: CatalogEntries = catalogEntriesOf(catalogOf(approvalCanonical));

function entryOf(key: string) {
  const entry = entries.byKey.get(key);
  if (entry === undefined) throw new Error(`no ${key}`);
  return entry;
}

const people = "plain-ada, plain-bo";

test("the catalog page sums up an approval as a person's, by role or by the people listed", () => {
  expect(catalogEntrySummary(entryOf("workloads/signoff"), copyTextEn)).toBe(
    "Approval by a person · Any project developer",
  );
  expect(catalogEntrySummary(entryOf("workloads/admins"), copyTextEn)).toBe(
    "Approval by a person · Any project admin",
  );
  expect(catalogEntrySummary(entryOf("workloads/people"), copyTextEn)).toBe(
    `Approval by a person · ${people}`,
  );
});

test("the catalog page lists an approval's runner, who answers, and its instructions only where it has any", () => {
  expect(catalogEntryFields(entryOf("workloads/signoff"), copyTextEn)).toEqual([
    ["Runner", "Approval by a person"],
    ["Answered by", "Any project developer"],
  ]);
  expect(catalogEntryFields(entryOf("workloads/admins"), copyTextEn)).toEqual([
    ["Runner", "Approval by a person"],
    ["Answered by", "Any project admin"],
    ["Instructions", "Read the release notes."],
  ]);
  expect(catalogEntryFields(entryOf("workloads/people"), copyTextEn)).toEqual([
    ["Runner", "Approval by a person"],
    ["Answered by", people],
    ["Instructions", "Try it on staging."],
  ]);
});

test("a plan staging an approval says in its summary that it waits on a person, and one staging none says only its stages", () => {
  expect(catalogEntrySummary(entryOf("plans/signed"), copyTextEn)).toBe(
    "review → sign-off · waits on a person's approval",
  );
  expect(catalogEntrySummary(entryOf("plans/approved"), copyTextEn)).toBe(
    "approve → gates · waits on a person's approval",
  );
  expect(catalogEntrySummary(entryOf("plans/gated"), copyTextEn)).toBe(
    "review → gates",
  );
});

test("a runner the console does not know is shown as unknown, with nothing an agent runs", () => {
  expect(catalogEntrySummary(entryOf("workloads/robot"), copyTextEn)).toBe(
    "Unknown",
  );
  expect(catalogEntryFields(entryOf("workloads/robot"), copyTextEn)).toEqual([
    ["Runner", "Unknown"],
  ]);
  const [robot] = evaluationRows(
    JSON.stringify({
      ...(JSON.parse(approvalCanonical) as object),
      plans: { robotic: [{ name: "robot", evaluators: ["robot"] }] },
      defaults: { work: "build", evaluation: "robotic" },
    }),
    "robotic",
  );
  expect(robot?.runs?.by).toBe("Unknown");
  expect(robot?.model).toBeUndefined();
  expect(robot?.prompt).toEqual([]);
});

function evaluationRows(
  canonical: string,
  evaluation: string,
): readonly ReturnType<typeof saidEn<ConfigurationStepRow>>[] {
  const steps = saidEn(
    configurationStepsOf({
      canonical,
      overrides: undefined,
      selection: { evaluation },
      finalization: undefined,
    }),
  );
  return steps.groups.find((group) => group.phase === "Evaluation")?.rows ?? [];
}

test("the Configuration tab draws an approval stage as a person's, with who answers and its instructions, and no model or prompt", () => {
  const [, signoff] = evaluationRows(approvalCanonical, "signed");
  expect(signoff?.step).toBe("sign-off");
  expect(signoff?.runs).toEqual({
    by: "Approval by a person",
    from: undefined,
    more: 0,
  });
  expect(signoff?.model).toBeUndefined();
  expect(signoff?.prompt).toEqual([]);
  expect(signoff?.details).toEqual([
    {
      name: "Answered by",
      lines: ["Any project developer"],
      code: false,
      overridden: false,
    },
  ]);
  const [approve] = evaluationRows(approvalCanonical, "approved");
  expect(
    approve?.evaluators.map((row) => [
      row.step,
      row.runs?.by,
      row.model,
      row.details.map((detail) => [detail.name, ...detail.lines]),
    ]),
  ).toEqual([
    [
      "admins",
      "Approval by a person",
      undefined,
      [
        ["Answered by", "Any project admin"],
        ["Instructions", "Read the release notes."],
      ],
    ],
    [
      "people",
      "Approval by a person",
      undefined,
      [
        ["Answered by", people],
        ["Instructions", "Try it on staging."],
      ],
    ],
  ]);
});

test("the Configuration tab marks an override of who answers an approval", () => {
  const steps = saidEn(
    configurationStepsOf({
      canonical: approvalCanonical,
      overrides: { workloads: { signoff: { approvers: "Admin" } } },
      selection: { evaluation: "signed" },
      finalization: undefined,
    }),
  );
  const signoff = steps.groups.find((group) => group.phase === "Evaluation")
    ?.rows[1];
  expect(signoff?.overrides).toEqual(["Answered by"]);
  expect(signoff?.details[0]).toEqual({
    name: "Answered by",
    lines: ["Any project admin"],
    code: false,
    overridden: true,
  });
});

test("a ticket's plan names an approval evaluator as a person's approval", () => {
  const plan = ticketPlanOf(
    approvalCanonical,
    { selection: { evaluation: "approved" } },
    copyTextEn,
  );
  expect(plan.stages[0]?.evaluators.map((evaluator) => evaluator.runs)).toEqual(
    ["admins · a person's approval", "people · a person's approval"],
  );
});

test("ticket creation never offers an approval as the work, and its plans say which wait on a person", () => {
  const choices = configurationCatalogChoices(
    catalogOf(approvalCanonical),
    copyTextEn,
  );
  expect(choices.work.map((choice) => choice.value)).toEqual([
    "build",
    "quick",
    "gates",
    "review",
    "robot",
  ]);
  expect(choices.work.find((choice) => choice.value === "robot")?.text).toBe(
    "robot · Unknown",
  );
  expect(choices.evaluation.map((choice) => choice.text)).toEqual([
    "review (default) · review",
    "gated · review → gates",
    "signed · review → sign-off · waits on a person's approval",
    "approved · approve → gates · waits on a person's approval",
  ]);
});

test("an approval evaluator takes no brief's checks, which the commands stage after it still takes", () => {
  const offer = creationCatalogOffer();
  const initialization = {
    ...offer.initialization,
    configuration: {
      ...offer.initialization.configuration,
      canonical: approvalCanonical,
    },
  };
  expect(
    configurationCatalogInitialization(initialization, {
      evaluation: "approved",
    }).commandedCheckStage,
  ).toBe(2);
  expect(
    configurationCatalogInitialization(initialization, { evaluation: "signed" })
      .commandedCheckStage,
  ).toBeUndefined();
});

test("the editor shows an approval only the approvers and instructions it leaves out, in block style", () => {
  const unset = ticketYamlWorkloadUnset({ runner: "Approval" }, copyTextEn);
  expect(unset).toBe(
    [
      " approvers:  # Developer where left out, Admin, or the principals listed",
      "   - <a principal who may answer>",
      " instructions: <what the approver is shown>",
    ].join("\n"),
  );
  expect(unset).not.toMatch(/[[{]/u);
  expect(
    ticketYamlWorkloadUnset(
      { runner: "Approval", approvers: principals, instructions: "Look." },
      copyTextEn,
    ),
  ).toBeUndefined();
  expect(
    ticketYamlWorkloadUnset(
      { runner: "Commands", commands: ["x"] },
      copyTextEn,
    ),
  ).not.toContain("approvers");
});

const catalogContext: TicketYamlContext = (() => {
  const offer = creationCatalogOffer();
  const offers = [
    {
      ...offer,
      initialization: {
        ...offer.initialization,
        configuration: {
          ...offer.initialization.configuration,
          canonical: approvalCanonical,
        },
      },
    },
  ];
  return {
    base: { ...creationFormFrom(offers, []), intent: "" },
    offers,
    repositories: [],
    images: [],
  };
})();

test("the editor writes an approval override's approvers as a block sequence and offers approvals as no runner and no work", () => {
  const form = {
    ...catalogContext.base,
    title: "t",
    intent: "i",
    workloads: { people: { instructions: "Try it on production." } },
  };
  const text = ticketYamlOf(form, catalogContext, copyTextEn);
  expect(text).toContain(
    "  people:\n    runner: Approval\n    approvers:\n      - plain-ada\n      - plain-bo\n    instructions: Try it on production.\n",
  );
  const vocabulary = ticketYamlVocabulary(form, catalogContext, copyTextEn);
  const values = (key: string) =>
    vocabulary
      .find((held) => held.key === key)
      ?.values.map((value) => value.label);
  expect(values("approvers")).toEqual([...approvalRoles]);
  expect(values("instructions")).toEqual([]);
  expect(values("runner")).toEqual(["Agent", "Commands"]);
  expect(values("work")).not.toContain("signoff");
  expect(values("work")).toContain("build");
});
