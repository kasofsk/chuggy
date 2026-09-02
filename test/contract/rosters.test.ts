/**
 * The contract's copies of the model's and the interpreter's closed sets, held
 * against their sources.
 *
 * `src/contract/` reaches neither directory, so each roster is written twice;
 * this suite is what makes the second copy a checked claim rather than a
 * comment. Each is held against a runtime list where one exists, and otherwise
 * against a record the compiler rejects when the union gains or loses a member.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  architectures,
  artifactRoles,
  attemptEvidences,
  attemptStates,
  configurationProvenanceSources,
  configurationReadinesses,
  draftStates,
  dispatchViewResults,
  escalationReasons,
  evaluationCombinators,
  executionCapabilities,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  finalizers,
  nativeActionKindResolutions,
  nativeActionKinds,
  nativeActionResolutions,
  nativeDrivers,
  notificationKinds,
  notificationResults,
  operatingSystems,
  operationRefusalCodes,
  operationStates,
  outputRenderers,
  phaseRoster,
  repositoryConfigurationFaults,
  requirementSources,
  resultVerdicts,
  resumePoints,
  resumePricings,
  runCostBases,
  schedulerFreshnesses,
  selectorDispatchModes,
  selectorModes,
} from "../../src/contract/rosters.ts";
import {
  nativeHttpPageItemsMax,
  resultReportCharsMax,
  resultReportSchemaVersionMin,
  runConfigurationBytesMax,
} from "../../src/contract/http.ts";
import {
  resultReportCharsMax as interpretedReportCharsMax,
  resultManifestSchemaVersion,
} from "../../src/interpreter/resultManifest.ts";
import { runTurnsPageLimitMax } from "../../src/interpreter/runEvidence.ts";
import type { RunTotals } from "../../src/interpreter/runEvidence.ts";
import { projectChangeKinds } from "../../src/contract/events.ts";
import {
  phaseTags,
  reasonTags,
  resumeTags,
} from "../../src/domain/generated/modelTypes.ts";
import type {
  Combinator,
  Finalizer,
  RetryPricing,
} from "../../src/domain/generated/modelTypes.ts";
import {
  allAttemptEvidence,
  allAttemptStates,
  allExecutionOutcomes,
  allExecutionStatuses,
} from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionTaskKind } from "../../src/interpreter/executionScheduler.ts";
import type {
  Architecture as RequiredArchitecture,
  CapabilityExecutionRequirement,
  ContainerExecutionRequirement,
  ExecutionCapability as RequiredExecutionCapability,
  ExecutionRequirement,
  NativeDriver as RequiredNativeDriver,
  NativeExecutionRequirement,
  OperatingSystem as RequiredOperatingSystem,
  RequirementSource as MaterializedRequirementSource,
} from "../../src/interpreter/executionRequirement.ts";
import { executionRequirementSchema } from "../../src/contract/responses.ts";
import { allArtifactRoles } from "../../src/interpreter/resultManifest.ts";
import {
  allNativeActionKinds,
  allNativeActionResolutions,
  nativeActionResolutions as interpretedNativeActionResolutions,
} from "../../src/interpreter/ticketCommand.ts";
import {
  nativeActionPageLimitMax,
  projectPageLimitMax,
} from "../../src/interpreter/nativeWeb.ts";
import type { OperationRefusalCode } from "../../src/interpreter/nativeWeb.ts";
import {
  executionPageLimitMax,
  outputPreviewBytesMax,
  type ExecutionResultResource,
  type OutputRenderer,
  type ProjectOperationalStatus,
} from "../../src/interpreter/operationsView.ts";
import type { OperationState } from "../../src/interpreter/operationInbox.ts";
import {
  notificationPageLimitMax,
  type NotificationBatch,
} from "../../src/interpreter/notifications.ts";
import {
  dispatchViewPageLimitMax,
  type DispatchViewPage,
} from "../../src/interpreter/dispatchView.ts";
import type {
  ConfigurationRevisionProvenance,
  ConfigurationRevisionSummary,
  DraftState,
} from "../../src/interpreter/authoring.ts";
import type { RepositoryConfigurationFault } from "../../src/interpreter/repositoryConfiguration.ts";
import type { SelectorRuntimeSettings } from "../../src/interpreter/selector.ts";

function keysOf(record: Readonly<Record<string, true>>): readonly string[] {
  return Object.keys(record).sort();
}

const sorted = (values: readonly string[]) => [...values].sort();

test("the escalation reasons are the model's, less the absent one", () => {
  assert.deepEqual(
    [...escalationReasons],
    reasonTags.filter((tag) => tag !== "NoReason"),
  );
});

test("the resume points are the model's, less the absent one", () => {
  assert.deepEqual(
    [...resumePoints],
    resumeTags.filter((tag) => tag !== "NoResume"),
  );
});

test("the phase and scheduler rosters are the model's", () => {
  assert.deepEqual([...phaseRoster], [...phaseTags]);
  assert.deepEqual([...executionStatuses], [...allExecutionStatuses]);
  assert.deepEqual([...executionOutcomes], [...allExecutionOutcomes]);
  assert.deepEqual([...attemptStates], [...allAttemptStates]);
  assert.deepEqual([...artifactRoles], [...allArtifactRoles]);
  assert.deepEqual(
    sorted(nativeActionResolutions),
    sorted(allNativeActionResolutions),
  );
});

test("the wire pairs each action kind with the answers the interpreter admits", () => {
  assert.deepEqual(sorted(nativeActionKinds), sorted(allNativeActionKinds));
  for (const kind of allNativeActionKinds) {
    assert.deepEqual(
      [...nativeActionKindResolutions[kind]],
      [...interpretedNativeActionResolutions[kind]],
    );
  }
});

test("the requirement rosters are exhaustive over the interpreter's unions", () => {
  const systems: Record<RequiredOperatingSystem, true> = {
    Linux: true,
    MacOS: true,
  };
  const widths: Record<RequiredArchitecture, true> = {
    Amd64: true,
    Arm64: true,
  };
  const drivers: Record<RequiredNativeDriver, true> = {
    XcodeBuild: true,
    XcodeTesting: true,
    IosSimulatorTesting: true,
  };
  const sources: Record<MaterializedRequirementSource, true> = {
    ExplicitTask: true,
    TaskKindDefault: true,
    TicketDefault: true,
    PlatformDefault: true,
  };
  const capabilities: Record<RequiredExecutionCapability, true> = {
    "Agent:Claude": true,
    "Agent:Codex": true,
  };
  assert.deepEqual(sorted(operatingSystems), keysOf(systems));
  assert.deepEqual(sorted(architectures), keysOf(widths));
  assert.deepEqual(sorted(nativeDrivers), keysOf(drivers));
  assert.deepEqual(sorted(requirementSources), keysOf(sources));
  assert.deepEqual(sorted(executionCapabilities), keysOf(capabilities));
});

/**
 * Held over the schema's own arms rather than a roster, because the arms are
 * the wire's list of modes and of what each mode carries. A mode or a field
 * the interpreter materializes and the wire has no key for is a response the
 * console parses as nothing at all.
 */
test("the wire has an arm, and its keys, for every requirement the interpreter materializes", () => {
  const modes: Record<ExecutionRequirement["mode"], true> = {
    Container: true,
    ContainerCapability: true,
    Native: true,
  };
  const container: Record<keyof ContainerExecutionRequirement, true> = {
    mode: true,
    operatingSystem: true,
    architecture: true,
    image: true,
  };
  const capability: Record<keyof CapabilityExecutionRequirement, true> = {
    mode: true,
    operatingSystem: true,
    architecture: true,
    capabilities: true,
  };
  const native: Record<keyof NativeExecutionRequirement, true> = {
    mode: true,
    architecture: true,
    driver: true,
    xcodeVersionMin: true,
    sdkVersionMin: true,
  };
  const arms = new Map<string, readonly string[]>(
    executionRequirementSchema.options.map((arm) => [
      arm.shape.mode.value,
      sorted(Object.keys(arm.shape)),
    ]),
  );
  assert.deepEqual(sorted([...arms.keys()]), keysOf(modes));
  assert.deepEqual(arms.get("Container"), keysOf(container));
  assert.deepEqual(arms.get("ContainerCapability"), keysOf(capability));
  assert.deepEqual(arms.get("Native"), keysOf(native));
});

test("the wire's evidence labels are the interpreter's own list", () => {
  assert.deepEqual([...attemptEvidences], [...allAttemptEvidence]);
});

test("the cost basis roster is exhaustive over the union it induces", () => {
  const bases: Record<RunTotals["costBasis"], true> = { List: true };
  assert.deepEqual(sorted(runCostBases), keysOf(bases));
});

test("a run's read bounds are the ones the layers beneath them hold", () => {
  assert.equal(runConfigurationBytesMax, outputPreviewBytesMax);
  assert.equal(resultReportCharsMax, interpretedReportCharsMax);
  assert.equal(nativeHttpPageItemsMax, runTurnsPageLimitMax);
});

/**
 * Held in both directions: too high draws "too old" over every run there is,
 * and too low draws nothing at all for the versions #363 is about.
 */
test("the version a summary begins at is the one the manifest reader requires it at", () => {
  assert.equal(resultReportSchemaVersionMin, resultManifestSchemaVersion);
});

test("one page bound serves every collection route", () => {
  assert.equal(nativeHttpPageItemsMax, projectPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, executionPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, notificationPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, dispatchViewPageLimitMax);
  assert.equal(nativeHttpPageItemsMax, nativeActionPageLimitMax);
});

test("the rosters with no runtime list are exhaustive over their unions", () => {
  const kinds: Record<ExecutionTaskKind, true> = {
    Work: true,
    Evaluation: true,
  };
  const renderers: Record<OutputRenderer, true> = {
    UnifiedDiff: true,
    Markdown: true,
    Json: true,
    Text: true,
  };
  const states: Record<OperationState, true> = {
    Pending: true,
    Succeeded: true,
    Refused: true,
    Answered: true,
    Cancelled: true,
  };
  const refusals: Record<OperationRefusalCode, true> = {
    NotEnabled: true,
    AuthoringChanged: true,
    ConfigurationInvalid: true,
    TicketChanged: true,
    SelectionChanged: true,
    CommandUnreadable: true,
    ExecutionSourceUnreadable: true,
    ExecutionSourceDenied: true,
  };
  const freshness: Record<
    ProjectOperationalStatus["schedulerFreshness"],
    true
  > = { Unknown: true };
  const verdicts: Record<ExecutionResultResource["verdict"], true> = {
    Pass: true,
    Fail: true,
  };
  const dispatchResults: Record<DispatchViewPage["result"], true> = {
    Page: true,
    Reset: true,
  };
  const batches: Record<NotificationBatch["result"], true> = {
    Events: true,
    Reset: true,
  };
  assert.deepEqual(sorted(executionTaskKinds), keysOf(kinds));
  assert.deepEqual(sorted(outputRenderers), keysOf(renderers));
  assert.deepEqual(sorted(operationStates), keysOf(states));
  assert.deepEqual(sorted(operationRefusalCodes), keysOf(refusals));
  assert.deepEqual(sorted(schedulerFreshnesses), keysOf(freshness));
  assert.deepEqual(sorted(resultVerdicts), keysOf(verdicts));
  assert.deepEqual(sorted(dispatchViewResults), keysOf(dispatchResults));
  assert.deepEqual(sorted(notificationResults), keysOf(batches));
});

test("the selector rosters are exhaustive over the settings they name", () => {
  const modes: Record<SelectorRuntimeSettings["mode"], true> = {
    Running: true,
    Paused: true,
  };
  const dispatch: Record<SelectorRuntimeSettings["dispatchMode"], true> = {
    Automatic: true,
    ApprovalRequired: true,
  };
  assert.deepEqual(sorted(selectorModes), keysOf(modes));
  assert.deepEqual(sorted(selectorDispatchModes), keysOf(dispatch));
});

test("the authoring rosters are exhaustive over the model unions", () => {
  const states: Record<DraftState, true> = {
    Draft: true,
    Released: true,
    Deleted: true,
  };
  const combinators: Record<Combinator, true> = {
    UnanimousPass: true,
    AnyPass: true,
  };
  const pricing: Record<RetryPricing, true> = {
    RetryCharged: true,
    RetryFree: true,
  };
  const finalizer: Record<Finalizer, true> = {
    NoFinalizer: true,
    ManagedFinalizer: true,
  };
  const provenance: Record<ConfigurationRevisionProvenance["source"], true> = {
    Authored: true,
    Repository: true,
  };
  const readiness: Record<ConfigurationRevisionSummary["readiness"], true> = {
    Ready: true,
    Incomplete: true,
  };
  const faults: Record<RepositoryConfigurationFault, true> = {
    TooManyDeclarations: true,
    PathInvalid: true,
    SymlinkRefused: true,
    ContentTooLarge: true,
    DocumentUnreadable: true,
    EnvelopeInvalid: true,
    NameInvalid: true,
    ConfigurationInvalid: true,
    DuplicateName: true,
    DuplicatePath: true,
  };
  assert.deepEqual(sorted(draftStates), keysOf(states));
  assert.deepEqual(sorted(evaluationCombinators), keysOf(combinators));
  assert.deepEqual(sorted(resumePricings), keysOf(pricing));
  assert.deepEqual(sorted(finalizers), keysOf(finalizer));
  assert.deepEqual(sorted(configurationProvenanceSources), keysOf(provenance));
  assert.deepEqual(sorted(configurationReadinesses), keysOf(readiness));
  assert.deepEqual(sorted(repositoryConfigurationFaults), keysOf(faults));
});

test("the stream carries every polled kind and the two polling omits", () => {
  assert.deepEqual(
    sorted(projectChangeKinds),
    sorted([...notificationKinds, "Execution", "NativeAction"]),
  );
});
