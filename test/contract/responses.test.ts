/**
 * The contract's response schemas, run over the bodies the server's own
 * encoders build.
 *
 * A schema checked against a body this suite wrote would prove only that the
 * suite agrees with itself, so every case starts from `src/adapters/http/
 * outcomes.ts` and parses what it emits.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationResponse,
  configurationsResponse,
  dispatchViewResponse,
  draftInitializationResponse,
  draftResponse,
  executionResponse,
  executionsResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  operationalStatusResponse,
  outputContentResponse,
  projectResponse,
  repositoryConfigurationImportResponse,
  submissionResponse,
  ticketResponse,
} from "../../src/adapters/http/outcomes.ts";
import {
  configurationResponseSchema,
  configurationsResponseSchema,
  dispatchViewResponseSchema,
  draftInitializationResponseSchema,
  draftResponseSchema,
  executionResponseSchema,
  executionsResponseSchema,
  notificationsResponseSchema,
  operationAcceptanceSchema,
  operationResponseSchema,
  operationalStatusResponseSchema,
  outputContentResponseSchema,
  projectInventoryResponseSchema,
  projectResponseSchema,
  repositoryConfigurationRefusalsSchema,
  ticketResponseSchema,
} from "../../src/contract/responses.ts";
import { errorEnvelopeSchema } from "../../src/contract/http.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  asAuthorityKind,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  asAttemptId,
  asClusterId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../src/interpreter/resultManifest.ts";
import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import { workSummaryOutput } from "../../src/interpreter/operationsView.ts";
import type { ExecutionResource } from "../../src/interpreter/operationsView.ts";

const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};
const revision = asConfigurationRevisionId("revision-one");
const digest = "a".repeat(64);
const instant = asPublicInstant("2026-08-26T00:00:00Z");

const authoring = {
  deps: new Set([asTicketId(1)]),
  prog: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
} as const;

const requirement: ExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: "worker:v1",
};

const executionSummary = {
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
} as const;

const execution: ExecutionResource = {
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

test("a project read and a ticket read parse as the contract names them", () => {
  const project = projectResponse({
    result: "Found",
    project: {
      partition,
      sequence: 9,
      tickets: [{ ticket: asTicketId(3), phase: "Working", sequence: 9 }],
      nextAfter: asTicketId(4),
    },
  });
  const parsed = projectResponseSchema.parse(project.body);
  assert.equal(parsed.sequence, 9);
  assert.equal(parsed.nextAfter, 4);
  assert.deepEqual(parsed.tickets[0], {
    ticket: 3,
    phase: "Working",
    sequence: 9,
  });
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({ ticket: asTicketId(3), phase: "Done", sequence: 4 })
        .body,
    ).phase,
    "Done",
  );
});

test("a project inventory page parses with the cursor the server encoded", () => {
  const page = projectInventoryResponseSchema.parse(
    inventoryResponse({ projects: [partition], nextAfter: partition }).body,
  );
  assert.deepEqual(page.projects, [{ tenant: "acme", project: "atlas" }]);
  assert.ok((page.nextCursor ?? "").length > 0);
});

test("the operational status parses every count the scheduler claims", () => {
  const status = operationalStatusResponseSchema.parse(
    operationalStatusResponse({
      result: "Authorized",
      value: {
        observedAt: instant,
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
      },
    }).body,
  );
  assert.equal(status.schedulerFreshness, "Unknown");
  assert.equal(status.accountReservationDeficit, 1);
});

test("an execution page and an execution detail parse with their results", () => {
  const page = executionsResponseSchema.parse(
    executionsResponse({
      result: "Authorized",
      value: {
        executions: [executionSummary],
        nextAfter: asExecutionId("execution-one"),
      },
    }).body,
  );
  assert.equal(page.executions[0]?.status, "Terminal");
  assert.equal(page.nextAfter, "execution-one");
  const detail = executionResponseSchema.parse(
    executionResponse(execution).body,
  );
  assert.equal(detail.attempts[0]?.state, "Reported");
  assert.equal(detail.result?.verdict, "Pass");
  assert.equal(detail.result?.artifacts[0]?.output?.renderer, "Markdown");
  assert.throws(() => executionResponseSchema.parse(page.executions[0]));
});

test("an artifact preview parses as text with the renderer the server chose", () => {
  const content = outputContentResponseSchema.parse(
    outputContentResponse({
      read: "Content",
      mediaType: "text/markdown",
      renderer: "Markdown",
      content: "# summary\n",
    }).body,
  );
  assert.equal(content.content, "# summary\n");
  assert.equal(content.renderer, "Markdown");
});

test("an acceptance and an operation read parse as separate shapes", () => {
  const standing = {
    partition,
    operation: asOperationId("operation-one"),
    ordinal: 1,
    state: "Pending" as const,
    authorityKind: asAuthorityKind("User"),
    admission: "Ordinary" as const,
    lifecycleGeneration: 1,
  };
  const accepted = submissionResponse(partition, {
    result: "Authorized",
    acceptance: { accepted: "Accepted", operation: standing },
  });
  assert.equal(
    operationAcceptanceSchema.parse(accepted.body).operation,
    "operation-one",
  );
  const refused = operationResponseSchema.parse(
    operationResponse({
      operation: asOperationId("operation-one"),
      acceptedAt: asPublicInstant("2026-08-26T00:00:00Z"),
      state: "Refused",
      code: "TicketChanged",
      refusedHead: 4,
      refusedLifecycleGeneration: 1,
    }).body,
  );
  assert.equal(
    refused.state === "Refused" ? refused.code : undefined,
    "TicketChanged",
  );
});

test("a notification batch and a dispatch page parse as the server sends them", () => {
  const batch = notificationsResponseSchema.parse(
    notificationsResponse({
      result: "Authorized",
      value: {
        result: "Events",
        cursor: 4,
        events: [{ ordinal: 4, kind: "Ticket", resource: "3" }],
      },
    }).body,
  );
  assert.equal(
    batch.result === "Events" ? batch.events[0]?.kind : undefined,
    "Ticket",
  );
  const view = dispatchViewResponseSchema.parse(
    dispatchViewResponse({ result: "Authorized", value: { result: "Reset" } })
      .body,
  );
  assert.equal(view.result, "Reset");
});

test("a configuration read and its page parse with readiness and provenance", () => {
  const configuration = configurationResponseSchema.parse(
    configurationResponse({
      partition,
      revision,
      canonical: asCanonicalConfiguration("{}"),
      digest,
    }).body,
  );
  assert.equal(configuration.revision, "revision-one");
  const page = configurationsResponseSchema.parse(
    configurationsResponse({
      result: "Authorized",
      value: {
        partition,
        configurations: [
          {
            revision,
            digest,
            createdAt: instant,
            readiness: "Ready",
            image: "worker:v1",
            practices: ["RegressionCoverage"],
            workInstructionsCount: 2,
            reviewInstructionsCount: 1,
            provenance: { source: "Authored" },
          },
        ],
      },
    }).body,
  );
  assert.equal(page.configurations[0]?.readiness, "Ready");
});

test("a draft and its initialization parse with the authoring the wire carries", () => {
  const draft = draftResponseSchema.parse(
    draftResponse({
      partition,
      ticket: asTicketId(3),
      authoringVersion: 2,
      state: "Draft",
      configurationRevision: revision,
      authoring,
    }).body,
  );
  assert.deepEqual(draft.authoring.dependencies, [1]);
  const initialization = draftInitializationResponseSchema.parse(
    draftInitializationResponse({
      result: "Authorized",
      value: {
        initialized: "Initialized",
        value: {
          configuration: {
            partition,
            revision,
            canonical: asCanonicalConfiguration("{}"),
            digest,
          },
          projectSequence: 9,
          defaults: authoring,
          choices: {
            stages: [{ fanout: 1, combinator: "UnanimousPass" }],
            programStagesMax: 4,
            workFanouts: [1, 2],
            reworkPolicies: [authoring.reworkPolicy],
            finalizationPricings: [authoring.finalizationPricing],
            resumePricings: [authoring.resumePricing],
            finalizers: [authoring.finalizer],
          },
          dependencyCandidates: [asTicketId(1), asTicketId(2)],
          dependencyCandidatesTruncated: false,
        },
      },
    }).body,
  );
  assert.equal(initialization.fence.projectSequence, 9);
  assert.deepEqual(initialization.choices.workFanouts, [1, 2]);
});

test("a repository import refusal parses with the faults it names", () => {
  const refusal = repositoryConfigurationImportResponse({
    result: "DeclarationsRefused",
    faults: [{ path: "declaration", fault: "EnvelopeInvalid" }],
  });
  assert.deepEqual(
    repositoryConfigurationRefusalsSchema.parse(refusal.body).faults,
    [{ path: "declaration", fault: "EnvelopeInvalid" }],
  );
  assert.equal(
    errorEnvelopeSchema.parse({
      error: { code: "NotFound", message: "Resource not found." },
    }).error.code,
    "NotFound",
  );
});

test("a body the contract does not name is a parse failure, not a default", () => {
  assert.throws(() =>
    projectResponseSchema.parse({
      partition,
      sequence: 1,
      tickets: [{ ticket: 1, phase: "Sleeping", sequence: 1 }],
    }),
  );
  assert.throws(() =>
    operationalStatusResponseSchema.parse({
      observedAt: instant,
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
  );
});
