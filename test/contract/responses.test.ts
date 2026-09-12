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
  forgeAppsResponse,
  forgeInstallationClaimResponse,
  forgeInstallationsResponse,
  forgeRepositoriesResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  operationalStatusResponse,
  outputContentResponse,
  projectRepositoriesResponse,
  projectRepositoryBindResponse,
  projectRepositoryCreateResponse,
  projectResponse,
  runConfigurationResponse,
  runTranscriptResponse,
  runTurnsResponse,
  repositoryConfigurationImportResponse,
  selectorProjectSettingsResponse,
  selectorProjectSettingsWriteResponse,
  selectorSettingsHistoryResponse,
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
  draftsResponseSchema,
  executionRequirementSchema,
  executionResponseSchema,
  executionsResponseSchema,
  forgeAppsResponseSchema,
  forgeInstallationClaimedSchema,
  forgeInstallationsResponseSchema,
  forgeRepositoriesResponseSchema,
  notificationsResponseSchema,
  operationAcceptanceSchema,
  operationResponseSchema,
  operationalStatusResponseSchema,
  outputContentResponseSchema,
  projectInventoryResponseSchema,
  projectRepositoriesResponseSchema,
  projectRepositoryAlreadyBoundSchema,
  projectRepositoryBoundSchema,
  projectRepositoryCreatedSchema,
  projectRepositoryLandingConflictSchema,
  projectRepositoryResponseSchema,
  projectResponseSchema,
  repositoryConfigurationRefusalsSchema,
  runConfigurationResponseSchema,
  runTranscriptResponseSchema,
  runTurnsResponseSchema,
  selectorProjectSettingsResponseSchema,
  selectorSettingsConflictResponseSchema,
  selectorSettingsHistoryResponseSchema,
  leadResponseSchema,
  ticketAgenticRefusalsResponseSchema,
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
} from "../../src/contract/responses.ts";
import { authoringSchema } from "../../src/contract/authoring.ts";
import { draftRevisionSchema } from "../../src/contract/requests.ts";
import { projectRepositoryConfigurationDeferrals } from "../../src/contract/rosters.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import type {
  ProjectRepositoryConfigurationsResult,
  ProjectRepositoryCreateResult,
  ProjectRepositoryRulesetResult,
} from "../../src/interpreter/repositoryOnboarding.ts";
import {
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalReasonCharsMax,
  errorEnvelopeSchema,
  forgeInstallationsAnsweredMax,
  forgeRepositoriesAnsweredMax,
  nativeHttpPageItemsMax,
  projectRepositoriesAnsweredMax,
  runModelCharsMax,
  runTranscriptPageBatchesMax,
  selectorHandoffNoteBytesMax,
} from "../../src/contract/http.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeRepositoryName,
} from "../../src/interpreter/forgeInstallation.ts";
import { resolvedSelectorSettings } from "../../src/interpreter/selector.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { parseExecutionCursor } from "../../src/adapters/http/contract.ts";
import {
  authoring,
  authoringWireBody,
  brief,
  briefedDraft,
  configuration,
  configurationVersion,
  digest,
  draft as draftResource,
  evidencedExecution,
  execution,
  executionSummary,
  runTotals,
  requirement,
  instant,
  partition,
  selectorDefaults,
  selectorProjectSettings,
  revision,
  ticketInstants,
  versionedConfiguration,
  versionedDispatchViewPage,
  versionedDraft,
  versionedExecutionSummary,
} from "./representations.ts";

test("a project read and a ticket read parse as the contract names them", () => {
  const project = projectResponse({
    result: "Found",
    project: {
      partition,
      sequence: 9,
      tickets: [
        {
          ticket: asTicketId(3),
          phase: "Working",
          sequence: 9,
          ...ticketInstants,
        },
      ],
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
    releasedAt: ticketInstants.releasedAt,
    changedAt: ticketInstants.changedAt,
  });
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Done",
        sequence: 4,
        ...ticketInstants,
      }).body,
    ).phase,
    "Done",
  );
});

test("a ticket is always dated by its change and may be undated by its release", () => {
  const parsed = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Done",
      sequence: 4,
      ...ticketInstants,
    }).body,
  );
  assert.equal(parsed.releasedAt, ticketInstants.releasedAt);
  assert.equal(parsed.changedAt, ticketInstants.changedAt);
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Done",
        sequence: 4,
        changedAt: ticketInstants.changedAt,
      }).body,
    ).releasedAt,
    undefined,
  );
  assert.throws(() =>
    ticketResponseSchema.parse({
      ticket: 3,
      phase: "Done",
      sequence: 4,
      releasedAt: ticketInstants.releasedAt,
    }),
  );
});

test("an escalated ticket names its wall and an unparked one omits it", () => {
  const escalated = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Escalated",
      sequence: 9,
      reason: "GasExhausted",
      ...ticketInstants,
    }).body,
  );
  assert.equal(escalated.reason, "GasExhausted");
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Working",
        sequence: 9,
        ...ticketInstants,
      }).body,
    ).reason,
    undefined,
  );
  assert.throws(() =>
    ticketResponseSchema.parse({
      ticket: 3,
      phase: "Escalated",
      sequence: 9,
      reason: "NoReason",
      ...ticketInstants,
    }),
  );
});

test("a parked ticket names where a resume re-enters it, and no other does", () => {
  const parked = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Escalated",
      sequence: 9,
      reason: "ReworkBudgetExhausted",
      resumeAt: "ResumeEvaluating",
      ...ticketInstants,
    }).body,
  );
  assert.equal(parked.resumeAt, "ResumeEvaluating");
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Working",
        sequence: 9,
        ...ticketInstants,
      }).body,
    ).resumeAt,
    undefined,
  );
  assert.throws(() =>
    ticketResponseSchema.parse({
      ticket: 3,
      phase: "Escalated",
      sequence: 9,
      resumeAt: "NoResume",
    }),
  );
});

test("a ticket carries the accounts it has left, and an unbudgeted one no figure", () => {
  const accounted = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Escalated",
      sequence: 9,
      accounts: {
        gasLeft: 1,
        gasMax: 3,
        reworkLeft: 0,
        finalizationLeft: 1,
      },
      ...ticketInstants,
    }).body,
  );
  assert.deepEqual(accounted.accounts, {
    gasLeft: 1,
    gasMax: 3,
    reworkLeft: 0,
    finalizationLeft: 1,
  });
  const deadlinePriced = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Working",
      sequence: 9,
      accounts: { gasLeft: 2, gasMax: 3, reworkLeft: 1 },
      ...ticketInstants,
    }).body,
  );
  assert.equal(deadlinePriced.accounts?.finalizationLeft, undefined);
  assert.equal(deadlinePriced.accounts?.gasMax, 3);
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Working",
        sequence: 9,
        ...ticketInstants,
      }).body,
    ).accounts,
    undefined,
  );
  assert.throws(() =>
    ticketResponseSchema.parse({
      ticket: 3,
      phase: "Working",
      sequence: 9,
      accounts: { gasLeft: -1, gasMax: 3, reworkLeft: 1 },
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

test("a project's selector settings parse as its overrides beside what they resolve to", () => {
  const parsed = selectorProjectSettingsResponseSchema.parse(
    selectorProjectSettingsResponse({
      result: "Found",
      settings: selectorProjectSettings,
    }).body,
  );
  assert.deepEqual(parsed.partition, { tenant: "acme", project: "atlas" });
  assert.equal(parsed.revision, 2);
  assert.equal(parsed.overrides.northStar, "Ship the console.");
  assert.equal(parsed.effective.northStar, "Ship the console.");
  assert.equal(parsed.effective.basePrompt, selectorDefaults.basePrompt);
  assert.equal(parsed.effective.projectRevision, 2);
  assert.equal(
    parsed.effective.limits.concurrentDecisions,
    selectorDefaults.limits.concurrentDecisions,
  );
});

test("a project pause and an installation pause are not the same body", () => {
  const body = (installation: "Running" | "Paused") =>
    selectorProjectSettingsResponse({
      result: "Found",
      settings: {
        partition,
        revision: 2,
        overrides: { mode: "Paused" },
        effective: resolvedSelectorSettings(
          partition,
          { ...selectorDefaults, mode: installation },
          2,
          { mode: "Paused" },
        ),
      },
    }).body;
  const stopped = selectorProjectSettingsResponseSchema.parse(body("Paused"));
  const theirs = selectorProjectSettingsResponseSchema.parse(body("Running"));
  assert.equal(stopped.effective.mode, "Paused");
  assert.equal(theirs.effective.mode, "Paused");
  assert.equal(stopped.effective.installationMode, "Paused");
  assert.equal(theirs.effective.installationMode, "Running");
  assert.notDeepEqual(body("Paused"), body("Running"));
});

test("a settings write that lost its fence answers a conflict carrying the current row", () => {
  const conflict = selectorProjectSettingsWriteResponse({
    result: "Conflict",
    settings: selectorProjectSettings,
  });
  assert.equal(conflict.status, 409);
  const body = conflict.body as { settings: unknown };
  assert.equal(
    selectorProjectSettingsResponseSchema.parse(body.settings).revision,
    2,
  );
  assert.equal(
    selectorProjectSettingsWriteResponse({
      result: "Written",
      settings: selectorProjectSettings,
    }).status,
    200,
  );
});

/** The number alone does not say whose write to reload, so the body names them. */
test("a conflict body names the administrator of the revision now standing", () => {
  const movedBy = {
    administrator: {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("someone-else"),
    },
    recordedAt: "2026-09-07T10:00:00.000Z",
  };
  const parsed = selectorSettingsConflictResponseSchema.parse(
    selectorProjectSettingsWriteResponse({
      result: "Conflict",
      settings: selectorProjectSettings,
      movedBy,
    }).body,
  );
  assert.deepEqual(parsed.movedBy, movedBy);
  assert.equal(parsed.settings.revision, 2);
  assert.equal(
    selectorSettingsConflictResponseSchema.parse(
      selectorProjectSettingsWriteResponse({
        result: "Conflict",
        settings: selectorProjectSettings,
      }).body,
    ).movedBy,
    undefined,
  );
});

test("the settings history parses every retained override and its administrator", () => {
  const parsed = selectorSettingsHistoryResponseSchema.parse(
    selectorSettingsHistoryResponse({
      result: "Found",
      revisions: [
        {
          revision: 2,
          overrides: { northStar: "Ship the console." },
          administrator: {
            kind: asAuthorityKind("User"),
            subject: asAuthoritySubject("selector-admin"),
          },
          recordedAt: instant,
        },
      ],
    }).body,
  );
  assert.equal(parsed.revisions[0]?.administrator.subject, "selector-admin");
  assert.equal(parsed.revisions[0]?.overrides.northStar, "Ship the console.");
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
    executionsResponse(partition, {
      result: "Authorized",
      value: {
        executions: [executionSummary],
        nextAfter: { ticket: asTicketId(21), task: asTaskId(8) },
      },
    }).body,
  );
  assert.equal(page.executions[0]?.status, "Terminal");
  assert.equal(page.executions[0]?.request, "request-one");
  assert.deepEqual(parseExecutionCursor(page.nextCursor ?? "", partition), {
    ticket: 21,
    task: 8,
  });
  const detail = executionResponseSchema.parse(
    executionResponse(execution).body,
  );
  assert.equal(detail.attempts[0]?.state, "Reported");
  assert.equal(detail.result?.verdict, "Pass");
  assert.equal(detail.result?.artifacts[0]?.output?.renderer, "Markdown");
  assert.throws(() => executionResponseSchema.parse(page.executions[0]));
});

/**
 * Both halves of the field's optionality: the row is `NOT NULL` and the
 * interpreter type carries it, so every summary this tree encodes names one,
 * and a bundle reaching a server not yet sending it still reads the page.
 */
test("every encoded summary names its request, and a page without one still reads", () => {
  const body = structuredClone(
    executionsResponse(partition, {
      result: "Authorized",
      value: { executions: [executionSummary] },
    }).body,
  ) as { readonly executions: Record<string, unknown>[] };
  const summary = body.executions[0];
  assert.ok(summary !== undefined);
  assert.equal(summary["request"], "request-one");
  delete summary["request"];
  const older = executionsResponseSchema.parse(body);
  assert.equal(older.executions[0]?.request, undefined);
  assert.equal(older.executions[0]?.status, "Terminal");
});

test("an execution names the image or the toolchain floor it ran on", () => {
  const page = executionsResponseSchema.parse(
    executionsResponse(partition, {
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

/**
 * The requirement the scheduler materializes for a task whose worker names an
 * agent. It reaches the console through the execution page a ticket's cycles
 * are read from.
 */
test("an execution asking the site for a capability parses as one", () => {
  const capability: ExecutionRequirement = {
    mode: "ContainerCapability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Claude"],
  };
  assert.deepEqual(
    executionRequirementSchema.parse(capability as unknown),
    capability,
  );
  const page = executionsResponseSchema.parse(
    executionsResponse(partition, {
      result: "Authorized",
      value: {
        executions: [{ ...executionSummary, requirement: capability }],
      },
    }).body,
  );
  assert.deepEqual(page.executions[0]?.requirement, capability);
});

/** The page body one execution carrying this requirement would be sent as. */
function pageWithRequirement(value: unknown): unknown {
  return executionsResponse(partition, {
    result: "Authorized",
    value: {
      executions: [
        { ...executionSummary, requirement: value as ExecutionRequirement },
      ],
    },
  }).body;
}

test("a requirement naming a mode the wire does not is refused", () => {
  assert.throws(() =>
    executionsResponseSchema.parse(
      pageWithRequirement({
        mode: "ContainerRuntime",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      }),
    ),
  );
});

test("a capability requirement asking for nothing is refused", () => {
  assert.throws(() =>
    executionsResponseSchema.parse(
      pageWithRequirement({
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: [],
      }),
    ),
  );
});

test("a capability outside the vocabulary the wire names is refused", () => {
  assert.throws(() =>
    executionsResponseSchema.parse(
      pageWithRequirement({
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Unnamed"],
      }),
    ),
  );
});

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
      executionsResponse(partition, {
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
  finalization: { approvalRequired: true, handoff: "DirectCommit" },
  evaluationStagesCount: 2,
} as const;

test("a ready configuration names its finalization facts and its evaluation stages", () => {
  const summary = configurationsResponseSchema.parse({
    configurations: [readyConfiguration],
  }).configurations[0];
  assert.deepEqual(summary?.readiness === "Ready" ? summary : undefined, {
    ...readyConfiguration,
  });
  for (const configuration of [
    { ...readyConfiguration, finalization: undefined },
    { ...readyConfiguration, evaluationStagesCount: undefined },
    {
      ...readyConfiguration,
      finalization: { approvalRequired: true, handoff: "PullRequest" },
    },
    {
      ...readyConfiguration,
      finalization: { handoff: "DirectCommit" },
    },
  ])
    assert.throws(
      () =>
        configurationsResponseSchema.parse({ configurations: [configuration] }),
      `a ready summary is refused: ${JSON.stringify(configuration.finalization)}`,
    );
});

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

test("a configuration version reaches every response that names a revision", () => {
  const label = { name: "work", number: 3 };
  assert.deepEqual(
    configurationResponseSchema.parse(
      configurationResponse(versionedConfiguration).body,
    ).version,
    label,
  );
  assert.deepEqual(
    configurationsResponseSchema.parse(
      configurationsResponse({
        result: "Authorized",
        value: {
          partition,
          configurations: [
            {
              revision,
              digest,
              createdAt: instant,
              readiness: "Incomplete",
              provenance: { source: "Authored" },
              version: configurationVersion,
            },
          ],
        },
      }).body,
    ).configurations[0]?.version,
    label,
  );
  assert.deepEqual(
    draftResponseSchema.parse(draftResponse(versionedDraft).body)
      .configurationVersion,
    label,
  );
  assert.deepEqual(
    executionsResponseSchema.parse(
      executionsResponse(partition, {
        result: "Authorized",
        value: { executions: [versionedExecutionSummary] },
      }).body,
    ).executions[0]?.configurationVersion,
    label,
  );
  const view = dispatchViewResponseSchema.parse(
    dispatchViewResponse({
      result: "Authorized",
      value: versionedDispatchViewPage,
    }).body,
  );
  assert.deepEqual(
    view.result === "Page"
      ? view.candidates[0]?.configurationVersion
      : undefined,
    label,
  );
});

test("a revision with no version carries none of the label's fields", () => {
  const read = configurationResponseSchema.parse(
    configurationResponse(configuration).body,
  );
  assert.equal("version" in read, false);
  const drafted = draftResponseSchema.parse(draftResponse(draftResource).body);
  assert.equal("configurationVersion" in drafted, false);
});

test("a worker label rides beside the requirement and the ready image, or is absent", () => {
  const worker = { name: "chuggy-worker", version: "3" };
  const labelled = executionsResponseSchema.parse(
    executionsResponse(partition, {
      result: "Authorized",
      value: { executions: [{ ...executionSummary, worker }] },
    }).body,
  );
  assert.deepEqual(labelled.executions[0]?.worker, worker);
  assert.equal(
    executionsResponseSchema.parse(
      executionsResponse(partition, {
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
    brief: {
      intent: "Land it elsewhere.",
      links: [],
      finalization: { mode: "Push", strategy: "Rebase" },
    },
  };
  const parsed = draftResponseSchema.parse(later);
  assert.equal(parsed.state, "Draft");
  assert.deepEqual(parsed.brief?.finalization, { mode: "Push" });
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
    checks: ["npm test"],
    branch: "refs/heads/rt/ticket-brief",
    finalization: { mode: "PullRequest", target: "refs/heads/main" },
  });
  assert.equal(
    draftResponseSchema.parse(draftResponse(draftResource).body).brief,
    undefined,
  );
  assert.deepEqual(
    draftResponseSchema.parse(
      draftResponse({ ...briefedDraft, brief: { ...brief, checks: [] } }).body,
    ).brief?.checks,
    [],
    "a brief appending nothing answers the empty list rather than omitting it",
  );
  const ticket = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Working",
      sequence: 9,
      brief,
      ...ticketInstants,
    }).body,
  );
  assert.deepEqual(ticket.brief?.links, ["https://example.test/issues/340"]);
  assert.deepEqual(ticket.brief?.checks, ["npm test"]);
  assert.deepEqual(ticket.brief?.finalization, {
    mode: "PullRequest",
    target: "refs/heads/main",
  });
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Working",
        sequence: 9,
        ...ticketInstants,
      }).body,
    ).brief,
    undefined,
  );
});

/**
 * A reader that revises sends back the brief it read, and a revision replaces
 * every list the brief carries, so a list a read dropped is one a revision
 * erases with no refusal to warn anybody.
 */
test("a brief a read answers is a brief a revision may send back unchanged", () => {
  const read = draftResponseSchema.parse(
    draftResponse(briefedDraft).body,
  ).brief;
  assert.ok(read !== undefined);
  const revision = draftRevisionSchema.parse({
    expectedVersion: 2,
    configurationRevision: "revision-one",
    authoring: authoringWireBody,
    brief: read,
  });
  assert.deepEqual(revision.brief.checks, ["npm test"]);
  assert.deepEqual(revision.brief.links, ["https://example.test/issues/340"]);
});

test("a draft initialization offers no default brief, an intent having no default", () => {
  const body = initializationBody();
  assert.equal(Object.hasOwn(body, "brief"), false);
  assert.equal(
    Object.hasOwn(body["defaults"] as Record<string, unknown>, "brief"),
    false,
  );
});

test("a run's evidence rides on the attempt that produced it", () => {
  const detail = executionResponseSchema.parse(
    executionResponse(evidencedExecution).body,
  );
  assert.equal(detail.runTotals?.costUsdMicros, runTotals.costUsdMicros);
  assert.equal(detail.runTotals?.costBasis, "List");
  assert.equal(detail.attempts[0]?.evidence, "RunRateLimited");
  assert.equal(detail.attempts[0]?.run?.transcript?.highWaterBatch, 3);
  assert.equal(detail.attempts[0]?.run?.turnsRecorded, 4);
  assert.equal(
    detail.attempts[0]?.run?.totals?.models[0]?.model,
    "claude-representation",
  );
  assert.equal(detail.result?.report, "The fixture ran.");
});

test("a run that wrote nothing carries neither evidence nor a total", () => {
  const detail = executionResponseSchema.parse(
    executionResponse(execution).body,
  );
  assert.equal(detail.runTotals, undefined);
  assert.equal(detail.attempts[0]?.run, undefined);
  assert.equal(detail.attempts[0]?.evidence, undefined);
  assert.equal(detail.result?.report, undefined);
});

test("a ticket read carries the rollup and an untouched ticket omits it", () => {
  const rolled = ticketResponseSchema.parse(
    ticketResponse({
      ticket: asTicketId(3),
      phase: "Done",
      sequence: 4,
      runTotals,
      ...ticketInstants,
    }).body,
  );
  assert.equal(rolled.runTotals?.turns, runTotals.turns);
  assert.equal(
    ticketResponseSchema.parse(
      ticketResponse({
        ticket: asTicketId(3),
        phase: "Done",
        sequence: 4,
        ...ticketInstants,
      }).body,
    ).runTotals,
    undefined,
  );
});

test("the three run reads parse as the contract names them", () => {
  const page = runTurnsResponseSchema.parse(
    runTurnsResponse({
      turns: [
        {
          ordinal: 1,
          model: "claude-representation",
          tokensInput: 1,
          tokensOutput: 2,
          tokensCacheCreation: 3,
          tokensCacheRead: 4,
          recordedAt: instant,
        },
      ],
      nextAfter: 1,
    }).body,
  );
  assert.equal(page.turns[0]?.ordinal, 1);
  assert.equal(page.nextAfter, 1);
  const transcript = runTranscriptResponseSchema.parse(
    runTranscriptResponse({
      read: "Page",
      page: {
        batches: [
          {
            read: "Content",
            batch: 1,
            recordedAt: instant,
            bytes: 5,
            content: "{}\n",
          },
          { read: "Missing", batch: 2, recordedAt: instant, bytes: 7 },
          { read: "Corrupt", batch: 3, recordedAt: instant, bytes: 9 },
        ],
        observedAt: instant,
        complete: false,
      },
    }).body,
  );
  assert.equal(transcript.complete, false);
  const first = transcript.batches[0];
  assert.equal(first?.read === "Content" ? first.content : undefined, "{}\n");
  assert.deepEqual(
    transcript.batches.map((batch) => batch.read),
    ["Content", "Missing", "Corrupt"],
  );
  const snapshot = runConfigurationResponseSchema.parse(
    runConfigurationResponse({
      read: "Content",
      digest: asArtifactDigest(digest),
      bytes: 2,
      content: "{}",
    }).body,
  );
  assert.equal(snapshot.digest, digest);
  assert.equal(snapshot.content, "{}");
});

test("a run figure past the bound the contract names is refused", () => {
  assert.throws(() =>
    runTurnsResponseSchema.parse(
      runTurnsResponse({
        turns: [
          {
            ordinal: 1,
            model: "m".repeat(runModelCharsMax + 1),
            tokensInput: 0,
            tokensOutput: 0,
            tokensCacheCreation: 0,
            tokensCacheRead: 0,
            recordedAt: instant,
          },
        ],
      }).body,
    ),
  );
  assert.throws(() =>
    runTranscriptResponseSchema.parse(
      runTranscriptResponse({
        read: "Page",
        page: {
          batches: Array.from(
            { length: runTranscriptPageBatchesMax + 1 },
            (_unused, index) =>
              ({
                read: "Content",
                batch: index + 1,
                recordedAt: instant,
                bytes: 0,
                content: "",
              }) as const,
          ),
          observedAt: instant,
          complete: true,
        },
      }).body,
    ),
  );
});

test("a lead read carries the handoff note by size and preview, never inline", () => {
  const lead = {
    session: "lead-atlas",
    state: "Open",
    attention: "Monitoring",
    notificationCursor: 4,
    handoffNote: { bytes: 2, preview: "{}", truncated: false },
    turns: [],
    streams: [],
  };
  assert.equal(leadResponseSchema.parse(lead).session, "lead-atlas");
  assert.throws(() => leadResponseSchema.parse({ ...lead, handoffNote: {} }));
  assert.throws(() =>
    leadResponseSchema.parse({
      ...lead,
      handoffNote: {
        bytes: selectorHandoffNoteBytesMax + 1,
        preview: "{}",
        truncated: true,
      },
    }),
  );
});

test("a refusal ledger refuses a reason longer than its column holds", () => {
  const entry = {
    ordinal: 1,
    event: "Refused",
    ticketVersion: 2,
    reason: "the dependency is still failing",
    decision: "selector-decision-one",
    recordedAt: instant,
  };
  const parsed = ticketAgenticRefusalsResponseSchema.parse({
    ticket: 42,
    entries: [entry],
    more: false,
  });
  assert.equal(parsed.entries[0]?.event, "Refused");
  assert.equal(parsed.standing, undefined);
  assert.equal(parsed.more, false);
  assert.throws(() =>
    ticketAgenticRefusalsResponseSchema.parse({ ticket: 42, entries: [entry] }),
  );
  assert.throws(() =>
    ticketAgenticRefusalsResponseSchema.parse({
      ticket: 42,
      more: true,
      entries: Array.from(
        { length: agenticRefusalLedgerAnsweredMax + 1 },
        () => entry,
      ),
    }),
  );
  assert.throws(() =>
    ticketAgenticRefusalsResponseSchema.parse({
      ticket: 42,
      more: false,
      entries: [
        { ...entry, reason: "x".repeat(agenticRefusalReasonCharsMax + 1) },
      ],
    }),
  );
});

test("a drafts page carries whole drafts, its cursor and whether it ends them", () => {
  const body = draftResponseSchema.parse(draftResponse(draftResource).body);
  assert.deepEqual(
    draftsResponseSchema.parse({
      drafts: [body],
      nextCursor: "Nw",
      more: true,
    }),
    { drafts: [body], nextCursor: "Nw", more: true },
  );
  assert.equal(
    draftsResponseSchema.parse({ drafts: [], more: false }).nextCursor,
    undefined,
  );
  assert.ok(
    Object.hasOwn(draftsResponseSchema.shape, "nextCursor"),
    "a drafts page names its cursor nextCursor",
  );
  assert.ok(
    Object.hasOwn(configurationsResponseSchema.shape, "nextCursor"),
    "a configurations page is the sibling that spelling is copied from",
  );
  assert.throws(() => draftsResponseSchema.parse({ drafts: [body] }));
  assert.throws(() =>
    draftsResponseSchema.parse({
      more: false,
      drafts: Array.from({ length: nativeHttpPageItemsMax + 1 }, () => body),
    }),
  );
  assert.throws(() =>
    draftsResponseSchema.parse({
      more: false,
      drafts: [{ ...body, authoringVersion: -1 }],
    }),
  );
});

const onboardingForge = asForgeId("github");
const onboardingApp = asForgeApp("portal");
const onboardingInstallation = asForgeInstallationId("4242");
const onboardingRepository = asRepositoryId(
  "https://github.com/kasofsk/chuggy.git",
);

/** One installation as the claim route names it, which the listing dates as well. */
const onboardingClaim = {
  forge: onboardingForge,
  app: onboardingApp,
  account: asForgeAccount("kasofsk"),
  accountKind: "Organization" as const,
  installationId: onboardingInstallation,
};

test("what onboarding answers about a forge parses as the contract names it", () => {
  const apps = forgeAppsResponseSchema.parse(
    forgeAppsResponse({
      result: "Apps",
      apps: [
        {
          app: onboardingApp,
          id: "4708055",
          slug: "chuggy-portal",
          installUrl: "https://github.com/apps/chuggy-portal/installations/new",
        },
      ],
    }).body,
  );
  assert.deepEqual(apps.apps[0], {
    app: "portal",
    id: "4708055",
    slug: "chuggy-portal",
    installUrl: "https://github.com/apps/chuggy-portal/installations/new",
  });
  for (const result of ["Claimed", "AlreadyClaimed"] as const)
    assert.deepEqual(
      forgeInstallationClaimedSchema.parse(
        forgeInstallationClaimResponse(partition.tenant, {
          result,
          installation: onboardingClaim,
        }).body,
      ),
      { ...onboardingClaim, installationId: "4242" },
      result,
    );
});

test("a tenant's installations and what one grants say whether they are all of it", () => {
  const installations = forgeInstallationsResponseSchema.parse(
    forgeInstallationsResponse({
      result: "Installations",
      installations: [{ ...onboardingClaim, claimedAt: instant }],
      truncated: true,
    }).body,
  );
  assert.equal(installations.truncated, true);
  assert.deepEqual(installations.installations[0], {
    ...onboardingClaim,
    claimedAt: instant,
  });
  const repositories = forgeRepositoriesResponseSchema.parse(
    forgeRepositoriesResponse({
      result: "Repositories",
      repositories: [
        {
          name: asForgeRepositoryName("chuggy"),
          fullName: "kasofsk/chuggy",
          url: onboardingRepository,
          defaultBranch: "main",
          private: true,
        },
      ],
      truncated: false,
    }).body,
  );
  assert.equal(repositories.truncated, false);
  assert.deepEqual(repositories.repositories[0], {
    name: "chuggy",
    fullName: "kasofsk/chuggy",
    url: onboardingRepository,
    defaultBranch: "main",
    private: true,
  });
});

test("a binding and a project's bindings name the repository and its moment", () => {
  assert.deepEqual(
    projectRepositoryBoundSchema.parse(
      projectRepositoryBindResponse(partition, {
        result: "Bound",
        repository: onboardingRepository,
        landing: { mode: "Push" },
        configurations: { result: "Imported", count: 2 },
      }).body,
    ),
    {
      repository: onboardingRepository,
      landing: { mode: "Push" },
      configurations: { result: "Imported", count: 2 },
    },
  );
  assert.deepEqual(
    projectRepositoryAlreadyBoundSchema.parse(
      projectRepositoryBindResponse(partition, {
        result: "AlreadyBound",
        repository: onboardingRepository,
      }).body,
    ),
    { repository: onboardingRepository },
  );
  const bound = projectRepositoriesResponseSchema.parse(
    projectRepositoriesResponse({
      result: "Repositories",
      repositories: [
        {
          repository: onboardingRepository,
          boundAt: instant,
          landing: { mode: "Push" },
        },
      ],
    }).body,
  );
  assert.deepEqual(bound.repositories[0], {
    repository: onboardingRepository,
    boundAt: instant,
    landing: { mode: "Push" },
  });
});

test("a binding names a landing, and a conflict answers the row that stands", () => {
  const binding = {
    repository: onboardingRepository,
    boundAt: instant,
    landing: { mode: "PullRequest" },
  };
  assert.deepEqual(
    projectRepositoryLandingConflictSchema.parse({ repository: binding }),
    { repository: binding },
  );
  assert.throws(() =>
    projectRepositoryResponseSchema.parse({
      repository: onboardingRepository,
      boundAt: instant,
    }),
  );
  assert.throws(() =>
    projectRepositoryResponseSchema.parse({
      ...binding,
      landing: { mode: "Merge" },
    }),
  );
});

test("each onboarding listing refuses one row past the bound it answers under", () => {
  const installation = { ...onboardingClaim, claimedAt: instant };
  assert.throws(() =>
    forgeInstallationsResponseSchema.parse({
      truncated: true,
      installations: Array.from(
        { length: forgeInstallationsAnsweredMax + 1 },
        () => installation,
      ),
    }),
  );
  const granted = {
    name: "chuggy",
    fullName: "kasofsk/chuggy",
    url: onboardingRepository,
    defaultBranch: "main",
    private: true,
  };
  assert.throws(() =>
    forgeRepositoriesResponseSchema.parse({
      truncated: true,
      repositories: Array.from(
        { length: forgeRepositoriesAnsweredMax + 1 },
        () => granted,
      ),
    }),
  );
  assert.throws(() =>
    projectRepositoriesResponseSchema.parse({
      repositories: Array.from(
        { length: projectRepositoriesAnsweredMax + 1 },
        () => ({ repository: onboardingRepository, boundAt: instant }),
      ),
    }),
  );
});

test("every configuration outcome a bind reports parses as the schema answers it", () => {
  const outcomes: readonly ProjectRepositoryConfigurationsResult[] = [
    { result: "Imported", count: 0 },
    {
      result: "Bootstrapped",
      revision: asConfigurationRevisionId("bootstrap"),
    },
    ...projectRepositoryConfigurationDeferrals.map(
      (reason) => ({ result: "Deferred", reason }) as const,
    ),
  ];
  for (const configurations of outcomes) {
    assert.deepEqual(
      projectRepositoryBoundSchema.parse(
        projectRepositoryBindResponse(partition, {
          result: "Bound",
          repository: onboardingRepository,
          landing: { mode: "Push" },
          configurations,
        }).body,
      ).configurations,
      configurations,
    );
  }
});

/** One created repository as the route answers it, whichever part a case varies. */
function onboardingCreated(
  given: Partial<
    Extract<ProjectRepositoryCreateResult, { readonly result: "Created" }>
  > = {},
): ProjectRepositoryCreateResult {
  return {
    result: "Created",
    repository: onboardingRepository,
    landing: { mode: "Push" },
    created: {
      account: asForgeAccount("kasofsk"),
      name: asForgeRepositoryName("engine"),
      url: onboardingRepository,
    },
    seeded: true,
    ruleset: { result: "Created" },
    configurations: { result: "Imported", count: 1 },
    ...given,
  };
}

test("a created repository names what was made and how far each step got", () => {
  const created = projectRepositoryCreatedSchema.parse(
    projectRepositoryCreateResponse(partition, onboardingCreated()).body,
  );
  assert.deepEqual(created.created, {
    account: "kasofsk",
    name: "engine",
    url: onboardingRepository,
  });
  assert.equal(created.seeded, true);
  assert.deepEqual(created.ruleset, { result: "Created" });
});

/** One object without one of its own fields, which is what each partial is. */
function onboardingWithout(
  whole: Readonly<Record<string, unknown>>,
  absent: string,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(whole).filter(([named]) => named !== absent),
  );
}

/**
 * Every body one field short, named and one level deep. A loop over the top
 * level alone leaves a nested field free to become optional unseen.
 */
function onboardingCreatedPartials(
  body: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] {
  const partials: (readonly [string, unknown])[] = [];
  for (const [named, value] of Object.entries(body)) {
    partials.push([named, onboardingWithout(body, named)]);
    if (typeof value !== "object" || value === null) continue;
    const nested = value as Readonly<Record<string, unknown>>;
    for (const inner of Object.keys(nested))
      partials.push([
        `${named}.${inner}`,
        { ...body, [named]: onboardingWithout(nested, inner) },
      ]);
  }
  return partials;
}

test("a created body is refused when any part of it is absent", () => {
  const results: readonly ProjectRepositoryCreateResult[] = [
    onboardingCreated(),
    onboardingCreated({
      ruleset: { result: "Refused", message: "rulesets are not available" },
      configurations: {
        result: "Bootstrapped",
        revision: asConfigurationRevisionId("bootstrap"),
      },
    }),
  ];
  for (const result of results) {
    const body = projectRepositoryCreateResponse(partition, result)
      .body as Readonly<Record<string, unknown>>;
    for (const [named, partial] of onboardingCreatedPartials(body))
      assert.equal(
        projectRepositoryCreatedSchema.safeParse(partial).success,
        false,
        named,
      );
  }
});

test("every ruleset outcome parses as the schema answers it", () => {
  const rulesets: readonly ProjectRepositoryRulesetResult[] = [
    { result: "Created" },
    { result: "Refused", message: "rulesets are not available" },
    { result: "Skipped" },
    { result: "Unavailable" },
  ];
  for (const ruleset of rulesets) {
    assert.deepEqual(
      projectRepositoryCreatedSchema.parse(
        projectRepositoryCreateResponse(
          partition,
          onboardingCreated({ ruleset }),
        ).body,
      ).ruleset,
      ruleset,
    );
  }
});

test("each way a creation is refused is its own status and never a creation", () => {
  const refusals: readonly (readonly [
    ProjectRepositoryCreateResult,
    number,
  ])[] = [
    [{ result: "InstallationMissing", app: asForgeApp("worker") }, 422],
    [{ result: "PersonalAccountCreatesOnGitHub" }, 422],
    [{ result: "RepositoryExists" }, 409],
    [{ result: "ForgeRefused", step: "create", message: "no such org" }, 422],
    [{ result: "BindRefused", bind: { result: "BoundElsewhere" } }, 409],
    [{ result: "NotConfigured" }, 404],
    [{ result: "NotFound" }, 404],
    [{ result: "Unavailable" }, 503],
  ];
  for (const [result, status] of refusals) {
    const answer = projectRepositoryCreateResponse(partition, result);
    assert.equal(answer.status, status, result.result);
    assert.equal(
      errorEnvelopeSchema.parse(answer.body).error.code.length > 0,
      true,
    );
  }
});
