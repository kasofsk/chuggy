/**
 * An approval workload of a version 2 catalog: an evaluator a person answers,
 * which a plan stage lists by name and which is never the work. A release
 * drawing one is ready, and a scheduler reading one to place is told it runs
 * on no runner.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import type { ReleaseAuthoringProgram } from "../../src/contract/authoring.ts";
import {
  canonicalConfigurationOf,
  draftReleaseReadiness,
  draftReleaseRefusalCode,
  releaseConfigurationReadiness,
  ticketConfigurationReadiness,
  type ReleaseConfigurationFault,
  type TicketConfiguration,
} from "../../src/interpreter/authoring.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asBriefCheckLine } from "../../src/interpreter/ticketBrief.ts";
import {
  releasedTicketDefinition,
  ticketDefinitionMaterial,
} from "../../src/interpreter/ticketDefinition.ts";
import {
  approvalWorkloadApprovers,
  selectedFirstCommandsEvaluator,
  type ApprovalWorkload,
} from "../../src/interpreter/workloadConfiguration.ts";
import {
  catalogNamedWorkloadTask,
  pinnedWorkloadTask,
} from "../../src/interpreter/workloadTask.ts";

const claude = { type: "SingleAgent", agent: "Claude", arguments: [] };

const build = {
  runner: "Agent",
  prompt: { text: "Build it." },
  worker: { mode: claude, setup: [], files: [] },
};

/** A catalog whose plans list an approval alone, beside a commanded evaluator, and not at all. */
function catalogOf(approval: object = {}): object {
  return {
    version: 2,
    image: "worker:v2",
    workloads: {
      build,
      tests: { runner: "Commands", commands: ["npm test"] },
      approval: { runner: "Approval", ...approval },
    },
    plans: {
      gated: [
        { name: "checks", evaluators: ["tests", "approval"] },
        { name: "sign-off", evaluators: ["approval"] },
      ],
      ungated: [{ name: "checks", evaluators: ["tests"] }],
      approvalFirst: [{ name: "checks", evaluators: ["approval", "tests"] }],
      approvalOnly: [{ name: "sign-off", evaluators: ["approval"] }],
    },
    defaults: { work: "build", evaluation: "gated" },
  };
}

const repository = asRepositoryId("repository-one");
const brief = { checks: [], repository };
const checkedBrief = {
  checks: [asBriefCheckLine("npm run lint", 0)],
  repository,
};

/** The program a draft of the `gated` plan starts from: every evaluator of both stages. */
const gatedProgram: ReleaseAuthoringProgram = [
  { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
  { key: 2, evaluators: [{ key: 1 }] },
];

/** The ticket a draft releases on, failing the case where it is not ready. */
function ticketOf(
  catalog: object,
  selection?: Parameters<typeof ticketConfigurationReadiness>[3],
  overrides?: ConfigurationOverrides,
): Extract<TicketConfiguration, { readonly version: 2 }> {
  const readiness = ticketConfigurationReadiness(
    canonicalConfigurationOf(catalog),
    brief,
    overrides,
    selection,
  );
  if (readiness.readiness !== "Ready" || readiness.ticket.version !== 2)
    throw new Error(
      `the catalog ticket is not ready: ${JSON.stringify(readiness)}`,
    );
  return readiness.ticket;
}

/** The fault one draft of a catalog is refused at release for, or Ready. */
function releaseFault(
  catalog: object,
  options: {
    readonly selection?: Parameters<typeof draftReleaseReadiness>[4];
    readonly overrides?: ConfigurationOverrides;
    readonly program?: ReleaseAuthoringProgram;
    readonly brief?: typeof checkedBrief;
  } = {},
): ReleaseConfigurationFault | "Ready" {
  const readiness = draftReleaseReadiness(
    canonicalConfigurationOf(catalog),
    options.brief ?? brief,
    undefined,
    options.overrides,
    options.selection,
    options.program,
  );
  return readiness.readiness === "Ready" ? "Ready" : readiness.fault;
}

test("a catalog whose plan stages list an approval, alone or beside another evaluator, reads Ready", () => {
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf(catalogOf()),
  );
  assert.equal(readiness.readiness, "Ready");
});

test("a canonical catalog keeps an approval's approvers and instructions as declared", () => {
  for (const approval of [
    { approvers: "Admin", instructions: "Read the migration.\nThen sign." },
    { approvers: ["5:issuersubject", "5:issuerother"] },
    {},
  ]) {
    const canonical = canonicalConfigurationOf(catalogOf(approval));
    const readiness = releaseConfigurationReadiness(canonical);
    assert.equal(readiness.readiness, "Ready");
    if (
      readiness.readiness !== "Ready" ||
      readiness.configuration.version === 1
    )
      throw new Error("the catalog is not ready");
    assert.deepEqual(readiness.configuration.workloads["approval"], {
      runner: "Approval",
      ...approval,
    });
    assert.equal(canonicalConfigurationOf(JSON.parse(canonical)), canonical);
  }
});

test("an approval is answered by its role or its principals, and by developers where it names none", () => {
  const approverOf = (approval: Omit<ApprovalWorkload, "runner">) =>
    approvalWorkloadApprovers({ runner: "Approval", ...approval });
  assert.equal(approverOf({}), "Developer");
  assert.equal(approverOf({ approvers: "Developer" }), "Developer");
  assert.equal(approverOf({ approvers: "Admin" }), "Admin");
  assert.deepEqual(approverOf({ approvers: ["5:issuersubject"] }), [
    "5:issuersubject",
  ]);
});

test("a catalog whose defaults name an approval as the work is refused, saying so", () => {
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf({
      ...catalogOf(),
      defaults: { work: "approval", evaluation: "gated" },
    }),
  );
  assert.deepEqual(readiness, {
    readiness: "Incomplete",
    fault: "ApprovalAsWork",
  });
});

test("a selection naming an approval as the work is refused at release under its own code", () => {
  const fault = releaseFault(catalogOf(), {
    selection: { work: "approval", evaluation: "ungated" },
  });
  assert.equal(fault, "ApprovalAsWork");
  assert.equal(draftReleaseRefusalCode("ApprovalAsWork"), "ApprovalAsWork");
});

test("a brief's checks join the first commanded evaluator and never an approval", () => {
  const firstCommanded = (evaluation: string) =>
    selectedFirstCommandsEvaluator(
      ticketOf(catalogOf(), { evaluation }).selection,
    );
  assert.deepEqual(firstCommanded("gated"), { stage: 1, evaluator: 1 });
  assert.deepEqual(firstCommanded("approvalFirst"), { stage: 1, evaluator: 2 });
  assert.equal(firstCommanded("approvalOnly"), undefined);
  assert.equal(
    releaseFault(catalogOf(), {
      selection: { evaluation: "approvalOnly" },
      brief: checkedBrief,
    }),
    "BriefChecksUncommanded",
  );
});

test("a ticket's overrides replace an approval's approvers and instructions", () => {
  const ticket = ticketOf(catalogOf({ approvers: "Admin" }), undefined, {
    workloads: {
      approval: {
        approvers: ["5:issuersubject"],
        instructions: "Look at the screenshots.",
      },
    },
  });
  assert.deepEqual(ticket.configuration.workloads["approval"], {
    runner: "Approval",
    approvers: ["5:issuersubject"],
    instructions: "Look at the screenshots.",
  });
  const unchanged = ticketOf(catalogOf(), undefined, {
    workloads: { approval: { runner: "Approval", approvers: "Admin" } },
  });
  assert.deepEqual(unchanged.configuration.workloads["approval"], {
    runner: "Approval",
    approvers: "Admin",
  });
});

test("a ticket's overrides may not change a workload's runner to or from Approval", () => {
  for (const workloads of [
    { approval: build },
    { approval: { runner: "Commands" as const, commands: ["true"] } },
    { build: { runner: "Approval" as const } },
    { tests: { runner: "Approval" as const } },
  ]) {
    const fault = releaseFault(catalogOf(), {
      overrides: { workloads } as ConfigurationOverrides,
    });
    assert.equal(
      fault,
      "OverridesChangeApprovalRunner",
      JSON.stringify(workloads),
    );
    assert.equal(
      draftReleaseRefusalCode("OverridesChangeApprovalRunner"),
      "OverridesChangeApprovalRunner",
    );
  }
});

test("a release whose program draws an approval evaluator is ready, as one leaving it out is", () => {
  for (const program of [
    gatedProgram,
    [{ key: 2, evaluators: [{ key: 1 }] }],
    [{ key: 1, evaluators: [{ key: 1 }] }],
  ])
    assert.equal(
      releaseFault(catalogOf(), { program }),
      "Ready",
      JSON.stringify(program),
    );
  assert.equal(
    releaseFault(catalogOf(), {
      selection: { evaluation: "ungated" },
      program: [{ key: 1, evaluators: [{ key: 1 }] }],
    }),
    "Ready",
  );
});

test("an approval evaluator's definition folds its own material, so every reference is positive and its approvers are part of it", () => {
  const definitionOf = (approval: object) => {
    const authoring = {
      deps: new Set<ReturnType<typeof asTicketId>>(),
      prog: gatedProgram,
    };
    return releasedTicketDefinition(
      asTicketId(1),
      authoring,
      ticketDefinitionMaterial({
        authoring,
        ticket: ticketOf(catalogOf(approval)),
      }),
    );
  };
  const evaluatorOf = (approval: object) =>
    definitionOf(approval).evaluationPlan.stages[1]?.evaluators[0]?.task;
  const developers = evaluatorOf({});
  assert.ok(developers !== undefined);
  for (const reference of Object.values(developers)) assert.ok(reference > 0);
  assert.notDeepEqual(evaluatorOf({ approvers: "Admin" }), developers);
  assert.notDeepEqual(
    evaluatorOf({ approvers: ["5:issuersubject"] }),
    developers,
  );
  assert.notDeepEqual(
    evaluatorOf({ instructions: "Look closely." }),
    developers,
  );
  assert.deepEqual(
    definitionOf({ approvers: "Admin" }).evaluationPlan.stages[0]
      ?.evaluators[0],
    definitionOf({}).evaluationPlan.stages[0]?.evaluators[0],
  );
});

test("a scheduler reading an approval evaluator's task is told it is not runnable, and its name still resolves", () => {
  const catalog = catalogOf();
  const position = { taskKind: "Evaluation", stage: 1, evaluator: 1 } as const;
  assert.deepEqual(
    pinnedWorkloadTask(
      catalog,
      { configurationRevision: "revision-1", configurationDigest: "digest-1" },
      undefined,
      undefined,
      position,
    ),
    { read: "Incompatible", fault: "ApprovalNotRunnable" },
  );
  assert.deepEqual(
    catalogNamedWorkloadTask(catalog, undefined, undefined, position),
    {
      name: "approval",
      workload: { runner: "Approval" },
      stage: "sign-off",
      ticketChecks: false,
    },
  );
});
