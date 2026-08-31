/**
 * The console's DTO parsers, and its copies of the public wire's closed sets.
 *
 * Each roster is held against `src/contract/`, which is where the wire's own
 * copy lives and which `test/contract/rosters.test.ts` in turn holds against
 * the model and the interpreter. Order is part of the claim: `ui/console/app/views.js`
 * builds the board's columns by walking the phase roster, so a roster that
 * agreed as a set and disagreed as a sequence would reorder the board.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as contract from "../../src/contract/rosters.ts";
import {
  artifactRoles,
  attemptStates,
  configurationProvenanceSources,
  configurationReadinesses,
  draftStates,
  evaluationCombinators,
  finalizers,
  dispatchViewResults,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  notificationKinds,
  notificationResults,
  operationRefusalCodes,
  operationStates,
  outputRenderers,
  parseArtifactContent,
  parseConfigurationsPage,
  parseConfiguration,
  parseDraft,
  parseDraftInitialization,
  parseDispatchView,
  parseExecution,
  parseExecutionsPage,
  parseNotifications,
  parseOperation,
  parseOperationalStatus,
  parseProject,
  parseProjectsPage,
  parseRepositoryConfigurationRefusals,
  phaseRoster,
  resumePricings,
  resultVerdicts,
  repositoryConfigurationFaults,
  schedulerFreshnessRoster,
} from "../../ui/console/app/resources.js";
import { populated } from "../interpreter/roster.ts";

/** The console's roster beside the contract's, one pair per closed set. */
const pairs: readonly (readonly [
  string,
  readonly string[],
  readonly string[],
])[] = [
  ["phases", phaseRoster, contract.phaseRoster],
  ["execution statuses", executionStatuses, contract.executionStatuses],
  ["execution outcomes", executionOutcomes, contract.executionOutcomes],
  ["attempt states", attemptStates, contract.attemptStates],
  ["artifact roles", artifactRoles, contract.artifactRoles],
  ["execution task kinds", executionTaskKinds, contract.executionTaskKinds],
  ["output renderers", outputRenderers, contract.outputRenderers],
  ["operation states", operationStates, contract.operationStates],
  [
    "operation refusal codes",
    operationRefusalCodes,
    contract.operationRefusalCodes,
  ],
  ["notification kinds", notificationKinds, contract.notificationKinds],
  ["notification results", notificationResults, contract.notificationResults],
  [
    "scheduler freshness",
    schedulerFreshnessRoster,
    contract.schedulerFreshnesses,
  ],
  ["result verdicts", resultVerdicts, contract.resultVerdicts],
  ["dispatch view results", dispatchViewResults, contract.dispatchViewResults],
  ["draft states", draftStates, contract.draftStates],
  [
    "evaluation combinators",
    evaluationCombinators,
    contract.evaluationCombinators,
  ],
  ["resume pricings", resumePricings, contract.resumePricings],
  ["finalizers", finalizers, contract.finalizers],
  [
    "configuration provenance",
    configurationProvenanceSources,
    contract.configurationProvenanceSources,
  ],
  [
    "configuration readiness",
    configurationReadinesses,
    contract.configurationReadinesses,
  ],
  [
    "repository configuration faults",
    repositoryConfigurationFaults,
    contract.repositoryConfigurationFaults,
  ],
];

test("every roster the console restates is the contract's, in order", () => {
  for (const [named, console_, wire] of populated(pairs, "the roster pairs"))
    assert.deepEqual([...console_], [...wire], named);
});

const authoring = {
  dependencies: [1],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};

test("ticket creation resources retain server defaults and their fence", () => {
  const configuration = {
    partition: { tenant: "acme", project: "atlas" },
    revision: "revision",
    canonical: "{}",
    digest: "a".repeat(64),
  };
  assert.equal(parseConfiguration(configuration).revision, "revision");
  const initialization = parseDraftInitialization({
    configuration,
    fence: { projectSequence: 9, configurationDigest: "a".repeat(64) },
    defaults: authoring,
    choices: {
      stages: authoring.program,
      programStagesMax: 4,
      workFanouts: [1, 2],
      reworkPolicies: [authoring.reworkPolicy],
      finalizationPricings: [authoring.finalizationPricing],
      resumePricings: [authoring.resumePricing],
      finalizers: [authoring.finalizer],
    },
    dependencyCandidates: [1, 2],
    dependencyCandidatesTruncated: false,
  });
  assert.equal(initialization.fence.projectSequence, 9);
  assert.deepEqual(initialization.defaults.dependencies, [1]);
  assert.deepEqual(initialization.choices.workFanouts, [1, 2]);
});

test("draft reads retain editable authoring and lifecycle state", () => {
  const draft = parseDraft({
    partition: { tenant: "acme", project: "atlas" },
    ticket: 3,
    authoringVersion: 2,
    state: "Released",
    configurationRevision: "revision",
    authoring,
  });
  assert.equal(draft.state, "Released");
  assert.equal(draft.authoring.program[0]?.combinator, "UnanimousPass");
  assert.throws(() => parseDraft({ ...draft, state: "Unknown" }), TypeError);
});

test("configuration pages preserve readiness and repository provenance", () => {
  const declarationPath = [".chug", "configurations", "work.json"].join("/");
  const page = parseConfigurationsPage({
    configurations: [
      {
        revision: "repository:commit:work",
        digest: "digest",
        createdAt: "2026-08-24T12:00:00Z",
        readiness: "Ready",
        image: "worker:v1",
        practices: ["RegressionCoverage"],
        workInstructionsCount: 2,
        reviewInstructionsCount: 1,
        provenance: {
          source: "Repository",
          repository: "chuggy",
          commit: "a".repeat(40),
          path: declarationPath,
          name: "work",
        },
      },
      {
        revision: "draft",
        parent: "parent",
        digest: "other-digest",
        createdAt: "2026-08-23T12:00:00Z",
        readiness: "Incomplete",
        provenance: { source: "Authored" },
      },
    ],
    nextCursor: "opaque",
  });
  assert.equal(page.nextCursor, "opaque");
  assert.equal(page.configurations[0]?.readiness, "Ready");
  assert.equal(page.configurations[1]?.readiness, "Incomplete");
  assert.deepEqual(page.configurations[0]?.provenance, {
    source: "Repository",
    repository: "chuggy",
    commit: "a".repeat(40),
    path: declarationPath,
    name: "work",
  });
});

test("repository import refusals retain paths and configuration faults", () => {
  const declarationPath = [".chug", "configurations", "work.json"].join("/");
  assert.deepEqual(
    parseRepositoryConfigurationRefusals({
      error: { code: "RepositoryConfigurationsRefused" },
      faults: [
        {
          path: declarationPath,
          fault: "ConfigurationInvalid",
          configurationFault: "WorkInvalid",
        },
      ],
    }),
    [
      {
        path: declarationPath,
        fault: "ConfigurationInvalid",
        configurationFault: "WorkInvalid",
      },
    ],
  );
});

test("a projects page carries its cursor even when the page is short", () => {
  const page = parseProjectsPage({
    projects: [{ tenant: "acme", project: "atlas" }],
    nextCursor: "abc",
  });
  assert.equal(page.projects.length, 1);
  assert.equal(page.nextCursor, "abc");
});

test("a project read carries the sequence its tickets were observed at", () => {
  const project = parseProject({
    partition: { tenant: "acme", project: "atlas" },
    sequence: 9,
    tickets: [{ ticket: 3, phase: "Working", sequence: 9 }],
  });
  assert.equal(project.sequence, 9);
  assert.deepEqual(project.tickets[0], {
    ticket: 3,
    phase: "Working",
    sequence: 9,
  });
  assert.equal(project.nextAfter, undefined);
});

test("a missing count is a parse failure, not a zero", () => {
  assert.throws(
    () =>
      parseOperationalStatus({
        observedAt: "2026-08-22T00:00:00Z",
        schedulerFreshness: "Unknown",
        queued: 1,
        admitted: 0,
        launching: 0,
        running: 0,
        clusterSlotsMax: 64,
        clusterActive: 0,
        accountMaximum: 8,
        accountActive: 0,
      }),
    TypeError,
  );
});

test("a phase the model does not have is a parse failure", () => {
  assert.throws(
    () =>
      parseProject({
        partition: { tenant: "acme", project: "atlas" },
        sequence: 1,
        tickets: [{ ticket: 1, phase: "Sleeping", sequence: 1 }],
      }),
    TypeError,
  );
});

test("the scheduler's freshness claim is carried through unchanged", () => {
  const status = parseOperationalStatus({
    observedAt: "2026-08-22T00:00:00Z",
    schedulerFreshness: "Unknown",
    queued: 2,
    admitted: 1,
    launching: 0,
    running: 3,
    clusterSlotsMax: 64,
    clusterActive: 4,
    accountMaximum: 8,
    accountActive: 4,
    accountReservationDeficit: 1,
  });
  assert.equal(status.schedulerFreshness, "Unknown");
  assert.equal(status.observedAt, "2026-08-22T00:00:00Z");
  assert.equal(status.accountReservationDeficit, 1);
});

test("a dispatch page carries the version a manual dispatch must echo", () => {
  const page = parseDispatchView({
    result: "Page",
    token: {
      tenant: "acme",
      project: "atlas",
      recoveryEpoch: "e1",
      schemaVersion: 1,
      watermark: 12,
      digest: "d",
    },
    candidates: [
      {
        ticket: 4,
        ticketVersion: 7,
        workFanout: 2,
        configurationRevision: "r1",
      },
    ],
    notificationCursor: 5,
  });
  assert.equal(page.result, "Page");
  assert.equal(
    page.result === "Page" ? page.candidates[0]?.ticketVersion : undefined,
    7,
  );
});

test("a reset dispatch view carries no candidates to act on", () => {
  assert.deepEqual(parseDispatchView({ result: "Reset" }), { result: "Reset" });
});

test("notifications name the resource kind that moved", () => {
  const batch = parseNotifications({
    result: "Events",
    cursor: 4,
    events: [{ ordinal: 4, kind: "Ticket", resource: "3" }],
  });
  assert.equal(batch.cursor, 4);
  assert.equal(
    batch.result === "Events" ? batch.events[0]?.kind : undefined,
    "Ticket",
  );
  assert.deepEqual(parseNotifications({ result: "Reset", cursor: 0 }), {
    result: "Reset",
    cursor: 0,
    events: [],
  });
});

test("a refusal is parsed with its code and nothing else is", () => {
  assert.deepEqual(
    parseOperation({
      operation: "o1",
      state: "Refused",
      code: "TicketChanged",
    }),
    { operation: "o1", state: "Refused", refusalCode: "TicketChanged" },
  );
  assert.equal(
    parseOperation({ operation: "o1", state: "Pending" }).refusalCode,
    undefined,
  );
});

test("an execution carries the scheduler's status and the retries it spent", () => {
  const page = parseExecutionsPage({
    executions: [
      {
        execution: "x1",
        ticket: 3,
        task: 1,
        taskKind: "Work",
        cluster: "c1",
        configurationRevision: "r1",
        status: "Running",
        retriesSpent: 2,
        registeredAt: "2026-08-22T00:00:00Z",
      },
    ],
    nextCursor: "cursor-at-ticket-3-task-1",
  });
  assert.equal(page.executions[0]?.status, "Running");
  assert.equal(page.executions[0]?.retriesSpent, 2);
  assert.equal(page.nextCursor, "cursor-at-ticket-3-task-1");
});

test("an execution detail carries attempts, and a result when one exists", () => {
  const detail = parseExecution({
    execution: "x1",
    ticket: 3,
    task: 1,
    taskKind: "Evaluation",
    stage: 0,
    cluster: "c1",
    configurationRevision: "r1",
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 0,
    registeredAt: "2026-08-22T00:00:00Z",
    terminalAt: "2026-08-22T00:01:00Z",
    attempts: [
      {
        attempt: "a1",
        number: 1,
        generation: 1,
        state: "Reported",
        openedAt: "2026-08-22T00:00:10Z",
      },
    ],
    result: {
      manifest: "m1",
      attempt: "a1",
      schemaVersion: 1,
      digest: "d",
      verdict: "Pass",
      recordedAt: "2026-08-22T00:01:00Z",
      artifacts: [
        {
          ordinal: 0,
          role: "Handoff",
          path: "summary.md",
          digest: "d",
          bytes: 12,
          output: {
            name: "summary",
            path: "summary.md",
            mediaType: "text/markdown",
            renderer: "Markdown",
          },
        },
      ],
    },
  });
  assert.equal(detail.attempts[0]?.state, "Reported");
  assert.equal(detail.result?.artifacts[0]?.renderer, "Markdown");
  assert.equal(detail.outcome, "Passed");
});

test("an artifact with no declared output offers no preview", () => {
  const detail = parseExecution({
    execution: "x1",
    ticket: 3,
    task: 1,
    taskKind: "Work",
    cluster: "c1",
    configurationRevision: "r1",
    status: "Terminal",
    retriesSpent: 0,
    registeredAt: "2026-08-22T00:00:00Z",
    attempts: [],
    result: {
      manifest: "m1",
      attempt: "a1",
      schemaVersion: 1,
      digest: "d",
      verdict: "Fail",
      recordedAt: "2026-08-22T00:01:00Z",
      artifacts: [
        { ordinal: 1, role: "Diagnostic", path: "core", digest: "d", bytes: 4 },
      ],
    },
  });
  assert.equal(detail.result?.artifacts[0]?.renderer, undefined);
});

test("an artifact with no content field is a parse failure, not an empty preview", () => {
  assert.throws(
    () =>
      parseArtifactContent({
        read: "Content",
        mediaType: "text/plain",
        renderer: "Text",
      }),
    TypeError,
  );
  assert.equal(
    parseArtifactContent({
      read: "Content",
      mediaType: "text/plain",
      renderer: "Text",
      content: "",
    }).content,
    "",
  );
});

test("artifact content arrives as text with the renderer the server chose", () => {
  assert.deepEqual(
    parseArtifactContent({
      read: "Content",
      mediaType: "text/x-diff",
      renderer: "UnifiedDiff",
      content: "--- a\n+++ b\n",
    }),
    {
      mediaType: "text/x-diff",
      renderer: "UnifiedDiff",
      content: "--- a\n+++ b\n",
    },
  );
});
