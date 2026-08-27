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

import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";

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
  ticketNativeActionsResponse,
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
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
} from "../../src/contract/responses.ts";
import { authoringSchema } from "../../src/contract/authoring.ts";
import { errorEnvelopeSchema } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  asAuthorityKind,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  authoring,
  authoringWireBody,
  brief,
  briefedDraft,
  configuration,
  digest,
  draft as draftResource,
  execution,
  executionSummary,
  requirement,
  instant,
  partition,
  revision,
} from "./representations.ts";

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

test("an escalated ticket names its wall and an unparked one omits it", () => {
  const escalated = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Escalated",
      sequence: 9,
      reason: "GasExhausted",
    }).body,
  );
  assert.equal(escalated.reason, "GasExhausted");
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({ ticket: asTicketId(3), phase: "Working", sequence: 9 })
        .body,
    ).reason,
    undefined,
  );
  assert.throws(() =>
    ticketResponseSchema.parse({
      ticket: 3,
      phase: "Escalated",
      sequence: 9,
      reason: "NoReason",
    }),
  );
});

test("a ticket's open actions carry a fence and only answers their kind asks for", () => {
  const listed = ticketNativeActionsResponseSchema.parse(
    ticketNativeActionsResponse([
      {
        action: "escalation",
        kind: "TicketEscalation",
        authorizingSequence: 11,
        admits: ["Revoke"],
      },
    ]).body,
  );
  assert.deepEqual(listed.actions, [
    {
      action: "escalation",
      kind: "TicketEscalation",
      authorizingSequence: 11,
      admits: ["Revoke"],
    },
  ]);
  assert.deepEqual(
    ticketNativeActionsResponseSchema.parse(
      ticketNativeActionsResponse([]).body,
    ).actions,
    [],
  );
  assert.throws(() =>
    ticketNativeActionsResponseSchema.parse({
      actions: [
        {
          action: "escalation",
          kind: "TicketEscalation",
          authorizingSequence: 11,
          admits: ["Approve"],
        },
      ],
    }),
  );
  assert.throws(() =>
    ticketNativeActionsResponseSchema.parse({
      actions: [
        {
          action: "escalation",
          kind: "TicketEscalation",
          authorizingSequence: 11,
          admits: [],
        },
      ],
    }),
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

test("an execution names what it ran on, in either mode", () => {
  const page = executionsResponseSchema.parse(
    executionsResponse({
      result: "Authorized",
      value: { executions: [executionSummary] },
    }).body,
  );
  assert.deepEqual(page.executions[0]?.requirement, {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "worker:v1",
  });
  assert.equal(page.executions[0]?.requirementSource, "PlatformDefault");
  assert.equal(page.executions[0]?.requirementIdentity, "requirement-one");
  assert.equal(page.executions[0]?.platformDefaultVersion, 1);
  const native = executionResponseSchema.parse(
    executionResponse({
      ...execution,
      requirement: {
        mode: "Native",
        architecture: "Arm64",
        driver: "XcodeTesting",
        xcodeVersionMin: 16,
        sdkVersionMin: 18,
      },
    }).body,
  );
  assert.equal(
    native.requirement.mode === "Native" && native.requirement.driver,
    "XcodeTesting",
  );
});

/** The page body one execution carrying this requirement would be sent as. */
function pageWithRequirement(value: unknown): unknown {
  return executionsResponse({
    result: "Authorized",
    value: {
      executions: [
        { ...executionSummary, requirement: value as ExecutionRequirement },
      ],
    },
  }).body;
}

test("a requirement carrying a key its mode does not name is refused", () => {
  assert.throws(() =>
    executionsResponseSchema.parse(
      pageWithRequirement({ ...requirement, driver: "XcodeBuild" }),
    ),
  );
  assert.throws(() =>
    executionsResponseSchema.parse(
      pageWithRequirement({
        mode: "Native",
        architecture: "Arm64",
        driver: "XcodeBuild",
        xcodeVersionMin: 16,
        sdkVersionMin: 18,
        image: "worker:v1",
      }),
    ),
  );
  assert.throws(() =>
    executionsResponseSchema.parse(
      executionsResponse({
        result: "Authorized",
        value: {
          executions: [{ ...executionSummary, platformDefaultVersion: 0 }],
        },
      }).body,
    ),
  );
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

/** One Ready summary, so the page case and the label case vary one field of the same value. */
const readyConfiguration = {
  revision,
  digest,
  createdAt: instant,
  readiness: "Ready",
  image: "worker:v1",
  practices: ["RegressionCoverage"],
  workInstructionsCount: 2,
  reviewInstructionsCount: 1,
  provenance: { source: "Authored" },
} as const;

test("a configuration read and its page parse with readiness and provenance", () => {
  const read = configurationResponseSchema.parse(
    configurationResponse(configuration).body,
  );
  assert.equal(read.revision, "revision-one");
  const page = configurationsResponseSchema.parse(
    configurationsResponse({
      result: "Authorized",
      value: {
        partition,
        configurations: [readyConfiguration],
      },
    }).body,
  );
  assert.equal(page.configurations[0]?.readiness, "Ready");
});

test("a worker label rides beside the requirement and the ready image, or is absent", () => {
  const worker = { name: "chuggy-worker", version: "3" };
  const labelled = executionsResponseSchema.parse(
    executionsResponse({
      result: "Authorized",
      value: { executions: [{ ...executionSummary, worker }] },
    }).body,
  );
  assert.deepEqual(labelled.executions[0]?.worker, worker);
  assert.equal(
    executionsResponseSchema.parse(
      executionsResponse({
        result: "Authorized",
        value: { executions: [executionSummary] },
      }).body,
    ).executions[0]?.worker,
    undefined,
  );
  const page = configurationsResponseSchema.parse(
    configurationsResponse({
      result: "Authorized",
      value: {
        partition,
        configurations: [{ ...readyConfiguration, worker }],
      },
    }).body,
  );
  const summary = page.configurations[0];
  assert.deepEqual(
    summary?.readiness === "Ready" ? summary.worker : undefined,
    worker,
  );
});

/** The initialization body the server assembles, which two cases read differently. */
function initializationBody(): Record<string, unknown> {
  return draftInitializationResponse({
    result: "Authorized",
    value: {
      initialized: "Initialized",
      value: {
        configuration,
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
  }).body as Record<string, unknown>;
}

test("a draft and its initialization parse with the authoring the wire carries", () => {
  const draft = draftResponseSchema.parse(draftResponse(draftResource).body);
  assert.deepEqual(draft.authoring.dependencies, [1]);
  const initialization =
    draftInitializationResponseSchema.parse(initializationBody());
  assert.equal(initialization.fence.projectSequence, 9);
  assert.deepEqual(initialization.choices.workFanouts, [1, 2]);
});

test("a hand-assembled read drops an unknown field at every depth", () => {
  const body = draftResponse(draftResource).body as Record<string, unknown>;
  const inner = body["authoring"] as Record<string, unknown>;
  const later = {
    ...body,
    intent: "a sentence #319b adds",
    partition: { ...partition, region: "eu" },
    authoring: {
      ...inner,
      links: ["https://example.invalid/one"],
      reworkPolicy: { type: "BudgetedRework", value: 0, ceiling: 4 },
      program: [{ fanout: 1, combinator: "UnanimousPass", label: "review" }],
    },
  };
  const parsed = draftResponseSchema.parse(later);
  assert.equal(parsed.state, "Draft");
  assert.deepEqual(parsed.authoring.program, [
    { fanout: 1, combinator: "UnanimousPass" },
  ]);
  assert.deepEqual(parsed.partition, { tenant: "acme", project: "atlas" });
  assert.equal(Object.hasOwn(parsed.authoring, "links"), false);
  assert.equal(Object.hasOwn(parsed, "intent"), false);
});

test("the request body is refused for the field a read would have dropped", () => {
  assert.throws(() =>
    authoringSchema.parse({
      ...authoringWireBody,
      links: ["https://example.invalid/one"],
    }),
  );
  assert.throws(() =>
    authoringSchema.parse({
      ...authoringWireBody,
      program: [{ fanout: 1, combinator: "UnanimousPass", label: "review" }],
    }),
  );
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

test("a briefed draft and ticket read carry the brief, and an older one omits it", () => {
  const briefed = draftResponseSchema.parse(draftResponse(briefedDraft).body);
  assert.deepEqual(briefed.brief, {
    intent: "Serve the brief on the ticket resource.",
    links: ["https://example.test/issues/340"],
    branch: "refs/heads/rt/ticket-brief",
  });
  assert.equal(
    draftResponseSchema.parse(draftResponse(draftResource).body).brief,
    undefined,
  );
  const ticket = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Working",
      sequence: 9,
      brief,
    }).body,
  );
  assert.deepEqual(ticket.brief?.links, ["https://example.test/issues/340"]);
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({ ticket: asTicketId(3), phase: "Working", sequence: 9 })
        .body,
    ).brief,
    undefined,
  );
});

test("a draft initialization offers no default brief, an intent having no default", () => {
  const body = initializationBody();
  assert.equal(Object.hasOwn(body, "brief"), false);
  assert.equal(
    Object.hasOwn(body["defaults"] as Record<string, unknown>, "brief"),
    false,
  );
});
