/**
 * A catalog ticket's own evaluation: plans its overrides replace or add,
 * evaluators they add, and what of either needs the permit to run less.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configurationWithOverrides,
  overridesPlanShort,
  type ConfigurationOverrides,
} from "../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../src/contract/configurationSelection.ts";
import {
  canonicalConfigurationOf,
  draftReleaseReadiness,
  ticketConfigurationReadiness,
  ticketRunsLessThanPlanned,
} from "../../src/interpreter/authoring.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { handoffApprovalRequired } from "../../src/interpreter/finalizerPreparation.ts";
import { catalogSelectedFinalizer } from "../../src/interpreter/workloadConfiguration.ts";
import { catalogNamedWorkloadTask } from "../../src/interpreter/workloadTask.ts";

const claude = {
  type: "SingleAgent" as const,
  agent: "Claude" as const,
  arguments: [],
};

function agent(prompt: string) {
  return {
    runner: "Agent" as const,
    prompt: { text: prompt },
    worker: { mode: claude, setup: [], files: [] },
  };
}

const catalog = {
  version: 2,
  image: "worker:v2",
  workloads: {
    build: agent("Build it."),
    review: agent("Review it."),
    tests: { runner: "Commands", commands: ["npm test"] },
    approval: { runner: "Approval" },
  },
  plans: {
    standard: [
      { name: "checks", evaluators: ["tests"] },
      { name: "review", evaluators: ["review"] },
    ],
    light: [{ name: "checks", evaluators: ["tests"] }],
  },
  defaults: { work: "build", evaluation: "standard" },
};

const canonical = canonicalConfigurationOf(catalog);
const brief = { checks: [], repository: asRepositoryId("repository-one") };

const approvalOnly: ConfigurationOverrides = {
  plans: { gate: [{ name: "approval", evaluators: ["approval"] }] },
};

const signOff = {
  runner: "Approval",
  approvers: "Admin",
  instructions: "Read the diff.",
} as const;

function programOf(stages: readonly (readonly number[])[]) {
  return stages.map((evaluators, index) => ({
    key: index + 1,
    evaluators: evaluators.map((key) => ({ key })),
  }));
}

function readyTicket(
  overrides: ConfigurationOverrides | undefined,
  selection: ConfigurationSelection | undefined,
) {
  const readiness = ticketConfigurationReadiness(
    canonical,
    brief,
    overrides,
    selection,
  );
  if (readiness.readiness !== "Ready" || readiness.ticket.version !== 2)
    throw new Error(`not ready: ${JSON.stringify(readiness)}`);
  return readiness.ticket;
}

function faultOf(
  overrides: ConfigurationOverrides | undefined,
  selection?: ConfigurationSelection,
): string {
  const readiness = draftReleaseReadiness(
    canonical,
    brief,
    undefined,
    overrides,
    selection,
  );
  return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
}

function stageNames(
  ticket: ReturnType<typeof readyTicket>,
): readonly (readonly string[])[] {
  return ticket.selection.plan.stages.map((stage) =>
    stage.evaluators.map((evaluator) => evaluator.name),
  );
}

test("a plan an override adds is selectable by its name, and one it names as the catalog's replaces that plan whole", () => {
  assert.deepEqual(
    stageNames(readyTicket(approvalOnly, { evaluation: "gate" })),
    [["approval"]],
  );
  const replaced = readyTicket(
    { plans: { standard: [{ name: "all", evaluators: ["review", "tests"] }] } },
    undefined,
  );
  assert.deepEqual(stageNames(replaced), [["review", "tests"]]);
  assert.deepEqual(
    stageNames(readyTicket(approvalOnly, undefined)),
    [["tests"], ["review"]],
    "a plan added beside the default leaves the default selected",
  );
  assert.deepEqual(
    stageNames(readyTicket(approvalOnly, { evaluation: "light" })),
    [["tests"]],
  );
});

test("an evaluator an override adds, written whole, runs where its plan places it, an approval among them", () => {
  const overrides: ConfigurationOverrides = {
    workloads: { "sign-off": signOff },
    plans: { gate: [{ name: "approval", evaluators: ["sign-off"] }] },
  };
  const ticket = readyTicket(overrides, { evaluation: "gate" });
  assert.deepEqual(ticket.selection.plan.stages[0]?.evaluators[0], {
    name: "sign-off",
    workload: signOff,
  });
  assert.deepEqual(
    catalogNamedWorkloadTask(
      JSON.parse(canonical),
      overrides,
      { evaluation: "gate" },
      { taskKind: "Evaluation", stage: 0, evaluator: 1 },
    ),
    {
      name: "sign-off",
      workload: signOff,
      stage: "approval",
      ticketChecks: false,
    },
    "a task is read back from the plan the overrides make",
  );
});

test("an evaluator an override adds is never the work, and one the catalog holds still keeps its runner's side of an approval", () => {
  assert.equal(
    faultOf(
      { workloads: { spike: agent("Try it.") }, ...approvalOnly },
      { work: "spike" },
    ),
    "OverridesUnknown",
    "added, named by no plan",
  );
  assert.equal(
    faultOf(
      {
        workloads: { spike: agent("Try it.") },
        plans: { gate: [{ name: "spike", evaluators: ["spike"] }] },
      },
      { work: "spike" },
    ),
    "SelectionUnknown",
  );
  assert.equal(
    faultOf({ workloads: { review: { runner: "Approval" } } }),
    "OverridesChangeApprovalRunner",
  );
  assert.equal(
    faultOf({ workloads: { approval: { runner: "Commands" } } }),
    "OverridesChangeApprovalRunner",
  );
});

test("overrides naming a workload neither the catalog nor they hold, or adding one no plan names, are refused as unknown", () => {
  assert.equal(
    faultOf({ plans: { gate: [{ name: "x", evaluators: ["absent"] }] } }),
    "OverridesUnknown",
  );
  assert.equal(
    faultOf({ workloads: { reviw: { practices: [] } } }),
    "OverridesUnknown",
  );
});

test("an evaluator an override adds that is not a whole workload leaves the ticket unready", () => {
  assert.equal(
    faultOf({
      workloads: { lint: { runner: "Commands" } },
      plans: { standard: [{ name: "lint", evaluators: ["lint"] }] },
    }),
    "ReleaseShapeInvalid",
  );
});

test("nothing adds plans to a document, which holds none", () => {
  const document = { version: 1, image: "worker:v1" };
  assert.deepEqual(
    configurationWithOverrides(document, approvalOnly),
    document,
  );
});

test("a ticket runs less than planned where its overrides' plan runs some workload at fewer positions than the catalog's plan for its selection, or its default", () => {
  const less = (
    overrides: ConfigurationOverrides | undefined,
    selection: ConfigurationSelection | undefined,
    stages: readonly (readonly number[])[],
  ) =>
    ticketRunsLessThanPlanned(
      canonical,
      overrides,
      selection,
      readyTicket(overrides, selection),
      programOf(stages),
    );
  assert.equal(
    less(approvalOnly, { evaluation: "gate" }, [[1]]),
    true,
    "a plan only the override names is held to the catalog's default",
  );
  assert.equal(
    less(
      { plans: { light: [{ name: "a", evaluators: ["approval"] }] } },
      { evaluation: "light" },
      [[1]],
    ),
    true,
    "a replaced plan is held to the catalog's plan of that name",
  );
  assert.equal(
    less(
      { plans: { light: [{ name: "a", evaluators: ["tests", "approval"] }] } },
      { evaluation: "light" },
      [[1, 2]],
    ),
    false,
    "running more is not less",
  );
  assert.equal(
    less(
      {
        plans: { standard: [{ name: "all", evaluators: ["review", "tests"] }] },
      },
      undefined,
      [[1, 2]],
    ),
    false,
    "moving evaluators between stages is not less",
  );
  assert.equal(
    less(
      {
        plans: { standard: [{ name: "all", evaluators: ["review", "tests"] }] },
      },
      undefined,
      [[1]],
    ),
    true,
    "a program short of the plan the override makes is short as before",
  );
  assert.equal(
    less(undefined, { evaluation: "light" }, [[1]]),
    false,
    "selecting a lighter plan the catalog holds needs no permit",
  );
});

test("a plan runs less than another where some workload stands at more of the other's positions than the program runs it at", () => {
  const all = programOf([[1, 2], [1]]);
  assert.equal(
    overridesPlanShort([["a", "b"], ["a"]], [["a", "b"], ["a"]], all),
    false,
  );
  assert.equal(
    overridesPlanShort([["a", "b"], ["a"]], [["b", "a"], ["c"]], all),
    true,
    "one run of a repeated workload dropped",
  );
  assert.equal(
    overridesPlanShort([["a"]], [["a", "b"], ["a"]], programOf([[2]])),
    true,
    "a program leaving out the planned workload's positions",
  );
  assert.equal(
    overridesPlanShort([["a"]], [["a"]], programOf([[1, 2]])),
    false,
  );
});

test("a program over a plan an override replaces or adds is keyed by position, so the keys overridesPlanShort reads are positions", () => {
  const overrides: ConfigurationOverrides = {
    plans: {
      gate: [
        { name: "checks", evaluators: ["tests"] },
        { name: "approval", evaluators: ["approval"] },
      ],
    },
  };
  const release = (program: ReturnType<typeof programOf>) => {
    const readiness = draftReleaseReadiness(
      canonical,
      brief,
      undefined,
      overrides,
      { evaluation: "gate" },
      program,
    );
    return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
  };
  assert.equal(release(programOf([[1], [1]])), "Ready");
  assert.equal(
    release([{ key: 2, evaluators: [{ key: 1 }] }]),
    "ProgramStageOutOfPosition",
  );
});

test("a selection naming a plan only its overrides define lands with the finalizer, and asks the approval, the catalog's default does", () => {
  const finalizing = {
    ...catalog,
    finalizers: {
      gated: { approvalRequired: true },
      open: { approvalRequired: false },
    },
    defaults: { ...catalog.defaults, finalization: "gated" },
  };
  const gated = canonicalConfigurationOf(finalizing);
  for (const overrides of [
    approvalOnly,
    {
      workloads: { "sign-off": signOff },
      plans: { gate: [{ name: "approval", evaluators: ["sign-off"] }] },
    },
  ]) {
    assert.deepEqual(
      catalogSelectedFinalizer(finalizing, { evaluation: "gate" }, overrides),
      catalogSelectedFinalizer(finalizing, undefined),
    );
    assert.equal(
      handoffApprovalRequired(gated, { evaluation: "gate" }, overrides),
      true,
    );
    assert.equal(
      handoffApprovalRequired(
        gated,
        { evaluation: "gate", finalization: "open" },
        overrides,
      ),
      false,
    );
  }
  assert.equal(
    handoffApprovalRequired(gated, { evaluation: "gate" }),
    undefined,
    "without its overrides the plan is one the catalog does not hold",
  );
});
