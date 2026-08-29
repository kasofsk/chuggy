/**
 * One interpreter-typed value per public resource, so a suite that needs a
 * response body renders it through `src/adapters/http/outcomes.ts` rather than
 * writing the wire by hand.
 *
 * Two suites need the same values — the response schemas and the stream, which
 * carries those responses — and a fixture written twice would be a body
 * agreeing with itself.
 */

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import type {
  ConfigurationRevisionResource,
  DraftResource,
} from "../../src/interpreter/authoring.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { dispatchViewSchemaVersion } from "../../src/contract/http.ts";
import type { DispatchViewPage } from "../../src/interpreter/dispatchView.ts";
import { asConfigurationVersion } from "../../src/interpreter/repositoryConfigurationIdentity.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";
import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import type {
  ExecutionResource,
  ExecutionSummary,
} from "../../src/interpreter/operationsView.ts";
import type {
  ExecutionRunResource,
  RunTotals,
} from "../../src/interpreter/runEvidence.ts";
import { workSummaryOutput } from "../../src/interpreter/operationsView.ts";
import type { OperationResource } from "../../src/interpreter/nativeWeb.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asClusterId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";

export const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

export const revision = asConfigurationRevisionId("revision-one");
export const digest = "a".repeat(64);
export const instant = asPublicInstant("2026-08-26T00:00:00Z");

export const authoring = {
  deps: new Set([asTicketId(1)]),
  prog: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
} as const;

/** The same authoring as a request body writes it. */
export const authoringWireBody = {
  dependencies: [1],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};

/**
 * The brief a ticket carries, as everything but the wire holds it. It names
 * where its work lands as well as where the work happens, because a
 * finalization no fixture carries is a boundary nothing crosses.
 */
export const brief = asDraftBrief({
  intent: "Serve the brief on the ticket resource.",
  links: ["https://example.test/issues/340"],
  branch: "refs/heads/rt/ticket-brief",
  finalization: { mode: "PullRequest", target: "refs/heads/main" },
});

/** The same brief as a request body writes it. */
export const briefWireBody = {
  intent: "Serve the brief on the ticket resource.",
  links: ["https://example.test/issues/340"],
  branch: "refs/heads/rt/ticket-brief",
  finalization: { mode: "PullRequest", target: "refs/heads/main" },
};

/** A draft authored before a draft carried a brief, which is what an absent one looks like. */
export const draft: DraftResource = {
  partition,
  ticket: asTicketId(3),
  authoringVersion: 2,
  state: "Draft",
  configurationRevision: revision,
  authoring,
};

export const briefedDraft: DraftResource = { ...draft, brief };

export const operation: OperationResource = {
  operation: asOperationId("operation-one"),
  acceptedAt: instant,
  state: "Pending",
};

export const configuration: ConfigurationRevisionResource = {
  partition,
  revision,
  canonical: asCanonicalConfiguration("{}"),
  digest,
};

/** The label a repository-imported revision carries, which an authored one has none of. */
export const configurationVersion = asConfigurationVersion({
  name: "work",
  number: 3,
});

export const versionedConfiguration: ConfigurationRevisionResource = {
  ...configuration,
  version: configurationVersion,
};

export const versionedDraft: DraftResource = { ...draft, configurationVersion };

export const requirement: ExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: "worker:v1",
};

export const executionSummary: ExecutionSummary = {
  execution: asExecutionId("execution-one"),
  ticket: asTicketId(3),
  task: asTaskId(1),
  taskKind: "Work",
  cluster: asClusterId("cluster-one"),
  configurationRevision: revision,
  requirementIdentity: "requirement-one",
  requirement,
  requirementDigest: digest,
  requirementSource: "PlatformDefault",
  platformDefaultVersion: 1,
  status: "Terminal",
  outcome: "Passed",
  retriesSpent: 2,
  registeredAt: instant,
  terminalAt: instant,
};

export const versionedExecutionSummary: ExecutionSummary = {
  ...executionSummary,
  configurationVersion,
};

/** One dispatch page, whose candidate carries the label beside the digested pin. */
export const versionedDispatchViewPage: DispatchViewPage = {
  result: "Page",
  token: {
    ...partition,
    recoveryEpoch: "epoch-one",
    schemaVersion: dispatchViewSchemaVersion,
    watermark: 4,
    digest,
  },
  candidates: [
    {
      ticket: asTicketId(3),
      ticketVersion: 2,
      dependencies: [],
      workFanout: 1,
      program: [{ fanout: 1, combinator: "UnanimousPass" }],
      reworkPolicy: { type: "BudgetedRework", value: 0 },
      finalizationPricing: "DeadlineOnly",
      resumePricing: "RetryCharged",
      finalizer: "ManagedFinalizer",
      configurationRevision: revision,
      configurationDigest: digest,
      configurationCanonical: "{}",
      configurationVersion,
    },
  ],
  notificationCursor: 7,
};

export const execution: ExecutionResource = {
  ...executionSummary,
  attempts: [
    {
      attempt: asAttemptId("attempt-one"),
      number: 1,
      generation: 1,
      state: "Reported",
      openedAt: instant,
      endedAt: instant,
    },
  ],
  result: {
    manifest: asResultManifestId("manifest-one"),
    attempt: asAttemptId("attempt-one"),
    schemaVersion: 1,
    digest: asArtifactDigest(digest),
    verdict: "Pass",
    recordedAt: instant,
    artifacts: [
      {
        ordinal: 0,
        role: "Handoff",
        path: asArtifactPath(".chuggy/outputs/summary.md"),
        digest: asArtifactDigest(digest),
        bytes: 12,
        output: workSummaryOutput,
      },
    ],
  },
};

/** What one run spent, as every rollup and every run row carries it. */
export const runTotals: RunTotals = {
  turns: 4,
  durationMs: 12_000,
  durationApiMs: 9_000,
  tokensInput: 100,
  tokensOutput: 200,
  tokensCacheCreation: 300,
  tokensCacheRead: 400,
  costUsdMicros: 420_000,
  costBasis: "List",
  models: [
    {
      model: "claude-representation",
      tokensInput: 100,
      tokensOutput: 200,
      tokensCacheCreation: 300,
      tokensCacheRead: 400,
      costUsdMicros: 420_000,
    },
  ],
  permissionDenials: 0,
  resultSubtype: "success",
  stopReason: "end_turn",
};

/** One run's evidence, which the attempt that produced it carries. */
export const executionRun: ExecutionRunResource = {
  startedAt: instant,
  configuration: {
    digest: asArtifactDigest(digest),
    bytes: 2_048,
    recordedAt: instant,
  },
  transcript: {
    batches: 3,
    bytes: 4_096,
    highWaterBatch: 3,
    observedAt: instant,
  },
  turnsRecorded: 4,
  totals: runTotals,
};

/** The same execution once its run wrote evidence, which is what a console draws. */
export const evidencedExecution: ExecutionResource = {
  ...execution,
  runTotals,
  attempts: [
    {
      attempt: asAttemptId("attempt-one"),
      number: 1,
      generation: 1,
      state: "Lost",
      openedAt: instant,
      endedAt: instant,
      evidence: "RunRateLimited",
      run: executionRun,
    },
  ],
  ...(execution.result === undefined
    ? {}
    : { result: { ...execution.result, report: "The fixture ran." } }),
};
