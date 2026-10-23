/** A task of a catalog is briefed from the one workload it runs, its prompt verbatim and its framing opt-in. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigurationSelection } from "../../src/contract/configurationSelection.ts";
import type { ConfigurationPin } from "../../src/interpreter/projectDecision.ts";
import {
  taskAuthorityGrant,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
  type BriefingView,
  type TaskInvocation,
  type TaskPurpose,
} from "../../src/interpreter/taskBriefing.ts";
import {
  asBriefCheckLine,
  asDraftBrief,
} from "../../src/interpreter/ticketBrief.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  pinnedWorkloadTask,
  type WorkloadTaskPosition,
} from "../../src/interpreter/workloadTask.ts";

const pin: ConfigurationPin = {
  configurationRevision: "revision-2",
  configurationDigest: "digest-2",
};

const grant: PolicyAuthorityGrant = {
  tools: ["editor", "shell"],
  credentials: ["workspace"],
  network: true,
  filesystem: "WriteWorkspace",
  mayCompleteTask: true,
};

const claude = { type: "SingleAgent", agent: "Claude", arguments: [] };
const workPrompt = "Build what the ticket asks.\n\nKeep the change small.";

/** A catalog whose work is unframed, whose reviewer is framed, and whose plan runs commands first. */
const catalog = {
  version: 2,
  image: "worker:v2",
  workloads: {
    build: {
      runner: "Agent",
      prompt: { text: workPrompt },
      worker: { mode: claude, setup: [], files: [] },
      authority: { network: false },
    },
    review: {
      runner: "Agent",
      purpose: "Review",
      prompt: { text: "Review the change." },
      worker: { mode: claude, setup: [], files: [] },
      framing: "Chuggy",
      brief: {
        motivation: ["A review catches what tests miss."],
        acceptanceCriteria: ["Every finding names a line."],
        constraints: [],
      },
    },
    tests: { runner: "Commands", commands: ["npm test"] },
  },
  plans: {
    standard: [
      { name: "checks", evaluators: ["tests"] },
      { name: "review", evaluators: ["review", "tests"] },
    ],
  },
  defaults: { work: "build", evaluation: "standard" },
};

const ticketBrief = asDraftBrief({
  intent: "Import rows without dropping any.",
  links: [],
  checks: [asBriefCheckLine("npm run lint", 0)],
  repository: asRepositoryId("repository-one"),
});

/** The view one task of the catalog composes from, failing the case where the catalog names no workload for it. */
function viewOf(
  purpose: TaskPurpose,
  position: WorkloadTaskPosition,
  selection?: ConfigurationSelection,
): BriefingView {
  const configuration = pinnedWorkloadTask(catalog, pin, selection, position);
  assert.ok(configuration !== undefined, "the catalog names no such workload");
  return {
    purpose,
    ...(position.taskKind === "Work" ? {} : { stage: position.stage }),
    pin,
    configuration,
    runtime: { changedFiles: [], handoff: [] },
    readOnlyRepositories: [],
    dependencyDeliveries: [],
    priorWorkReports: { reports: [] },
    priorEvaluationReports: { reports: [] },
    brief: ticketBrief,
    grant,
  };
}

function composed(view: BriefingView): TaskInvocation {
  const outcome = composeTaskInvocation(blessedPracticeCatalog, view);
  if (outcome.composed !== "Composed")
    assert.fail(`composition was blocked: ${outcome.fault}`);
  return outcome.invocation;
}

function sectionsOf(invocation: TaskInvocation): readonly string[] {
  return invocation.briefing.sections.map((section) => section.section);
}

test("an unframed work workload leads with its prompt as written and no template wording", () => {
  const invocation = composed(viewOf("Work", { taskKind: "Work" }));
  assert.ok(invocation.briefing.text.startsWith(`${workPrompt}\n\n`));
  assert.deepEqual(sectionsOf(invocation), ["Prompt", "TicketIntent"]);
});

test("a framed workload carries the template's role and result wording and its own brief around its prompt", () => {
  const invocation = composed(
    viewOf("Review", { taskKind: "Evaluation", stage: 1, evaluator: 1 }),
  );
  assert.deepEqual(sectionsOf(invocation), [
    "Prompt",
    "RoleInstructions",
    "TicketIntent",
    "WhyItMatters",
    "AcceptanceAndConstraints",
    "RequiredResult",
  ]);
});

test("the ticket's check lines join the first commanded evaluator of the plan and no other", () => {
  const first = composed(
    viewOf("Check", { taskKind: "Evaluation", stage: 0, evaluator: 1 }),
  );
  const later = composed(
    viewOf("Check", { taskKind: "Evaluation", stage: 1, evaluator: 2 }),
  );
  const lines = (invocation: TaskInvocation) =>
    invocation.worker !== undefined &&
    "mode" in invocation.worker &&
    invocation.worker.mode.type === "Commands"
      ? invocation.worker.mode.commands
      : undefined;
  assert.deepEqual(lines(first), ["npm test", "npm run lint"]);
  assert.deepEqual(lines(later), ["npm test"]);
});

test("a workload narrows by its own authority and by none another workload names", () => {
  const work = composed(viewOf("Work", { taskKind: "Work" }));
  const review = composed(
    viewOf("Review", { taskKind: "Evaluation", stage: 1, evaluator: 1 }),
  );
  assert.equal(taskAuthorityGrant(work.authority).network, false);
  assert.equal(taskAuthorityGrant(review.authority).network, true);
});

test("a position or a selection the catalog does not hold names no workload", () => {
  assert.equal(
    pinnedWorkloadTask(catalog, pin, undefined, {
      taskKind: "Evaluation",
      stage: 2,
      evaluator: 1,
    }),
    undefined,
  );
  assert.equal(
    pinnedWorkloadTask(catalog, pin, { work: "absent" }, { taskKind: "Work" }),
    undefined,
  );
});
