/**
 * A version 2 configuration: which catalogs are ready, what a ticket's
 * selection resolves to, and what a release of one resolves per evaluator.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { configurationFollowings } from "../../src/contract/configurationDocument.ts";
import { configurationsResponseSchema } from "../../src/contract/responses.ts";
import {
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  configurationRevisionSummary,
  draftInitializationPolicy,
  draftReleaseReadiness,
  releaseConfigurationReadiness,
  ticketCommandedCheckStage,
  ticketConfigurationReadiness,
  ticketProgramShort,
  type ReleaseAuthoring,
  type TicketConfiguration,
} from "../../src/interpreter/authoring.ts";
import { refinementInstance } from "../actor/harness.ts";
import { handoffApprovalRequired } from "../../src/interpreter/finalizerPreparation.ts";
import { catalogSelectedFinalizer } from "../../src/interpreter/workloadConfiguration.ts";
import { asBriefCheckLine } from "../../src/interpreter/ticketBrief.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { configurationRevisionDigest } from "../../src/interpreter/configurationDigest.ts";
import {
  materialDigest,
  releasedTicketDefinition,
  ticketDefinitionMaterial,
  ticketTaskKey,
  ticketTaskMaterialAt,
  ticketTaskRequirement,
  ticketTaskResources,
} from "../../src/interpreter/ticketDefinition.ts";

const claude = { type: "SingleAgent", agent: "Claude", arguments: [] };

/** An agent workload told one prompt and nothing else. */
function agent(prompt: string, extra: object = {}) {
  return {
    runner: "Agent",
    prompt: { text: prompt },
    worker: { mode: claude, setup: [], files: [] },
    ...extra,
  };
}

/** A catalog with two works, two plans and one finalizer. */
const catalog = {
  version: 2,
  image: "worker:v2",
  workloads: {
    build: agent("Build it."),
    spike: agent("Try it.", { image: "worker:spike" }),
    review: agent("Review it.", { resources: { cpus: 2 } }),
    tests: { runner: "Commands", commands: ["npm test"] },
  },
  plans: {
    standard: [{ name: "review", evaluators: ["review"] }],
    thorough: [
      { name: "checks", evaluators: ["tests", "review"] },
      { name: "second", evaluators: ["review"] },
    ],
  },
  finalizers: { gated: { approvalRequired: true } },
  defaults: { work: "build", evaluation: "standard" },
};

const canonical = canonicalConfigurationOf(catalog);
const repository = asRepositoryId("repository-one");
const brief = { checks: [], repository };

/** The ticket a draft selecting `selection` releases on, which the suite asserts is ready. */
function ticketOf(
  selection: Parameters<typeof ticketConfigurationReadiness>[3],
): Extract<TicketConfiguration, { readonly version: 2 }> {
  const readiness = ticketConfigurationReadiness(
    canonical,
    brief,
    undefined,
    selection,
  );
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready" || readiness.ticket.version !== 2)
    throw new Error("the catalog ticket is not ready");
  return readiness.ticket;
}

test("a catalog holding every workload inline and every prompt's text is ready", () => {
  assert.equal(releaseConfigurationReadiness(canonical).readiness, "Ready");
});

test("a catalog is not ready while a workload or a prompt is still named by path, or a name it uses is not one it holds", () => {
  const faultOf = (document: object) => {
    const readiness = releaseConfigurationReadiness(
      canonicalConfigurationOf(document),
    );
    return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
  };
  assert.equal(
    faultOf({
      ...catalog,
      workloads: {
        ...catalog.workloads,
        build: ".chug/configurations/basic-coding.json",
      },
    }),
    "WorkloadUnresolved",
  );
  assert.equal(
    faultOf({
      ...catalog,
      workloads: {
        ...catalog.workloads,
        build: {
          ...agent(""),
          prompt: { path: ".chug/tasks/review-change.md" },
        },
      },
    }),
    "WorkloadUnresolved",
  );
  assert.equal(
    faultOf({
      ...catalog,
      defaults: { work: "absent", evaluation: "standard" },
    }),
    "CatalogNameUnknown",
  );
  assert.equal(
    faultOf({
      ...catalog,
      plans: { standard: [{ name: "review", evaluators: ["absent"] }] },
    }),
    "CatalogNameUnknown",
  );
  assert.equal(
    faultOf({
      ...catalog,
      defaults: { ...catalog.defaults, finalization: "absent" },
    }),
    "CatalogNameUnknown",
  );
});

test("a prompt path outside .chug, or one climbing out of it, is not a catalog's", () => {
  for (const path of [".chug/../secrets", "prompts/build.md", ".chug/tasks/."])
    assert.equal(
      releaseConfigurationReadiness(
        canonicalConfigurationOf({
          ...catalog,
          workloads: {
            ...catalog.workloads,
            build: { ...agent("x"), prompt: { path, text: "x" } },
          },
        }),
      ).readiness,
      "Incomplete",
      path,
    );
});

test("a selection is resolved against the catalog, each absent name the default, and a name it lacks is refused", () => {
  const defaulted = ticketOf(undefined);
  assert.equal(defaulted.selection.work.name, "build");
  assert.equal(defaulted.selection.plan.name, "standard");
  assert.equal(defaulted.selection.finalizer, undefined);
  const chosen = ticketOf({
    work: "spike",
    evaluation: "thorough",
    finalization: "gated",
  });
  assert.equal(chosen.selection.work.name, "spike");
  assert.deepEqual(
    chosen.selection.plan.stages.map((stage) =>
      stage.evaluators.map((entry) => entry.name),
    ),
    [["tests", "review"], ["review"]],
  );
  assert.equal(chosen.selection.finalizer?.finalizer.approvalRequired, true);
  for (const selection of [
    { work: "absent" },
    { evaluation: "absent" },
    { finalization: "absent" },
  ])
    assert.deepEqual(
      draftReleaseReadiness(canonical, brief, undefined, undefined, selection),
      { readiness: "Incomplete", fault: "SelectionUnknown" },
    );
});

test("a catalog takes overrides of its workloads alone, and a document takes no selection and no workload overrides", () => {
  assert.deepEqual(
    draftReleaseReadiness(canonical, brief, undefined, {
      work: { instructions: ["Something else."] },
    }),
    { readiness: "Incomplete", fault: "OverridesUnsupported" },
  );
  const document = canonicalConfigurationOf({
    version: 1,
    image: "worker:v1",
    brief: {
      motivation: ["It matters."],
      acceptanceCriteria: ["It works."],
      constraints: [],
    },
    practices: [],
    work: { instructions: [] },
    review: { instructions: [] },
    worker: { mode: claude, setup: [], files: [] },
  });
  assert.deepEqual(
    draftReleaseReadiness(document, brief, undefined, undefined, {
      work: "build",
    }),
    { readiness: "Incomplete", fault: "SelectionUnsupported" },
  );
  for (const configuration of configurationFollowings)
    assert.deepEqual(
      draftReleaseReadiness(document, brief, undefined, undefined, {
        configuration,
      }),
      { readiness: "Incomplete", fault: "SelectionUnsupported" },
      configuration,
    );
  assert.deepEqual(
    draftReleaseReadiness(document, brief, undefined, {
      workloads: { build: { practices: [] } },
    }),
    { readiness: "Incomplete", fault: "OverridesUnsupported" },
  );
  assert.equal(
    draftReleaseReadiness(document, brief, undefined, undefined, {}).readiness,
    "Ready",
  );
});

test("a catalog ticket runs the workload its overrides make, each field in place of the catalog's", () => {
  const readiness = ticketConfigurationReadiness(
    canonical,
    brief,
    { workloads: { build: { prompt: { text: "Build it twice." } } } },
    undefined,
  );
  if (readiness.readiness !== "Ready" || readiness.ticket.version !== 2)
    throw new Error("the overridden ticket is not ready");
  const work = readiness.ticket.selection.work.workload;
  assert.deepEqual(work.runner === "Agent" ? work.prompt : undefined, {
    text: "Build it twice.",
  });
  assert.deepEqual(
    readiness.ticket.configuration.workloads["spike"],
    ticketOf(undefined).configuration.workloads["spike"],
  );
});

test("overrides naming a workload or a prompt file the catalog does not hold are refused under their own code", () => {
  for (const workloads of [
    { absent: { practices: [] } },
    { build: { prompt: { path: ".chug/configurations/basic-coding.json" } } },
  ])
    assert.deepEqual(
      draftReleaseReadiness(canonical, brief, undefined, { workloads }),
      { readiness: "Incomplete", fault: "OverridesUnknown" },
    );
});

test("overrides that leave a workload unready refuse the release as the catalog would", () => {
  assert.notEqual(
    draftReleaseReadiness(canonical, brief, undefined, {
      workloads: { tests: { runner: "Agent" } },
    }).readiness,
    "Ready",
  );
});

test("a brief's checks join the first evaluator the selected plan runs as commands, and a plan running none refuses them", () => {
  const checked = { ...brief, checks: [asBriefCheckLine("npm run lint", 0)] };
  assert.deepEqual(
    draftReleaseReadiness(canonical, checked, undefined, undefined),
    {
      readiness: "Incomplete",
      fault: "BriefChecksUncommanded",
    },
  );
  assert.equal(
    draftReleaseReadiness(canonical, checked, undefined, undefined, {
      evaluation: "thorough",
    }).readiness,
    "Ready",
  );
  assert.equal(
    ticketCommandedCheckStage(ticketOf({ evaluation: "thorough" })),
    1,
    "the stage is answered by its key, counted from one",
  );
});

test("a program drawing a stage or an evaluator past the selected plan is refused", () => {
  const program = (stages: readonly (readonly number[])[]) =>
    stages.map((evaluators, index) => ({
      key: index + 1,
      evaluators: evaluators.map((key) => ({ key })),
    }));
  const fault = (stages: readonly (readonly number[])[]) => {
    const readiness = draftReleaseReadiness(
      canonical,
      brief,
      undefined,
      undefined,
      { evaluation: "thorough" },
      program(stages),
    );
    return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
  };
  assert.equal(fault([[1, 2], [1]]), "Ready");
  assert.equal(fault([[2]]), "Ready");
  assert.equal(fault([[1, 3]]), "ProgramExceedsPlan");
  assert.equal(fault([[1], [2]]), "ProgramExceedsPlan");
  assert.equal(fault([[1], [1], [1]]), "ProgramExceedsPlan");
});

/** A program whose Nth stage draws the evaluator keys at N. */
function programOf(stages: readonly (readonly number[])[]) {
  return stages.map((evaluators, index) => ({
    key: index + 1,
    evaluators: evaluators.map((key) => ({ key })),
  }));
}

test("a program runs less than its selected plan where it leaves out a stage, or an evaluator of a stage, each alone", () => {
  const short = (stages: readonly (readonly number[])[]) =>
    ticketProgramShort(ticketOf({ evaluation: "thorough" }), programOf(stages));
  assert.equal(short([[1, 2], [1]]), false);
  assert.equal(short([[2, 1], [1]]), false, "in whichever order it lists them");
  assert.equal(short([[1, 2]]), true, "a stage left out");
  assert.equal(short([[2], [1]]), true, "an evaluator left out");
  assert.equal(short([[1, 2], []]), true, "a stage drawn with no evaluator");
  assert.equal(short([]), true);
});

test("a program leaving out the evaluator a brief's checks join is refused under its own fault, short or not", () => {
  const checked = { ...brief, checks: [asBriefCheckLine("npm run lint", 0)] };
  const fault = (
    stages: readonly (readonly number[])[],
    carried: Parameters<typeof draftReleaseReadiness>[1] = checked,
  ) => {
    const readiness = draftReleaseReadiness(
      canonical,
      carried,
      undefined,
      undefined,
      { evaluation: "thorough" },
      programOf(stages),
    );
    return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
  };
  assert.equal(fault([[1, 2], [1]]), "Ready");
  assert.equal(
    fault([[1]]),
    "Ready",
    "a short program running the commanded evaluator runs the checks",
  );
  assert.equal(fault([[2], [1]]), "ProgramSkipsBriefChecks");
  assert.equal(fault([]), "ProgramSkipsBriefChecks");
  assert.equal(
    fault([[2], [1]], brief),
    "Ready",
    "a brief carrying no checks has nothing to leave out",
  );
});

test("a draft starts from the selected plan's stages and every evaluator each holds", () => {
  const policy = draftInitializationPolicy(
    { ...refinementInstance, maxStages: 4, nTasks: 4 },
    ticketOf({ evaluation: "thorough" }),
  );
  assert.deepEqual(policy.defaults.prog, [
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ]);
  assert.equal(policy.choices.programStagesMax, 2);
});

/** The authoring a ticket drawing every evaluator of the thorough plan releases with. */
const thoroughAuthoring: ReleaseAuthoring = {
  deps: new Set(),
  prog: [
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ],
};

test("a catalog release resolves one task per evaluator, each from its own workload", () => {
  const ticket = ticketOf({ work: "spike", evaluation: "thorough" });
  const material = ticketDefinitionMaterial({
    authoring: thoroughAuthoring,
    ticket,
  });
  assert.deepEqual(
    material.tasks.map((task) => task.key),
    ["Work", "Evaluation:1/1", "Evaluation:1/2", "Evaluation:2/1"],
  );
  const work = ticketTaskMaterialAt(material, "Work");
  assert.equal(work.workload.image, "worker:spike");
  assert.equal(work.inputs.digest, materialDigest(catalog.workloads.spike));
  const tests = ticketTaskMaterialAt(material, "Evaluation:1/1");
  const review = ticketTaskMaterialAt(material, "Evaluation:1/2");
  assert.equal(tests.workload.image, "worker:v2");
  assert.equal(review.workload.resources?.cpuMillis, 2_000);
  assert.notEqual(tests.inputs.digest, review.inputs.digest);
  const released = releasedTicketDefinition(
    asTicketId(1),
    thoroughAuthoring,
    material,
  );
  const [first] = released.evaluationPlan.stages;
  assert.notEqual(
    first?.evaluators[0]?.task.inputs,
    first?.evaluators[1]?.task.inputs,
  );
});

test("a stored catalog release is read back per evaluator, and a stored document release per stage", () => {
  const material: unknown = JSON.parse(
    JSON.stringify(
      ticketDefinitionMaterial({
        authoring: thoroughAuthoring,
        ticket: ticketOf({ evaluation: "thorough" }),
      }),
    ),
  );
  const key = ticketTaskKey(material, "Evaluation", 1, 2);
  assert.equal(key, "Evaluation:1/2");
  assert.deepEqual(ticketTaskResources(material, key), { cpuMillis: 2_000 });
  assert.equal(ticketTaskRequirement(material, key).value.mode, "Container");
  const document = { tasks: [{ key: "Evaluation:1" }] };
  assert.equal(ticketTaskKey(document, "Evaluation", 1, 2), "Evaluation:1");
});

test("a catalog asks for approval only where the finalizer its ticket selects does", () => {
  assert.equal(handoffApprovalRequired(canonical), false);
  assert.equal(
    handoffApprovalRequired(canonical, { finalization: "gated" }),
    true,
  );
  assert.equal(
    handoffApprovalRequired(canonical, { finalization: "absent" }),
    undefined,
    "a selection the catalog does not hold is a policy finalization cannot read",
  );
  assert.deepEqual(catalogSelectedFinalizer(catalog, undefined), {});
});

test("a catalog's default revision is Pinned or Latest, and any other is no catalog", () => {
  for (const configuration of configurationFollowings)
    assert.equal(
      releaseConfigurationReadiness(
        canonicalConfigurationOf({
          ...catalog,
          defaults: { ...catalog.defaults, configuration },
        }),
      ).readiness,
      "Ready",
    );
  assert.deepEqual(
    releaseConfigurationReadiness(
      canonicalConfigurationOf({
        ...catalog,
        defaults: { ...catalog.defaults, configuration: "Newest" },
      }),
    ),
    { readiness: "Incomplete", fault: "ReleaseShapeInvalid" },
  );
});

test("the revision a ticket follows is no part of what its release resolves, and a catalog naming none digests as it did", () => {
  const digestOf = (
    selection: Parameters<typeof ticketConfigurationReadiness>[3],
  ) =>
    materialDigest(
      ticketDefinitionMaterial({
        authoring: thoroughAuthoring,
        ticket: ticketOf(selection),
      }),
    );
  const unchosen = digestOf({ evaluation: "thorough" });
  assert.equal(
    unchosen,
    "79e402366fde6e252e89fbd275b93f4b43ae86d7272109e5fea5b25c7c84087f",
  );
  for (const configuration of configurationFollowings)
    assert.equal(
      digestOf({ evaluation: "thorough", configuration }),
      unchosen,
      configuration,
    );
  assert.equal(
    configurationRevisionDigest(canonical),
    "1534185d9edf8ef65ab3c8b7ebb0635697ccc57213f8cf258e47c4b2b6dda35f",
  );
});

test("a configuration summary names the revision its catalog's tickets follow, and none where the catalog names none", () => {
  const defaultsOf = (defaults: object) => {
    const summary = configurationsResponseSchema.parse({
      configurations: [
        configurationRevisionSummary({
          revision: asConfigurationRevisionId("revision"),
          digest: "digest",
          createdAt: asPublicInstant("2026-10-31T12:00:00Z"),
          provenance: { source: "Authored" },
          canonical: canonicalConfigurationOf({ ...catalog, defaults }),
        }),
      ],
    }).configurations[0];
    return summary?.readiness === "Ready"
      ? summary.catalog?.defaults
      : undefined;
  };
  for (const configuration of configurationFollowings)
    assert.deepEqual(defaultsOf({ ...catalog.defaults, configuration }), {
      ...catalog.defaults,
      configuration,
    });
  assert.deepEqual(defaultsOf(catalog.defaults), catalog.defaults);
});
